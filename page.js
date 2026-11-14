// Content script for file:// Markdown pages. Chrome shows such a file as
// plain text in a single <pre>; replace it with the rendered document and
// embed viewer.html as the folder tree sidebar.
(() => {
  const body = document.body;
  const pre = body && body.children.length === 1 && body.querySelector(':scope > pre');
  if (!pre) return;

  const parsed = MiniMarkdown.render(pre.textContent);
  const extOrigin = new URL(chrome.runtime.getURL('')).origin;

  const pane = document.createElement('iframe');
  pane.className = 'mfv-pane';
  pane.title = 'Markdown files';
  pane.src = chrome.runtime.getURL('viewer.html') + '?page=' + encodeURIComponent(location.href.split('#')[0]);

  const article = document.createElement('article');
  article.className = 'markdown-body mfv-document';
  article.innerHTML = MiniMarkdown.sanitize(parsed.html);
  MfvRender.makeToc(parsed.headings, article);
  MfvRender.renderMermaid(article);

  body.replaceChildren(pane, article);
  body.className = 'mfv-page';
  document.title = parsed.headings[0]?.text || decodeURIComponent(location.pathname.split('/').pop());

  if (location.hash) {
    try {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    } catch { /* malformed fragment: stay at the top */ }
  }

  // Reloading (or going back) returns to where the reader was, which wins
  // over the fragment's position.
  MfvRender.scrollKeeper(article).track('mfv-scroll:' + location.href.split('#')[0], article, MfvRender.isReload());

  window.addEventListener('message', e => {
    if (e.origin !== extOrigin || e.source !== pane.contentWindow) return;
    const { type, url } = e.data || {};
    if (type === 'mfv-open' && typeof url === 'string' && url.startsWith('file:///')) location.href = url;
  });
})();
