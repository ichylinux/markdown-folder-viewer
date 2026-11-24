// Runs after page.js and turns the resulting DOM into the same
// { cases: [{ name, problems }] } shape the other DOM checks use.
(() => {
  const problems = [];
  const article = document.querySelector('article.mfv-markdown, article.mfv-document');
  const pane = document.querySelector('iframe.mfv-pane');

  if (!article) problems.push('rendered article missing');
  if (!pane) problems.push('sidebar iframe missing');
  if (!document.body.classList.contains('mfv-page')) problems.push('body.mfv-page not set');
  if (document.title !== 'E2E Heading') problems.push('document title: ' + document.title);

  if (article) {
    if (article.querySelector('h1')?.textContent !== 'E2E Heading') problems.push('heading missing');
    if (article.querySelector('[onerror], [onclick], script, iframe, style')) problems.push('raw HTML became markup');
    const external = article.querySelector('a[href="https://example.com/x"]');
    if (!external) problems.push('external link missing');
    else {
      if (external.target !== '_blank') problems.push('external link has no target=_blank');
      if (external.rel !== 'noopener noreferrer') problems.push('external link rel: ' + external.rel);
    }
    if (!article.querySelector('a[href="https://tracker.example/p.png"]')) problems.push('remote image is not a link');
    if (article.querySelector('img[src^="http"]')) problems.push('remote image src kept');
    if (!article.querySelector('img[src="sub/pic.png"]')) problems.push('folder-relative image lost');
    if (!article.querySelector('a[href="sub/other.md"]')) problems.push('relative link lost');
  }

  const resizer = document.querySelector('.mfv-resizer');
  if (!resizer) problems.push('sidebar resizer missing');
  else if (pane) {
    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    const wide = pane.getBoundingClientRect().width;
    resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    if (wide !== 354) problems.push('resizer did not widen the pane: ' + wide);
    if (pane.getBoundingClientRect().width !== 290) problems.push('double-click did not reset the pane');
    if (Math.abs(resizer.getBoundingClientRect().left + 3 - 290) > 1) problems.push('resizer is not on the boundary');
  }

  const src = pane?.getAttribute('src') || '';
  try {
    const url = new URL(src);
    if (url.protocol !== 'chrome-extension:') problems.push('pane src scheme: ' + src.slice(0, 40));
    if (!src.includes('/viewer.html?')) problems.push('pane points elsewhere: ' + src.slice(0, 80));
    const page = src.match(/[?&]page=([^&]+)/);
    if (!page || !decodeURIComponent(page[1]).startsWith('file:')) problems.push('pane page param');
    const nonce = src.match(/[?&]nonce=([^&]+)/);
    if (!nonce || !/^[0-9a-f]{32}$/.test(nonce[1])) problems.push('pane nonce missing or malformed');
  } catch (e) {
    problems.push('pane src is not a URL: ' + e.message);
  }

  const out = document.createElement('pre');
  out.id = 'result';
  out.textContent = JSON.stringify({
    cases: [{ name: 'page:content-script', problems, output: (document.body.innerHTML || '').slice(0, 300) }],
  });
  document.body.appendChild(out);
})();
