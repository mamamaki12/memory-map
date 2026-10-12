import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, transaction } from '../src/storage.js';
import { parseBackup, readBackup, restoreBackup, MAX_BACKUP_BYTES } from '../src/backup.js';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=';
const record = (id = 'photo') => ({ id, lat: 31.5, lng: 130.5, caption: '思い出', createdAt: 1234, image });
const encode = photos => JSON.stringify({ version: 1, photos });

test('version 1 backup preserves photo bytes, coordinates, caption and time', async () => {
  const [photo] = parseBackup(encode([record()]));
  assert.equal(photo.lat, 31.5);
  assert.equal(photo.caption, '思い出');
  assert.equal(photo.createdAt, 1234);
  assert.equal(photo.blob.type, 'image/png');
  assert.equal(Buffer.from(await photo.blob.arrayBuffer()).toString('base64'), image.split(',')[1]);
});
test('reject malformed backups before writing', () => {
  for (const text of ['bad json', '{"version":2,"photos":[]}', encode([{ ...record(), lat: 91 }]),
      encode([{ ...record(), image: 'data:image/svg+xml;base64,PHN2Zz4=' }]),
      encode([{ ...record(), image: 'data:image/png;base64,YmFk' }]),
      encode([record(), record()])]) assert.throws(() => parseBackup(text));
});
test('restore merges, skips duplicates, and preserves existing captions', async () => {
  const db = await openDB();
  await transaction(db, 'readwrite', store => store.clear());
  const existing = { ...parseBackup(encode([record('same')]))[0], caption: '編集済み' };
  await transaction(db, 'readwrite', store => store.put(existing));
  const result = await restoreBackup(db, parseBackup(encode([record('same'), record('new')])));
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.photos.find(p => p.id === 'same').caption, '編集済み');
  const again = await restoreBackup(db, parseBackup(encode([record('same'), record('new')])));
  assert.equal(again.added, 0);
  assert.equal(again.photos.length, 2);
  db.close();
});
test('failure partway through restoration rolls back all new records', async () => {
  const db = await openDB();
  await transaction(db, 'readwrite', store => store.clear());
  await transaction(db, 'readwrite', store => store.put({ id: 'existing' }));
  await assert.rejects(restoreBackup(db, [{ id: 'first' }, { id: 'broken', uncloneable: () => {} }]));
  assert.deepEqual(await transaction(db, 'readonly', store => store.getAll()), [{ id: 'existing' }]);
  db.close();
});
test('oversized file rejected before reading and image decode errors reject', async () => {
  await assert.rejects(readBackup({ size: MAX_BACKUP_BYTES + 1, text() { throw new Error('must not read'); } }), /100MB/);
  const previous = globalThis.Image;
  globalThis.Image = class { async decode() { throw new Error('corrupt image'); } };
  try { await assert.rejects(readBackup(new Blob([encode([record()])])), /読み込めない画像/); }
  finally { globalThis.Image = previous; }
});
