// Keep the original database name, version and store so existing photos survive migration.
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('memory-map', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('ほかのタブを閉じて再読み込みしてください。'));
  });
}
export function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const request = action(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存処理が中断されました。'));
  });
}
