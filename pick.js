// Opened by the file:// page sidebar, which cannot show a directory picker or
// a permission prompt from its iframe.
(async () => {
 const $ = id => document.getElementById(id);
 const channel = new BroadcastChannel('markdown-folder-viewer');
 const saved = new URLSearchParams(location.search).get('mode') === 'grant' ? await MfvHandles.load() : null;

 function done() {
  channel.postMessage({ type: 'root-changed' });
  window.close();
 }

 if (saved) {
  $('message').textContent = `Chrome requires permission again to read “${saved.name}”. Your files stay on this device.`;
  $('action').textContent = 'Grant access';
 }

 $('action').addEventListener('click', async () => {
  $('status').textContent = '';
  try {
   if (saved) {
    if (await MfvHandles.permission(saved, true)) done();
    else $('status').textContent = 'Permission was not granted.';
    return;
   }
   const handle = await window.showDirectoryPicker({ mode: 'read' });
   await MfvHandles.save(handle);
   done();
  } catch (e) {
   if (e.name !== 'AbortError') $('status').textContent = e.message;
  }
 });
})();
