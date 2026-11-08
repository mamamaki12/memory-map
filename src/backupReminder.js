// Remembers in this browser when the last backup file was made and how many photos were saved after it.
const KEY = 'memory-map-backup';
export const REMIND_EVERY = 10;
function browserStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
export function loadBackupState(storage = browserStorage()) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (value && (value.at === null || Number.isFinite(value.at)) && Number.isInteger(value.added) && value.added >= 0) {
      return { at: value.at, added: value.added };
    }
  } catch { /* unreadable or damaged: start without a record */ }
  return { at: null, added: 0 };
}
export function saveBackupState(state, storage = browserStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(state)); } catch { /* the reminder is only a convenience */ }
}
// Without a record every photo counts; after a backup only the photos saved since then.
export function unbackedCount(state, photoCount) {
  return state.at === null ? photoCount : Math.min(state.added, photoCount);
}
export function backupReminder(state, photoCount) {
  const count = unbackedCount(state, photoCount);
  if (!count || count % REMIND_EVERY) return '';
  return (state.at === null ? '写真が' + count + '枚になりました。' : '前回のバックアップから写真が' + count + '枚増えました。')
    + '設定の「バックアップ」で保存しておくと安心です。';
}
export function backupFileName(time = Date.now()) {
  const day = new Date(time);
  const pad = value => String(value).padStart(2, '0');
  return 'memory-map-backup-' + day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate()) + '.json';
}
