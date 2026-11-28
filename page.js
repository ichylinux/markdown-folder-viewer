// Content script for file:// Markdown pages. Chrome shows such a file as
// plain text in a single <pre>; replace it with the rendered document and
// embed viewer.html as the folder tree sidebar.
(() => {
  const body = document.body;
  const pre = body && body.children.length === 1 && body.querySelector(':scope > pre');
  if (!pre) return;

  const parsed = MiniMarkdown.render(pre.textContent);
  const extOrigin = new URL(chrome.runtime.getURL('')).origin;
  // The pane asks this page to open a file. The nonce ties that message to
  // this exact iframe, so a different frame cannot steer the tab.
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const pane = document.createElement('iframe');
  pane.className = 'mfv-pane';
  pane.title = 'Markdown files';
  pane.src = chrome.runtime.getURL('viewer.html')
    + '?page=' + encodeURIComponent(location.href.split('#')[0])
    + '&nonce=' + nonce;

  const article = document.createElement('article');
  article.className = 'markdown-body mfv-document';
  article.innerHTML = MiniMarkdown.sanitize(parsed.html);
  // The renderer never emits target/rel; add them here so external links open
  // in a new tab without handing over window.opener.
  for (const a of article.querySelectorAll('a[href]')) {
    if (/^https?:/i.test(a.getAttribute('href'))) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (!a.title) a.title = a.href;
    }
  }
  MfvRender.makeToc(parsed.headings, article);
  MfvRender.renderMermaid(article);

  body.replaceChildren(pane, article);
  body.className = 'mfv-page';
  MfvRender.sidebarResizer(body, pane);
  document.title = parsed.headings[0]?.text || decodeURIComponent(location.pathname.split('/').pop());

  const reload = MfvRender.isReload();
  if (location.hash && !reload) {
    try {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    } catch { /* malformed fragment: stay at the top */ }
  }

  // Reloading (or going back) returns to where the reader was, which wins
  // over the fragment's position.
  MfvRender.scrollKeeper(article).track('mfv-scroll:' + location.href.split('#')[0], article, reload);

  // Only from the pane we created, and only for a file:// URL. The viewer
  // builds those URLs from handles inside the opened folder.
  window.addEventListener('message', e => {
    if (e.origin !== extOrigin || e.source !== pane.contentWindow) return;
    const { type, token, url } = e.data || {};
    if (type !== 'mfv-open' || token !== nonce) return;
    if (typeof url === 'string' && url.startsWith('file:///')) location.href = url;
  });
})();
