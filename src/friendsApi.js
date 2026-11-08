import { createClient } from '@supabase/supabase-js';
import { imageType } from './imageType.js';
export const FRIEND_PHOTO_LIMIT = 200;
export async function loadFriendsClient() {
  const response = await fetch(import.meta.env.BASE_URL + 'friends-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('友達機能の設定を読み込めません。');
  const config = await response.json();
  if (!config.url || !config.publishableKey) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url)) throw new Error('共有サーバーのURLが不正です。');
  return createClient(config.url, config.publishableKey);
}
export function result(value) { if (value.error) throw value.error; return value.data; }
// Show server and network failures in plain Japanese; the app's own SQL messages are already Japanese.
export function friendlyMessage(error) {
  const text = String(error?.message ?? error ?? '');
  if (error?.code === '23505') return 'この写真はすでに共有しています。「写真・申請を更新」を押してください。';
  if (error?.code === 'PGRST202') return 'この機能はまだ使えません。共有サーバーの更新が必要です。';
  if (error?.status === 429 || /rate limit/i.test(text)) return '送信の回数が上限に達しました。しばらく待ってからお試しください。';
  if (/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(text)) return '通信できませんでした。電波の良い場所で、もう一度お試しください。';
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return text;
  return '処理に失敗しました。時間をおいてもう一度お試しください。' + (text ? '（' + text + '）' : '');
}
export async function loadFriendsData(client, userId) {
  const profile = result(await client.rpc('ensure_memory_profile'));
  const relationships = result(await client.from('memory_friendships').select('*').order('created_at', { ascending: false }));
  const ids = [...new Set(relationships.flatMap(f => [f.requester, f.recipient]))];
  // Other people's friend codes are private; only names are read.
  const profiles = ids.length ? result(await client.from('memory_profiles').select('id,display_name').in('id', ids)) : [];
  // Own rows are read separately so they never push friends' photos out of the newest-200 window.
  const own = result(await client.from('memory_shared_photos').select('*').eq('owner', userId));
  const friends = result(await client.from('memory_shared_photos').select('*').neq('owner', userId)
    .order('captured_at', { ascending: false }).limit(FRIEND_PHOTO_LIMIT));
  return { profile, relationships, profiles, shared: [...own, ...friends] };
}
// Shared rows never change, so each image is downloaded once and reused until its row disappears.
// A missing or non-image file is skipped so one broken share cannot hide every friend's photos.
export async function friendPhotos(client, rows, owner, cache = new Map()) {
  const photos = [];
  const seen = new Set();
  let failed = 0;
  for (const row of rows.filter(row => row.owner !== owner)) {
    seen.add(row.id);
    let blob = cache.get(row.id);
    if (!blob) {
      try {
        const { data, error } = await client.storage.from('memory-photos').download(row.object_path);
        if (error) throw error;
        const type = imageType(new Uint8Array(await data.slice(0, 12).arrayBuffer()));
        if (!type) throw new Error('not an image');
        blob = new Blob([data], { type: 'image/' + type });
        cache.set(row.id, blob);
      } catch { failed++; continue; }
    }
    photos.push({ id: 'friend:' + row.id, cloudId: row.id, owner: row.owner, caption: row.caption,
      lat: row.lat, lng: row.lng, createdAt: Date.parse(row.captured_at), blob, shared: true });
  }
  for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
  return { photos, failed };
}
export async function sharePhoto(client, user, photo) {
  const id = crypto.randomUUID();
  const path = user.id + '/' + id + '.jpg';
  // The row comes first: the server accepts an image only at the path of one of the owner's rows.
  result(await client.from('memory_shared_photos').insert({ id, owner: user.id, local_id: photo.id, object_path: path,
    caption: photo.caption, lat: photo.lat, lng: photo.lng, captured_at: new Date(photo.createdAt).toISOString() }));
  try {
    result(await client.storage.from('memory-photos').upload(path, photo.blob, { contentType: photo.blob.type || 'image/jpeg', upsert: false }));
  } catch (error) {
    try { await client.from('memory_shared_photos').delete().eq('id', id); } catch { /* the row can be stopped from the list */ }
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
