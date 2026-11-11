import { imageType } from './imageType.js';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('このファイルは読み込めません。「バックアップを保存」で作ったファイルを選んでください。'); }
  if (data?.version !== 1 || !Array.isArray(data.photos)) throw new Error('このアプリのバックアップではないようです。「バックアップを保存」で作ったファイルを選んでください。');
  if (data.photos.length > 10000) throw new Error('一度に戻せる写真は10,000枚までです。');
  const ids = new Set();
  return data.photos.map((p, index) => {
    const fail = () => { throw new Error((index + 1) + '枚目の写真が壊れているため、戻すのをやめました。今ある写真はそのままです。'); };
    if (!p || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 200 ||
        ids.has(p.id) || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 ||
        !Number.isFinite(p.lng) || Math.abs(p.lng) > 180 ||
        !Number.isFinite(p.createdAt) || !Number.isFinite(new Date(p.createdAt).getTime()) ||
        typeof p.caption !== 'string' || p.caption.length > 100 ||
        typeof p.image !== 'string') fail();
    ids.add(p.id);
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(p.image);
    if (!match || match[2].length % 4 !== 0) fail();
    let bytes;
    try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch { fail(); }
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) fail();
    const type = match[1];
    if (imageType(bytes) !== type) fail();
    if (p.accuracy != null && (!Number.isFinite(p.accuracy) || p.accuracy < 0)) fail();
    return { id: p.id, lat: p.lat, lng: p.lng, caption: p.caption, createdAt: p.createdAt,
      ...(p.accuracy != null ? { accuracy: p.accuracy } : {}),
      blob: new Blob([bytes], { type: 'image/' + type }) };
  });
}
export async function readBackup(file) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('ファイルが大きすぎます。100MBまでのファイルを選んでください。');
  const photos = parseBackup(await file.text());
  // Validate all images before writing anything.
  for (const photo of photos) {
    const url = URL.createObjectURL(photo.blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    } catch { throw new Error('読み込めない画像が入っているため、戻すのをやめました。今ある写真はそのままです。'); }
    finally { URL.revokeObjectURL(url); }
  }
  return photos;
}
export function restoreBackup(db, photos) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    let added = 0, skipped = 0, all = [], failure;
    tx.oncomplete = () => resolve({ added, skipped, photos: all });
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('途中で止まったため、戻すのをやめました。今ある写真はそのままです。'));
    function next(index) {
      try {
        if (index === photos.length) {
          store.getAll().onsuccess = event => { all = event.target.result; };
          return;
        }
        const photo = photos[index];
        store.get(photo.id).onsuccess = event => {
          try {
            if (event.target.result) { skipped++; next(index + 1); }
            else { store.add(photo).onsuccess = () => { added++; next(index + 1); }; }
          } catch (error) { failure = error; tx.abort(); }
        };
      } catch (error) { failure = error; tx.abort(); }
    }
    next(0);
  });
}
