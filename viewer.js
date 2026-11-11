(() => {
 const $ = id => document.getElementById(id);
 const DB = 'markdown-folder-viewer-db', STORE = 'handles';

 let rootHandle = null;
 const fileMap = new Map();       // Markdown path -> file handle (loaded levels only)
 const dirs = new Map();          // directory path -> sorted child entries (loaded levels only)
 const dirHandles = new Map();    // directory path -> directory handle
 const loadingDirs = new Map();   // directory path -> in-flight scan promise
 const expandedPaths = new Set(); // folders the user has expanded
 let treeGeneration = 0;          // bumped on reset so stale scans are dropped
 let activePath = null;
 let searchTerm = '';
 let objectUrls = [];

 /* ---------- saved folder handle ---------- */

 function dbOpen() {
  return new Promise((resolve, reject) => {
   const r = indexedDB.open(DB, 1);
   r.onupgradeneeded = () => r.result.createObjectStore(STORE);
   r.onsuccess = () => resolve(r.result);
   r.onerror = () => reject(r.error);
  });
 }

 async function saveHandle(handle) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
   const tx = db.transaction(STORE, 'readwrite');
   tx.objectStore(STORE).put(handle, 'root');
   tx.oncomplete = () => { db.close(); resolve(); };
   tx.onerror = () => { db.close(); reject(tx.error); };
  });
 }

 async function loadHandle() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
   const r = db.transaction(STORE).objectStore(STORE).get('root');
   r.onsuccess = () => { db.close(); resolve(r.result || null); };
   r.onerror = () => { db.close(); reject(r.error); };
  });
 }

 async function permission(handle, request = false) {
  let p = await handle.queryPermission({ mode: 'read' });
  if (p !== 'granted' && request) p = await handle.requestPermission({ mode: 'read' });
  return p === 'granted';
 }

 /* ---------- folder selection and scanning ---------- */

 async function chooseFolder() {
  if (!window.showDirectoryPicker) {
   showError('This Chrome version does not support the File System Access API. Please update Chrome.');
   return;
  }
  try {
   rootHandle = await window.showDirectoryPicker({ mode: 'read' });
   await saveHandle(rootHandle);
   await scanFolder();
  } catch (e) {
   if (e.name !== 'AbortError') showError('Could not open folder: ' + e.message);
  }
 }

 function resetTree() {
  treeGeneration++;
  fileMap.clear();
  dirs.clear();
  dirHandles.clear();
  loadingDirs.clear();
  expandedPaths.clear();
 }

 // Refresh (and the initial load) only read the top level. Subfolders are
 // scanned the first time the user expands them, so a large tree never pays
 // for a full recursive walk up front.
 async function scanFolder() {
  if (!rootHandle) return;
  const ok = await permission(rootHandle, true);
  if (!ok) {
   showError('Folder permission was not granted. Click “Choose folder” and select it again.');
   return;
  }
  resetTree();
  dirHandles.set('', rootHandle);
  $('folderName').textContent = rootHandle.name;
  $('tree').innerHTML = '<p class="status">Scanning folder…</p>';
  try {
   await readDir('', rootHandle);
   renderTree();
   $('refresh').disabled = false;
   // Always re-open the active file: the folder may have been re-chosen, and a
   // same-named path in the new folder must not show stale content. Nested
   // files are resolved directly, even though their folder is still collapsed.
   const next = (await fileHandleFor(activePath)) ? activePath : pickInitialPath();
   if (next) await openFile(next);
   else showWelcome();
  } catch (e) {
   showError('Could not read folder: ' + e.message);
  }
 }

 // On first open, show a README so the folder's own landing page appears
 // instead of whichever file happens to sort first. Only the top level is
 // loaded at this point, which is where a landing page normally lives.
 function pickInitialPath() {
  const names = (dirs.get('') || [])
   .filter(entry => entry.kind === 'file' && isMarkdown(entry.name))
   .map(entry => entry.name)
   .sort((a, b) => a.localeCompare(b));
  return names.find(name => /^readme\.md(?:own)?$/i.test(name)) || names[0] || null;
 }

 function isMarkdown(name) {
  return /\.md(?:own)?$/i.test(name);
 }

 async function readDir(path, handle) {
  const gen = treeGeneration;
  const entries = [];
  for await (const [name, child] of handle.entries()) {
   entries.push({ name, kind: child.kind, handle: child });
  }
  if (gen !== treeGeneration) return false; // the tree was reset mid-scan
  const base = path ? path + '/' : '';
  for (const entry of entries) {
   const childPath = base + entry.name;
   if (entry.kind === 'directory') dirHandles.set(childPath, entry.handle);
   else if (isMarkdown(entry.name)) fileMap.set(childPath, entry.handle);
  }
  entries.sort((a, b) => (a.kind === b.kind
   ? a.name.localeCompare(b.name)
   : a.kind === 'directory' ? -1 : 1));
  dirs.set(path, entries);
  updateCount();
  return true;
 }

 function updateCount() {
  $('fileCount').textContent = fileMap.size + (fileMap.size === 1 ? ' file' : ' files');
 }

 /* ---------- sidebar tree ---------- */

 function renderTree() {
  const tree = $('tree');
  tree.replaceChildren();
  buildLevel('', tree);
  if (!tree.children.length) tree.innerHTML = '<p class="empty">No matching Markdown files.</p>';
 }

 // Folders default to collapsed, so only the levels the user has opened get
 // rendered. Unloaded folders stay as cheap closed rows.
 function buildLevel(dirPath, container) {
  for (const entry of dirs.get(dirPath) || []) {
   const path = dirPath ? dirPath + '/' + entry.name : entry.name;
   if (entry.kind === 'directory') {
    if (searchTerm && !folderMatches(path, entry.name)) continue;
    container.appendChild(makeFolderRow(entry.name, path));
   } else if (isMarkdown(entry.name)) {
    if (searchTerm && !path.toLowerCase().includes(searchTerm.toLowerCase())) continue;
    container.appendChild(makeFileRow(entry.name, path));
   }
  }
 }

 function makeFileRow(name, path) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tree-row' + (activePath === path ? ' active' : '');
  b.dataset.file = '1';
  b.dataset.path = path;
  b.title = path;
  b.innerHTML = '<span class="fileicon" aria-hidden="true">📄</span><span class="filename"></span>';
  b.querySelector('.filename').textContent = name;
  b.addEventListener('click', () => openFile(path));
  return b;
 }

 function makeFolderRow(name, path) {
  const isExpanded = expandedPaths.has(path);
  const wrap = document.createElement('div');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tree-row';
  b.dataset.path = path;
  b.title = path;
  b.setAttribute('aria-expanded', String(isExpanded));
  b.innerHTML = '<span class="twisty" aria-hidden="true"></span><span aria-hidden="true">📁</span><span class="filename"></span>';
  b.querySelector('.filename').textContent = name;
  b.querySelector('.twisty').textContent = isExpanded ? '▾' : '▸';

  const children = document.createElement('div');
  children.className = 'tree-children';
  children.hidden = !isExpanded;
  if (isExpanded && dirs.has(path)) buildLevel(path, children);

  b.addEventListener('click', () => toggleFolder(path, b, children));
  wrap.append(b, children);
  return wrap;
 }

 async function toggleFolder(path, row, children) {
  const expand = children.hidden;
  children.hidden = !expand;
  row.setAttribute('aria-expanded', String(expand));
  row.querySelector('.twisty').textContent = expand ? '▾' : '▸';

  if (!expand) {
   expandedPaths.delete(path);
   return;
  }

  if (dirs.has(path)) {
   expandedPaths.add(path);
   children.replaceChildren();
   buildLevel(path, children);
   return;
  }

  children.replaceChildren(statusRow('Scanning folder…'));
  const ok = await ensureDir(path);
  if (children.hidden) return; // collapsed again while scanning
  expandedPaths.add(path);
  children.replaceChildren();
  if (!ok) children.appendChild(statusRow('Could not read this folder.'));
  else buildLevel(path, children);
 }

 // Load one directory level on demand. Repeated clicks while a scan is in
 // flight reuse the same promise instead of walking the directory twice.
 function ensureDir(path) {
  if (dirs.has(path)) return Promise.resolve(true);
  if (loadingDirs.has(path)) return loadingDirs.get(path);
  const task = (async () => {
   const handle = dirHandles.get(path) || await findHandle(path);
   if (!handle || handle.kind !== 'directory') return false;
   try {
    if (!await readDir(path, handle)) return false;
    dirHandles.set(path, handle);
    return true;
   } catch (e) {
    console.warn('Could not scan ' + path, e);
    return false;
   }
  })();
  loadingDirs.set(path, task);
  const cleanup = () => loadingDirs.delete(path);
  task.then(cleanup, cleanup);
  return task;
 }

 function statusRow(text) {
  const p = document.createElement('p');
  p.className = 'status';
  p.textContent = text;
  return p;
 }

 // A folder that has not been scanned yet may contain a match, so keep it
 // visible; scanned folders are filtered by their already-loaded contents.
 function folderMatches(path, name) {
  const term = searchTerm.toLowerCase();
  if (name.toLowerCase().includes(term)) return true;
  if (!dirs.has(path)) return true;
  for (const entry of dirs.get(path)) {
   const childPath = path + '/' + entry.name;
   if (entry.kind === 'directory') {
    if (folderMatches(childPath, entry.name)) return true;
   } else if (isMarkdown(entry.name) && childPath.toLowerCase().includes(term)) return true;
  }
  return false;
 }

 // Cheap in-place highlight update so opening a file never rebuilds (and thus
 // resets) the tree's expand/collapse state.
 function updateActive() {
  for (const row of $('tree').querySelectorAll('.tree-row[data-file]')) {
   row.classList.toggle('active', row.dataset.path === activePath);
  }
 }

 /* ---------- document rendering ---------- */

 async function openFile(path) {
  const handle = await fileHandleFor(path);
  if (!handle) return;
  try {
   const file = await handle.getFile();
   const src = await file.text();
   const parsed = MiniMarkdown.render(src);
   revokeObjectUrls();
   activePath = path;
   $('welcome').hidden = true;
   $('error').hidden = true;
   const article = $('document');
   article.hidden = false;
   article.innerHTML = MiniMarkdown.sanitize(parsed.html);
   makeToc(parsed.headings, article);
   resolveLinks(article, path);
   renderMermaid(article);
   updateActive();
  } catch (e) {
   showError('Could not read file: ' + e.message);
  }
 }

 function revokeObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
 }

 function makeToc(headings, article) {
  article.querySelector('.toc')?.remove();
  if (!headings.length) return;
  const box = document.createElement('div');
  box.className = 'toc';
  const title = document.createElement('div');
  title.className = 'toc-title';
  title.textContent = 'Contents';
  box.appendChild(title);
  const ul = document.createElement('ul');
  for (const h of headings) {
   const li = document.createElement('li');
   li.style.marginLeft = ((h.level - 1) * 12) + 'px';
   const a = document.createElement('a');
   a.href = '#' + h.id;
   a.textContent = h.text;
   li.appendChild(a);
   ul.appendChild(li);
  }
  box.appendChild(ul);
  article.insertBefore(box, article.firstChild);
 }

 function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
 }

 function resolvePath(current, target) {
  let clean = safeDecode(target.split('#')[0].split('?')[0]);
  if (!clean) return current;
  const parts = (current.includes('/') ? current.slice(0, current.lastIndexOf('/') + 1) : '').split('/').filter(Boolean);
  for (const p of clean.split('/')) {
   if (!p || p === '.') continue;
   if (p === '..') parts.pop();
   else parts.push(p);
  }
  return parts.join('/');
 }

 function resolveLinks(article, current) {
  for (const a of article.querySelectorAll('a[href]')) {
   const href = a.getAttribute('href');
   if (!href) continue;
   if (href.startsWith('#') || /^(https?:|mailto:|tel:|\/\/)/i.test(href)) {
    if (/^https?:/i.test(href)) {
     a.target = '_blank';
     a.rel = 'noopener noreferrer';
     if (!a.title) a.title = href;
    }
    continue;
   }
   const target = resolvePath(current, href);
   a.href = '#';
   if (!a.title) a.title = target;
   a.addEventListener('click', async e => {
    e.preventDefault();
    if (!await fileHandleFor(target)) {
     alert('File not found in selected folder:\n' + target);
     return;
    }
    openFile(target);
   });
   // The target may live in a folder that has not been expanded yet, so probe
   // it directly instead of relying on the lazily built fileMap.
   if (!fileMap.has(target)) {
    fileHandleFor(target).then(handle => {
     if (!handle) {
      a.title = 'File not found in selected folder: ' + target;
      a.classList.add('error');
     }
    });
   }
  }

  for (const img of article.querySelectorAll('img[src]')) {
   const src = img.getAttribute('src');
   if (!src || /^(https?:|data:|blob:|\/\/)/i.test(src)) continue;
   const target = resolvePath(current, src);
   findHandle(target).then(async h => {
    if (!h) {
     img.alt = (img.alt || 'Image') + ' (file not found)';
     return;
    }
    try {
     const f = await h.getFile();
     const url = URL.createObjectURL(f);
     objectUrls.push(url);
     img.src = url;
    } catch { /* unreadable image: leave alt text */ }
   });
  }
 }

 async function fileHandleFor(path) {
  if (!path) return null;
  if (fileMap.has(path)) return fileMap.get(path);
  const handle = await findHandle(path);
  if (!handle || handle.kind !== 'file') return null;
  fileMap.set(path, handle);
  updateCount();
  return handle;
 }

 async function findHandle(path) {
  if (!rootHandle || !path) return null;
  const parts = path.split('/');
  let h = rootHandle;
  for (let i = 0; i < parts.length; i++) {
   try {
    h = i === parts.length - 1 ? await h.getFileHandle(parts[i]) : await h.getDirectoryHandle(parts[i]);
   } catch { return null; }
  }
  return h;
 }

 /* ---------- mermaid subset ---------- */

 function renderMermaid(article) {
  for (const node of article.querySelectorAll('[data-mermaid="1"]')) {
   const svg = renderFlowchart(node.textContent);
   if (!svg) continue; // leave the source visible when unsupported
   const box = document.createElement('div');
   box.className = 'mermaid-box';
   box.appendChild(svg);
   node.replaceWith(box);
  }
 }

 function renderFlowchart(src) {
  const lines = src.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length || !/^flowchart\s+(TD|TB|LR|RL|BT)|^graph\s+(TD|TB|LR|RL|BT)/i.test(lines[0])) return null;
  const edges = [], nodes = new Map();
  const getNode = (id, label) => {
   if (!nodes.has(id)) nodes.set(id, { id, label: label || id });
   else if (label) nodes.get(id).label = label;
  };
  for (const l of lines.slice(1)) {
   const m = l.match(/^([\w-]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*(?:-->|---|==>|-.->)\s*([\w-]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?/);
   if (m) {
    const label1 = m[2] || m[3] || m[4], label2 = m[6] || m[7] || m[8];
    getNode(m[1], label1);
    getNode(m[5], label2);
    edges.push([m[1], m[5]]);
    continue;
   }
   const solo = l.match(/^([\w-]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/);
   if (solo) getNode(solo[1], solo[2] || solo[3] || solo[4]);
  }
  if (!nodes.size) return null;

  const arr = [...nodes.values()];
  const lr = /\bLR\b/i.test(lines[0]);
  const w = lr ? Math.max(680, arr.length * 170) : Math.max(420, arr.reduce((m, n) => Math.max(m, n.label.length * 8 + 60), 0));
  const h = lr ? Math.max(160, arr.reduce((m, n) => Math.max(m, n.label.length * 8 + 60), 0)) : arr.length * 90 + 30;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mermaid flowchart');

  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'mermaid-arrow');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const poly = document.createElementNS(ns, 'path');
  poly.setAttribute('d', 'M0,0 L0,6 L7,3 z');
  poly.setAttribute('fill', 'currentColor');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const pos = {};
  arr.forEach((n, i) => {
   pos[n.id] = lr
    ? { x: 30 + i * (w - 150) / Math.max(1, arr.length - 1), y: h / 2 }
    : { x: w / 2, y: 30 + i * 90 };
  });

  for (const [a, b] of edges) {
   if (!pos[a] || !pos[b]) continue;
   const line = document.createElementNS(ns, 'line');
   line.setAttribute('x1', pos[a].x + 55);
   line.setAttribute('y1', pos[a].y + 18);
   line.setAttribute('x2', pos[b].x + 55);
   line.setAttribute('y2', pos[b].y - 18);
   line.setAttribute('stroke', 'currentColor');
   line.setAttribute('stroke-width', '1.5');
   line.setAttribute('marker-end', 'url(#mermaid-arrow)');
   svg.appendChild(line);
  }

  for (const n of arr) {
   const p = pos[n.id];
   const g = document.createElementNS(ns, 'g');
   const rect = document.createElementNS(ns, 'rect');
   rect.setAttribute('x', p.x);
   rect.setAttribute('y', p.y - 20);
   rect.setAttribute('width', '110');
   rect.setAttribute('height', '40');
   rect.setAttribute('rx', '7');
   rect.setAttribute('fill', 'var(--panel)');
   rect.setAttribute('stroke', 'var(--accent)');
   const text = document.createElementNS(ns, 'text');
   text.setAttribute('x', p.x + 55);
   text.setAttribute('y', p.y + 4);
   text.setAttribute('text-anchor', 'middle');
   text.setAttribute('font-size', '12');
   text.setAttribute('fill', 'currentColor');
   text.textContent = n.label.slice(0, 24);
   g.append(rect, text);
   svg.appendChild(g);
  }
  return svg;
 }

 /* ---------- status screens ---------- */

 function showWelcome() {
  activePath = null;
  $('error').hidden = true;
  $('welcome').hidden = false;
  $('document').hidden = true;
  updateActive();
 }

 function showError(msg) {
  $('welcome').hidden = true;
  $('document').hidden = true;
  const box = $('error');
  box.hidden = false;
  box.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Something went wrong';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = msg;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Choose folder';
  b.addEventListener('click', chooseFolder);
  box.append(h, p, b);
 }

 // Chrome drops handle permissions on restart. Offer a one-click re-grant
 // instead of asking the user to re-pick the folder.
 function showReconnect(handle) {
  $('welcome').hidden = true;
  $('document').hidden = true;
  const box = $('error');
  box.hidden = false;
  box.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Folder access needs renewal';
  const p = document.createElement('p');
  p.textContent = `Chrome requires permission again to read “${handle.name}”. Your files stay on this device.`;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Grant access';
  b.addEventListener('click', async () => {
   rootHandle = handle;
   try {
    if (await permission(handle, true)) await scanFolder();
    else showError('Folder permission was not granted. Click “Choose folder” and select it again.');
   } catch (e) {
    showError('Could not re-open folder: ' + e.message);
   }
  });
  box.append(h, p, b);
 }

 /* ---------- wiring ---------- */

 $('choose').addEventListener('click', chooseFolder);
 $('choose2').addEventListener('click', chooseFolder);
 $('refresh').addEventListener('click', scanFolder);
 $('search').addEventListener('input', e => {
  searchTerm = e.target.value.trim();
  renderTree();
 });

 (async () => {
  try {
   const handle = await loadHandle();
   if (!handle) return;
   if (await permission(handle, false)) {
    rootHandle = handle;
    await scanFolder();
   } else {
    showReconnect(handle);
   }
  } catch (e) {
   console.warn(e);
  }
 })();
})();
