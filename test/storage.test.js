import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, transaction } from '../src/storage.js';

test('existing database survives reopening, and photos can be added and deleted', async () => {
  const db = await openDB();
  const photo = { id: 'legacy-photo', lat: 31.5, lng: 130.5, caption: '旧版の写真', createdAt: 1, blob: new Blob(['photo'], { type: 'image/jpeg' }) };
  await transaction(db, 'readwrite', store => store.put(photo));
  db.close();
  const reopened = await openDB();
  const saved = await transaction(reopened, 'readonly', store => store.getAll());
  assert.equal(saved.length, 1);
  assert.equal(saved[0].caption, photo.caption);
  assert.equal(await saved[0].blob.text(), 'photo');
  await transaction(reopened, 'readwrite', store => store.delete(photo.id));
  assert.deepEqual(await transaction(reopened, 'readonly', store => store.getAll()), []);
  reopened.close();
});

test('aborted writes reject instead of reporting success', async () => {
  const db = await openDB();
  await assert.rejects(transaction(db, 'readwrite', store => {
    const request = store.put({ id: 'aborted' });
    store.transaction.abort();
    return request;
  }));
  assert.equal(await transaction(db, 'readonly', store => store.get('aborted')), undefined);
  db.close();
});
