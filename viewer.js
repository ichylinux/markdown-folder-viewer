(() => {
  const $ = id => document.getElementById(id);
  const { save: saveHandle, load: loadHandle, permission } = MfvHandles;
  const { makeToc, renderMermaid } = MfvRender;
  const scrollKeeper = MfvRender.scrollKeeper(document.querySelector('.reader'));
  let restoreScroll = MfvRender.isReload(); // only the first file shown after a reload
  const channel = new BroadcastChannel('markdown-folder-viewer');

  // Pane mode: viewer.html is embedded as the sidebar of a file:// Markdown
  // page (see page.js). Only the tree is shown, and opening a file asks the
  // host page to navigate to its file:// URL.
  const hostUrl = new URLSearchParams(location.search).get('page');
  const hostToken = new URLSearchParams(location.search).get('nonce') || '';
  const embedded = !!hostUrl;
  let hostRoot = null; // absolute disk path of rootHandle, derived from hostUrl
  const hostPath = embedded ? safeDecode(new URL(hostUrl).pathname) : null;
  const hostDir = hostPath && hostPath.slice(0, hostPath.lastIndexOf('/'));
  let savedFolders = []; // [{ path, handle }] remembered with their disk location
  let awaitingPicker = false; // this pane opened the picker window
  let pendingRemember = false; // the picked folder should be saved once verified
  let openingEntry = null; // saved folder being opened from the pane
  let adopted = false;
  let recentEntry = null; // start page: the last opened folder, listed with the saved ones
  const startPage = !embedded && new URLSearchParams(location.search).get('start') === '1';

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
  const FILTER_KEY = 'filter'; // sidebar filter, kept across reloads
  const SAVED_COLLAPSED_KEY = 'savedCollapsed';

  /* ---------- folder selection and scanning ---------- */

  // Chrome refuses to show a directory picker from a cross-origin iframe, so
  // the pane delegates picking (and re-granting) to a small top-level window.
  // Only the pane that opened it reacts to the result, so panes in other tabs
  // never navigate away on their own.
  function openPicker(mode) {
    awaitingPicker = true;
    window.open('pick.html' + (mode ? '?mode=' + mode : ''), 'mfv-pick', 'popup,width=480,height=280');
  }

  function resetTree() {
    treeGeneration++;
    fileMap.clear();
    dirs.clear();
    dirHandles.clear();
    loadingDirs.clear();
    expandedPaths.clear();
  }

  // The initial load only reads the top level. Subfolders are
  // scanned the first time the user expands them, so a large tree never pays
  // for a full recursive walk up front.
  async function scanFolder() {
    if (!rootHandle) return;
    const ok = await permission(rootHandle, !embedded);
    if (!ok) {
      showError(embedded
        ? 'Folder permission was not granted.'
        : 'Folder permission was not granted. Open a file from this folder in Chrome again to grant access.');
      return;
    }
    resetTree();
    dirHandles.set('', rootHandle);
    $('folderName').textContent = rootHandle.name;
    $('tree').innerHTML = '<p class="status">Scanning folder…</p>';
    try {
      await readDir('', rootHandle);
      if (embedded) {
        await revealHostFile();
        return;
      }
      renderTree();
      // Always re-open the active file: the folder may have been re-chosen, and a
      // same-named path in the new folder must not show stale content. Nested
      // files are resolved directly, even though their folder is still collapsed.
      const next = (await fileHandleFor(activePath)) ? activePath : pickInitialPath();
      if (next) await openFile(next, { push: false });
      else showWelcome();
      await updateLocationNote();
    } catch (e) {
      showError('Could not read folder: ' + e.message);
    }
  }

  // The folder picker only reveals the folder's name, so its disk location is
  // inferred from the host page URL: the deepest ancestor with that name that
  // really contains the open file wins.
  async function locateHostFile() {
    const segs = hostPath.split('/').filter(Boolean);
    for (let i = segs.length - 2; i >= 0; i--) {
      if (segs[i] !== rootHandle.name) continue;
      const rel = segs.slice(i + 1).join('/');
      if (await fileHandleFor(rel)) return { root: '/' + segs.slice(0, i + 1).join('/'), rel };
    }
    return null;
  }

  // Each navigation reloads the pane, so the expanded folders are kept per
  // root and restored together with the open file's ancestors.
  function expandedKey() {
    return 'expanded:' + hostRoot;
  }

  // The filter survives reloads (and the pane's per-navigation reloads) so a
  // narrow view is not lost whenever a file is opened.
  function saveFilter() {
    try {
      if (searchTerm) localStorage.setItem(FILTER_KEY, searchTerm);
      else localStorage.removeItem(FILTER_KEY);
    } catch { /* storage unavailable: the filter stays in memory */ }
  }

  function restoreFilter() {
    try {
      return localStorage.getItem(FILTER_KEY) || '';
    } catch {
      return '';
    }
  }

  function saveExpanded() {
    if (embedded && hostRoot) localStorage.setItem(expandedKey(), JSON.stringify([...expandedPaths]));
  }

  // The deepest saved folder that contains the open file, if any.
  function coveringEntry() {
    return savedFolders
      .filter(entry => hostDir === entry.path || hostDir.startsWith(entry.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0] || null;
  }

  // Opening a file under a saved folder from the address bar switches the
  // pane to that folder. Done at most once per page so a folder that no longer
  // matches its saved location cannot cause a loop.
  async function adoptCoveringFolder() {
    const entry = coveringEntry();
    if (adopted || !entry) return false;
    if (rootHandle && await entry.handle.isSameEntry(rootHandle).catch(() => false)) return false;
    adopted = true;
    rootHandle = entry.handle;
    await saveHandle(entry.handle);
    if (await permission(entry.handle, false)) await scanFolder();
    else showReconnect(entry.handle);
    return true;
  }

  // A saved folder opened from the pane usually does not contain the current
  // page; its location is known, so go to its landing page.
  function revealSavedFolder(entry) {
    hostRoot = entry.path;
    activePath = null;
    const initial = pickInitialPath();
    if (initial) {
      openFile(initial);
      return;
    }
    $('error').hidden = true;
    renderTree();
    renderSaved();
  }

  async function revealHostFile() {
    const opening = openingEntry;
    const remembering = pendingRemember;
    openingEntry = null;
    pendingRemember = false;
    const found = await locateHostFile();
    if (!found) {
      if (opening) {
        revealSavedFolder(opening);
        return;
      }
      if (await adoptCoveringFolder()) return;
      hostRoot = activePath = null;
      $('folderName').textContent = '';
      $('fileCount').textContent = '';
      showUnsaved(remembering
        ? `“${rootHandle.name}” does not contain the Markdown file you are viewing, so it was not saved. Choose the folder that contains it instead.`
        : 'This file is not in a saved folder.');
      $('error').hidden = true;
      renderSaved();
      return;
    }
    hostRoot = found.root;
    activePath = found.rel;
    $('error').hidden = true;
    // Remember the discovered disk location even when the reader did not ask:
    // with it, later sessions (including the toolbar popup flow) open files as
    // file:// pages and the address bar shows the real path.
    const known = savedFolders.some(entry => entry.path === hostRoot);
    if (remembering || !known) {
      const list = [...savedFolders.filter(entry => entry.path !== hostRoot), { path: hostRoot, handle: rootHandle }];
      try {
        await storeSaved(list);
      } catch (e) {
        // A storage failure must not stop the document from rendering.
        console.warn('Could not remember ' + hostRoot, e);
        renderSaved();
      }
    } else {
      renderSaved();
    }
    const parts = activePath.split('/');
    const wanted = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    try {
      wanted.push(...JSON.parse(localStorage.getItem(expandedKey()) || '[]'));
    } catch { /* corrupt entry: start collapsed */ }
    const gen = treeGeneration;
    for (const path of [...new Set(wanted)].sort((a, b) => a.split('/').length - b.split('/').length)) {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if ((parent === '' || expandedPaths.has(parent)) && await ensureDir(path)) expandedPaths.add(path);
    }
    if (gen !== treeGeneration) return;
    renderTree();
    $('tree').querySelector('.tree-row.active')?.scrollIntoView({ block: 'center' });
  }

  function fileUrl(root, path) {
    return 'file://' + (root + '/' + path).split('/').map(encodeURIComponent).join('/');
  }

  function hostFileUrl(path) {
    return fileUrl(hostRoot, path);
  }

  // Any top-level page: a folder that is also a saved one has a known disk
  // location, so its files are opened as file:// pages (address bar shows the
  // file URL). Folders whose location is unknown (picked through the picker
  // only, which hides the path) stay in this viewer.
  async function savedRootPath() {
    if (!rootHandle) return null;
    for (const entry of savedFolders) {
      if (!entry.path.startsWith('/')) continue;
      if (await entry.handle.isSameEntry(rootHandle).catch(() => false)) return entry.path;
    }
    return null;
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
      saveExpanded();
      return;
    }

    if (dirs.has(path)) {
      expandedPaths.add(path);
      saveExpanded();
      children.replaceChildren();
      buildLevel(path, children);
      return;
    }

    children.replaceChildren(statusRow('Scanning folder…'));
    const ok = await ensureDir(path);
    if (children.hidden) return; // collapsed again while scanning
    expandedPaths.add(path);
    saveExpanded();
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

  function pathFromUrl() {
    return new URLSearchParams(location.search).get('file') || null;
  }

  // Keep '/' readable in the address bar; everything else is escaped so '#',
  // '?' and '&' in file names cannot break the URL. Other parameters (such as
  // the start page flag) are kept, so a reload does not change the page mode.
  function setUrlPath(path, push) {
    if (pathFromUrl() === path) return;
    const params = new URLSearchParams(location.search);
    if (path) params.set('file', path);
    else params.delete('file');
    const query = params.toString().replace(/%2F/g, '/');
    const url = location.pathname + (query ? '?' + query : '');
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  async function openFile(path, { push = true } = {}) {
    const handle = await fileHandleFor(path);
    if (!handle) return;
    if (embedded) {
      // The host page checks origin, source frame and this token before it
      // navigates, so no other frame can steer the tab.
      window.parent.postMessage({ type: 'mfv-open', url: hostFileUrl(path), token: hostToken }, '*');
      return;
    }
    // The address bar shows the real path whenever the folder's disk location
    // is known; otherwise the document is rendered here.
    const root = await savedRootPath();
    if (root) {
      location.href = fileUrl(root, path);
      return;
    }
    try {
      const file = await handle.getFile();
      const src = await file.text();
      const parsed = MiniMarkdown.render(src);
      revokeObjectUrls();
      activePath = path;
      setUrlPath(path, push);
      $('welcome').hidden = true;
      $('error').hidden = true;
      const article = $('document');
      article.hidden = false;
      article.innerHTML = MiniMarkdown.sanitize(parsed.html);
      makeToc(parsed.headings, article);
      resolveLinks(article, path);
      renderMermaid(article);
      updateActive();
      scrollKeeper.track('mfv-scroll:' + path, article, restoreScroll);
      restoreScroll = false;
    } catch (e) {
      showError('Could not read file: ' + e.message);
    }
  }

  function revokeObjectUrls() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
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
      // Images are folder-relative only (sanitize() enforces the same rule).
      // A scheme or a root-relative path would leave the device, so drop it
      // instead of letting the browser fetch it.
      if (!src || /^[a-z][a-z0-9+.\-]*:/i.test(src) || /^[\\/]/.test(src)) {
        img.removeAttribute('src');
        continue;
      }
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

  /* ---------- status screens ---------- */

  // Tell the reader why the address bar is a viewer URL: the folder was chosen
  // through the picker, which does not reveal its disk location. Opening any
  // file from the folder as a file:// page records it automatically.
  async function updateLocationNote() {
    const note = $('locationNote');
    if (embedded || !rootHandle) {
      note.hidden = true;
      return;
    }
    const known = !!(await savedRootPath());
    note.hidden = known;
    note.textContent = known ? '' : 'The address bar keeps a viewer URL: this folder\u2019s location is not recorded yet. Open one of its .md files directly in Chrome (file://) once to record it.';
  }

  function showWelcome() {
    $('locationNote').hidden = true;
    activePath = null;
    setUrlPath(null, false);
    $('error').hidden = true;
    $('welcome').hidden = false;
    $('document').hidden = true;
    updateActive();
  }

  function showError(msg) {
    $('locationNote').hidden = true;
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
    box.append(h, p);
  }

  /* ---------- saved folders (pane only) ---------- */

  function savedTitle(text) {
    const title = document.createElement('div');
    title.className = 'saved-title';
    title.textContent = text;
    return title;
  }

  // The pane reloads on every navigation, so the collapsed state is stored.
  function savedCollapsed() {
    try {
      return localStorage.getItem(SAVED_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function savedToggle(list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'saved-title saved-toggle';
    b.innerHTML = '<span class="twisty" aria-hidden="true"></span><span>Saved folders</span>';
    const sync = () => {
      b.setAttribute('aria-expanded', String(!list.hidden));
      b.querySelector('.twisty').textContent = list.hidden ? '▸' : '▾';
    };
    sync();
    b.addEventListener('click', () => {
      list.hidden = !list.hidden;
      sync();
      try {
        if (list.hidden) localStorage.setItem(SAVED_COLLAPSED_KEY, '1');
        else localStorage.removeItem(SAVED_COLLAPSED_KEY);
      } catch { /* storage unavailable: the state stays in memory */ }
    });
    return b;
  }

  function savedRow(entry, removable) {
    const row = document.createElement('div');
    row.className = 'saved-row';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tree-row';
    // A last-used folder only has a name until its location is learned from a
    // file:// page, so it gets no absolute path in the tooltip.
    open.title = entry.path.startsWith('/') ? entry.path : 'Last used folder — location not recorded yet';
    open.innerHTML = '<span aria-hidden="true">📁</span><span class="filename"></span>';
    open.querySelector('.filename').textContent = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    open.addEventListener('click', () => openSaved(entry));
    row.append(open);
    if (!removable) return row;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'saved-remove';
    remove.title = 'Forget ' + entry.path;
    remove.setAttribute('aria-label', remove.title);
    remove.textContent = '×';
    remove.addEventListener('click', () => forgetFolder(entry));
    row.append(remove);
    return row;
  }

  function renderSaved() {
    const box = $('saved');
    box.hidden = false;
    box.replaceChildren();
    if (hostRoot && activePath && !coveringEntry()) box.appendChild(rememberButton());
    if (savedFolders.length) {
      const list = document.createElement('div');
      list.hidden = savedCollapsed();
      for (const entry of savedFolders) list.appendChild(savedRow(entry, true));
      box.append(savedToggle(list), list);
    }
    // The last-used folder may never have been opened as a file:// page, so it
    // is not a saved folder and cannot drive file:// navigation yet.
    if (recentEntry) {
      box.appendChild(savedTitle('Last used'));
      box.appendChild(savedRow(recentEntry, false));
    }
  }

  function rememberButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'remember';
    b.title = hostDir;
    b.textContent = '📌 Remember this folder';
    b.addEventListener('click', rememberCurrent);
    return b;
  }

  // No tree for this file: explain why, with the way to get one right below.
  function showUnsaved(note) {
    $('tree').replaceChildren(statusRow(note), rememberButton());
  }

  async function storeSaved(list) {
    savedFolders = list.sort((a, b) => a.path.localeCompare(b.path));
    await saveHandle(savedFolders, 'saved');
    renderSaved();
  }

  // Save the open file's parent folder. If the current folder does not
  // contain the file, the user picks it; revealHostFile saves it only after
  // confirming it contains the open file.
  async function rememberCurrent() {
    if (hostRoot && activePath) {
      const dir = activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : '';
      const handle = dir ? await findHandle(dir) : rootHandle;
      if (handle) await storeSaved([...savedFolders, { path: hostDir, handle }]);
      return;
    }
    pendingRemember = true;
    openPicker('remember');
  }

  async function forgetFolder(entry) {
    await storeSaved(savedFolders.filter(e => e !== entry));
    // Otherwise the next load reopens it as the last folder and, since it
    // contains the open file, remembers it again.
    const last = await loadHandle();
    if (last && await entry.handle.isSameEntry(last).catch(() => false)) await saveHandle(null);
    updateLocationNote();
  }

  async function openSaved(entry) {
    openingEntry = entry;
    rootHandle = entry.handle;
    await saveHandle(entry.handle);
    let granted = false;
    try {
      granted = await permission(entry.handle, true);
    } catch { /* no prompt from this frame: fall back to the window */ }
    if (granted) await scanFolder();
    else if (embedded) openPicker('grant');
    else showReconnect(entry.handle);
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
      let granted = false, error = null;
      try {
        granted = await permission(handle, true);
      } catch (e) {
        error = e;
      }
      if (granted) await scanFolder();
      else if (embedded) openPicker('grant');
      else if (error) showError('Could not re-open folder: ' + error.message);
      else showError('Folder permission was not granted. Open a file from this folder in Chrome again to grant access.');
    });
    box.append(h, p, b);
  }

  /* ---------- wiring ---------- */

  $('search').addEventListener('input', e => {
    searchTerm = e.target.value.trim();
    saveFilter();
    renderTree();
  });
  searchTerm = restoreFilter();
  $('search').value = searchTerm;
  window.addEventListener('popstate', () => {
    const path = pathFromUrl();
    if (path && path !== activePath) openFile(path, { push: false });
  });
  async function loadSavedFolders() {
    savedFolders = (await loadHandle('saved')) || [];
    if (startPage) {
      const last = await loadHandle();
      recentEntry = null;
      if (last) {
        const dup = await Promise.all(savedFolders.map(e => e.handle.isSameEntry(last).catch(() => false)));
        if (!dup.some(Boolean)) recentEntry = { path: last.name, handle: last };
      }
    }
    // The list belongs to the pane and the start page. A plain viewer only uses
    // the entries to turn clicks into file:// navigation.
    if (embedded || startPage) renderSaved();
  }

  async function reloadSavedFolder() {
    await loadSavedFolders();
    const handle = await loadHandle();
    if (!handle) return;
    rootHandle = handle;
    if (await permission(handle, false)) await scanFolder();
    else showReconnect(handle);
  }
  channel.addEventListener('message', e => {
    if (!awaitingPicker || e.data?.type !== 'root-changed') return;
    awaitingPicker = false;
    reloadSavedFolder();
  });

  if (embedded) {
    document.body.classList.add('embedded');
    $('tree').before($('error'));
    showUnsaved('This file is not in a saved folder.');
  } else {
    MfvRender.sidebarResizer(document.querySelector('.layout'), document.querySelector('.sidebar'));
  }

  (async () => {
    activePath = embedded ? null : pathFromUrl();
    // Top page (opened from the toolbar popup) without a file: do not reopen
    // the previous folder, just list the saved folders and explain how to open
    // a Markdown file in Chrome. A file in the URL (the reader was reloaded) is
    // restored like on any other viewer page.
    if (startPage && !activePath) {
      await loadSavedFolders().catch(console.warn);
      return;
    }
    try {
      await loadSavedFolders();
      const handle = await loadHandle();
      if (!handle) {
        if (embedded) await adoptCoveringFolder();
        return;
      }
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
