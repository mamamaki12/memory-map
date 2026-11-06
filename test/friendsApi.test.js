import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharePhoto, friendPhotos, unsharePhoto, loadFriendsData, friendlyMessage } from '../src/friendsApi.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64');
const photo = { id: 'local', lat: 31, lng: 130, caption: '思い出', createdAt: 1, blob: new Blob([png], { type: 'image/png' }) };
const friendRow = (id, extra = {}) => ({ id, owner: 'friend', object_path: 'friend/' + id + '.jpg', caption: '友達', lat: 1, lng: 2, captured_at: '2026-01-01T00:00:00Z', ...extra });
function storage(files, downloaded = []) {
  return { storage: { from: () => ({ download: async path => {
    downloaded.push(path);
    return path in files ? { data: files[path] } : { error: new Error('Object not found') };
  } }) } };
}

test('metadata row is written before the image, and a failed upload removes the row', async () => {
  const events = [];
  const client = {
    from: () => ({
      insert: async row => { events.push('row:' + row.object_path); return { data: null }; },
      delete: () => ({ eq: async (_column, id) => { events.push('remove-row:' + id); return { data: null }; } }),
    }),
    storage: { from: () => ({ upload: async path => { events.push('upload:' + path); return { error: new Error('upload failed') }; } }) },
  };
  await assert.rejects(sharePhoto(client, { id: 'owner' }, photo), /upload failed/);
  assert.equal(events.length, 3);
  assert.match(events[0], /^row:owner\/.+\.jpg$/);
  assert.equal(events[1], 'upload:' + events[0].slice(4));
  assert.match(events[2], /^remove-row:/);
});
test('failed metadata write uploads nothing', async () => {
  let uploaded = false;
  const client = { from: () => ({ insert: async () => ({ error: new Error('write failed') }) }),
    storage: { from: () => ({ upload: async () => { uploaded = true; return { data: {} }; } }) } };
  await assert.rejects(sharePhoto(client, { id: 'owner' }, photo), /write failed/);
  assert.equal(uploaded, false);
});
test('friend map excludes own uploads and labels peer photos', async () => {
  const downloaded = [];
  const client = storage({ 'friend/two.jpg': photo.blob }, downloaded);
  const { photos, failed } = await friendPhotos(client, [{ id: 'one', owner: 'me' }, friendRow('two')], 'me');
  assert.deepEqual(downloaded, ['friend/two.jpg']);
  assert.equal(failed, 0);
  assert.equal(photos[0].shared, true);
  assert.equal(photos[0].id, 'friend:two');
  assert.equal(photos[0].blob.type, 'image/png');
});
test('a missing or non-image file is skipped instead of hiding every friend photo', async () => {
  const html = new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' });
  const client = storage({ 'friend/ok.jpg': photo.blob, 'friend/html.jpg': html });
  const { photos, failed } = await friendPhotos(client, [friendRow('ok'), friendRow('missing'), friendRow('html')], 'me');
  assert.deepEqual(photos.map(p => p.id), ['friend:ok']);
  assert.equal(failed, 2);
});
test('already downloaded friend photos are reused and forgotten once unshared', async () => {
  const downloaded = [];
  const client = storage({ 'friend/a.jpg': photo.blob, 'friend/b.jpg': photo.blob }, downloaded);
  const cache = new Map();
  await friendPhotos(client, [friendRow('a'), friendRow('b')], 'me', cache);
  const again = await friendPhotos(client, [friendRow('a')], 'me', cache);
  assert.deepEqual(downloaded, ['friend/a.jpg', 'friend/b.jpg']);
  assert.equal(again.photos.length, 1);
  assert.deepEqual([...cache.keys()], ['a']);
});
test('unshare revokes metadata before cleaning up storage', async () => {
  const events = [];
  const client = {
    from: () => ({ delete: () => ({ eq: async () => { events.push('revoke'); return { data: {} }; } }) }),
    storage: { from: () => ({ remove: async () => { events.push('delete'); return { error: new Error('cleanup') }; } }) },
  };
  const message = await unsharePhoto(client, { id: 'one', object_path: 'owner/one.jpg' });
  assert.deepEqual(events, ['revoke','delete']);
  assert.match(message, /共有を停止/);
});
test('only names are read from other profiles, and own shares never crowd out friends', async () => {
  const calls = [];
  const query = (table, rows) => {
    const chain = { select: columns => { calls.push(table + ' select ' + columns); return chain; },
      in: () => chain, eq: (column, value) => { calls.push(table + ' eq ' + column + '=' + value); return chain; },
      neq: (column, value) => { calls.push(table + ' neq ' + column + '=' + value); return chain; },
      order: () => chain, limit: count => { calls.push(table + ' limit ' + count); return chain; },
      then: resolve => resolve({ data: rows }) };
    return chain;
  };
  const client = {
    rpc: async () => ({ data: { id: 'me', display_name: '自分', friend_code: 'code' } }),
    from: table => query(table, table === 'memory_friendships' ? [{ id: 'f', requester: 'me', recipient: 'friend', status: 'accepted' }]
      : table === 'memory_profiles' ? [{ id: 'friend', display_name: '友達' }] : [friendRow('x')]),
  };
  const data = await loadFriendsData(client, 'me');
  assert.ok(calls.includes('memory_profiles select id,display_name'));
  assert.ok(calls.includes('memory_shared_photos eq owner=me'));
  assert.ok(calls.includes('memory_shared_photos neq owner=me'));
  assert.ok(calls.includes('memory_shared_photos limit 200'));
  assert.equal(data.shared.length, 2);
});
test('server and network errors are shown in plain Japanese', () => {
  assert.match(friendlyMessage(new TypeError('Failed to fetch')), /通信できませんでした/);
  assert.match(friendlyMessage(new TypeError('Load failed')), /通信できませんでした/);
  assert.match(friendlyMessage({ status: 429, message: 'email rate limit exceeded' }), /上限/);
  assert.match(friendlyMessage({ code: '23505', message: 'duplicate key value' }), /すでに共有/);
  assert.match(friendlyMessage({ code: 'PGRST202', message: 'Could not find the function' }), /更新が必要/);
  assert.equal(friendlyMessage({ message: '友達コードが見つかりません' }), '友達コードが見つかりません');
  assert.match(friendlyMessage({ message: 'something odd' }), /^処理に失敗しました。.*something odd/);
});
