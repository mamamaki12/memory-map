import { createClient } from '@supabase/supabase-js';
export async function loadFriendsClient() {
  const response = await fetch(import.meta.env.BASE_URL + 'friends-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('友達機能の設定を読み込めません。');
  const config = await response.json();
  if (!config.url || !config.publishableKey) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url)) throw new Error('共有サーバーのURLが不正です。');
  return createClient(config.url, config.publishableKey);
}
export function result(value) { if (value.error) throw value.error; return value.data; }
export async function loadFriendsData(client) {
  const profile = result(await client.rpc('ensure_memory_profile'));
  const relationships = result(await client.from('memory_friendships').select('*').order('created_at', { ascending: false }));
  const ids = [...new Set(relationships.flatMap(f => [f.requester, f.recipient]))];
  const profiles = ids.length ? result(await client.from('memory_profiles').select('*').in('id', ids)) : [];
  const shared = result(await client.from('memory_shared_photos').select('*').order('captured_at', { ascending: false }).limit(200));
  return { profile, relationships, profiles, shared };
}
export async function friendPhotos(client, rows, owner) {
  const output = [];
  for (const row of rows.filter(row => row.owner !== owner)) {
    const { data, error } = await client.storage.from('memory-photos').download(row.object_path);
    if (error) throw error;
    output.push({ id: 'friend:' + row.id, cloudId: row.id, owner: row.owner, caption: row.caption,
      lat: row.lat, lng: row.lng, createdAt: Date.parse(row.captured_at), blob: data, shared: true });
  }
  return output;
}
export async function sharePhoto(client, user, photo) {
  const id = crypto.randomUUID();
  const path = user.id + '/' + id + '.jpg';
  result(await client.storage.from('memory-photos').upload(path, photo.blob, { contentType: photo.blob.type || 'image/jpeg', upsert: false }));
  try {
    result(await client.from('memory_shared_photos').insert({ id, owner: user.id, local_id: photo.id, object_path: path,
      caption: photo.caption, lat: photo.lat, lng: photo.lng, captured_at: new Date(photo.createdAt).toISOString() }));
  } catch (error) {
    await client.storage.from('memory-photos').remove([path]);
    throw error;
  }
}
export async function unsharePhoto(client, row) {
  result(await client.from('memory_shared_photos').delete().eq('id', row.id));
  // A failed cleanup must not reinstate access to the photo.
  const removed = await client.storage.from('memory-photos').remove([row.object_path]);
  if (removed.error) return '共有を停止しました。サーバー上の画像削除は再試行が必要です。';
  return '共有を停止しました。';
}
