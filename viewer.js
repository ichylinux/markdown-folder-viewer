(() => {
 const $ = id => document.getElementById(id);
 const DB = 'markdown-folder-viewer-db', STORE = 'handles';

 let rootHandle = null;
 const fileMap = new Map();
 let activePath = null;
 let searchTerm = '';
 const collapsedPaths = new Set(); // folder paths the user has collapsed
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
   collapsedPaths.clear();
   await scanFolder();
  } catch (e) {
   if (e.name !== 'AbortError') showError('Could not open folder: ' + e.message);
  }
 }

 async function scanFolder() {
  if (!rootHandle) return;
  const ok = await permission(rootHandle, true);
  if (!ok) {
   showError('Folder permission was not granted. Click “Choose folder” and select it again.');
   return;
  }
  fileMap.clear();
  $('folderName').textContent = rootHandle.name;
  $('tree').innerHTML = '<p class="status">Scanning folder…</p>';
  try {
   await walk(rootHandle, '');
   renderTree();
   $('refresh').disabled = false;
   $('fileCount').textContent = fileMap.size + ' files';
   // Always re-open the active file: the folder may have been re-chosen, and a
   // same-named path in the new folder must not show stale content.
   const next = activePath && fileMap.has(activePath) ? activePath : [...fileMap.keys()].sort()[0];
   if (next) await openFile(next);
   else showWelcome();
  } catch (e) {
   showError('Could not read folder: ' + e.message);
  }
 }

 async function walk(dir, prefix) {
  for await (const [name, handle] of dir.entries()) {
   const path = prefix ? prefix + '/' + name : name;
   if (handle.kind === 'directory') await walk(handle, path);
   else if (/\.md(?:own)?$/i.test(name)) fileMap.set(path, handle);
  }
 }

 /* ---------- sidebar tree ---------- */

 function renderTree() {
  const tree = $('tree');
  tree.replaceChildren();

  const dirs = {};
  for (const path of fileMap.keys()) {
   const parts = path.split('/');
   let parent = dirs;
   for (let i = 0; i < parts.length; i++) {
    if (i === parts.length - 1) parent[parts[i]] = { __file: path };
    else {
     parent[parts[i]] = parent[parts[i]] || {};
     parent = parent[parts[i]];
    }
   }
  }

  const build = (obj, container, prefix) => {
   for (const name of Object.keys(obj).sort((a, b) => {
    const ad = !obj[a].__file, bd = !obj[b].__file;
    return ad === bd ? a.localeCompare(b) : ad ? -1 : 1;
   })) {
    const item = obj[name];
    const path = prefix ? prefix + '/' + name : name;

    if (item.__file) {
     if (searchTerm && !path.toLowerCase().includes(searchTerm.toLowerCase())) continue;
     const b = document.createElement('button');
     b.type = 'button';
     b.className = 'tree-row' + (activePath === path ? ' active' : '');
     b.dataset.file = '1';
     b.dataset.path = path;
     b.title = path;
     b.innerHTML = '<span class="fileicon" aria-hidden="true">📄</span><span class="filename"></span>';
     b.querySelector('.filename').textContent = name;
     b.addEventListener('click', () => openFile(path));
     container.appendChild(b);
     continue;
    }

    if (searchTerm && !hasMatching(item, path)) continue;
    const isCollapsed = collapsedPaths.has(path);
    const wrap = document.createElement('div');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tree-row';
    b.dataset.path = path;
    b.title = path;
    b.setAttribute('aria-expanded', String(!isCollapsed));
    b.innerHTML = '<span class="twisty" aria-hidden="true"></span><span aria-hidden="true">📁</span><span class="filename"></span>';
    b.querySelector('.filename').textContent = name;
    b.querySelector('.twisty').textContent = isCollapsed ? '▸' : '▾';

    const children = document.createElement('div');
    children.className = 'tree-children';
    children.hidden = isCollapsed;

    b.addEventListener('click', () => {
     const nowCollapsed = !children.hidden;
     children.hidden = nowCollapsed;
     b.setAttribute('aria-expanded', String(!nowCollapsed));
     b.querySelector('.twisty').textContent = nowCollapsed ? '▸' : '▾';
     if (nowCollapsed) collapsedPaths.add(path);
     else collapsedPaths.delete(path);
    });

    wrap.append(b, children);
    container.appendChild(wrap);
    build(item, children, path);
   }
  };

  build(dirs, tree);
  if (!tree.children.length) tree.innerHTML = '<p class="empty">No matching Markdown files.</p>';
 }

 function hasMatching(obj, path) {
  return Object.keys(obj).some(k => obj[k].__file
   ? (path + '/' + k).toLowerCase().includes(searchTerm.toLowerCase())
   : hasMatching(obj[k], path + '/' + k));
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
  const handle = fileMap.get(path);
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
   if (fileMap.has(target)) {
    a.href = '#';
    if (!a.title) a.title = target;
    a.addEventListener('click', e => { e.preventDefault(); openFile(target); });
   } else {
    a.title = 'File not found in selected folder: ' + target;
    a.classList.add('error');
    a.addEventListener('click', e => {
     e.preventDefault();
     alert('File not found in selected folder:\n' + target);
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

 async function findHandle(path) {
  if (fileMap.has(path)) return fileMap.get(path);
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
