import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharePhoto, friendPhotos, unsharePhoto } from '../src/friendsApi.js';
const photo = { id: 'local', lat: 31, lng: 130, caption: '思い出', createdAt: 1, blob: new Blob(['image'], { type: 'image/png' }) };
test('failed metadata write removes uploaded photo', async () => {
  const removed = [];
  const client = { storage: { from: () => ({ upload: async () => ({ data: {} }), remove: async paths => { removed.push(...paths); return { data: {} }; } }) },
    from: () => ({ insert: async () => ({ error: new Error('write failed') }) }) };
  await assert.rejects(sharePhoto(client, { id: 'owner' }, photo), /write failed/);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].startsWith('owner/'));
});
test('friend map excludes own uploads and labels peer photos', async () => {
  const downloaded = [];
  const client = { storage: { from: () => ({ download: async path => { downloaded.push(path); return { data: photo.blob }; } }) } };
  const rows = [{ id: 'one', owner: 'me' }, { id: 'two', owner: 'friend', object_path: 'friend/two.jpg', caption: '友達', lat: 1, lng: 2, captured_at: '2026-01-01T00:00:00Z' }];
  const output = await friendPhotos(client, rows, 'me');
  assert.deepEqual(downloaded, ['friend/two.jpg']);
  assert.equal(output[0].shared, true);
  assert.equal(output[0].id, 'friend:two');
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
