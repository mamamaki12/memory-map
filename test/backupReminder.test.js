import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackupState, saveBackupState, unbackedCount, backupReminder, backupFileName } from '../src/backupReminder.js';
function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test('no record, damaged record or blocked storage starts without a backup', () => {
  assert.deepEqual(loadBackupState(memory()), { at: null, added: 0 });
  assert.deepEqual(loadBackupState(memory({ 'memory-map-backup': '{bad' })), { at: null, added: 0 });
  assert.deepEqual(loadBackupState(memory({ 'memory-map-backup': '{"at":"x","added":-1}' })), { at: null, added: 0 });
  assert.deepEqual(loadBackupState({ getItem() { throw new Error('blocked'); } }), { at: null, added: 0 });
  assert.doesNotThrow(() => saveBackupState({ at: 1, added: 0 }, { setItem() { throw new Error('full'); } }));
});
test('the record survives a reload', () => {
  const storage = memory();
  saveBackupState({ at: 1700000000000, added: 3 }, storage);
  assert.deepEqual(loadBackupState(storage), { at: 1700000000000, added: 3 });
});
test('reminds every 10 photos that are not in a backup yet', () => {
  assert.equal(unbackedCount({ at: null, added: 0 }, 7), 7);
  assert.equal(unbackedCount({ at: 1, added: 12 }, 5), 5);
  assert.equal(backupReminder({ at: null, added: 9 }, 9), '');
  assert.match(backupReminder({ at: null, added: 1 }, 10), /写真が10枚になりました/);
  assert.match(backupReminder({ at: 1, added: 20 }, 50), /前回のバックアップから写真が20枚増えました/);
  assert.equal(backupReminder({ at: 1, added: 0 }, 50), '');
});
test('backup files carry the day they were made', () => {
  assert.match(backupFileName(new Date(2026, 10, 4, 15).getTime()), /^memory-map-backup-2026-11-04\.json$/);
});
