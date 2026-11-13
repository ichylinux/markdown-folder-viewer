window.MfvHandles = (() => {
 const DB = 'markdown-folder-viewer-db', STORE = 'handles';

 function dbOpen() {
  return new Promise((resolve, reject) => {
   const r = indexedDB.open(DB, 1);
   r.onupgradeneeded = () => r.result.createObjectStore(STORE);
   r.onsuccess = () => resolve(r.result);
   r.onerror = () => reject(r.error);
  });
 }

 // 'root' holds the selected folder; 'saved' holds the pane's remembered
 // folders as [{ path, handle }].
 async function save(value, key = 'root') {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
   const tx = db.transaction(STORE, 'readwrite');
   tx.objectStore(STORE).put(value, key);
   tx.oncomplete = () => { db.close(); resolve(); };
   tx.onerror = () => { db.close(); reject(tx.error); };
  });
 }

 async function load(key = 'root') {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
   const r = db.transaction(STORE).objectStore(STORE).get(key);
   r.onsuccess = () => { db.close(); resolve(r.result || null); };
   r.onerror = () => { db.close(); reject(r.error); };
  });
 }

 async function permission(handle, request = false) {
  let p = await handle.queryPermission({ mode: 'read' });
  if (p !== 'granted' && request) p = await handle.requestPermission({ mode: 'read' });
  return p === 'granted';
 }

 return { save, load, permission };
})();
