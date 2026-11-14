/* Small self-contained Markdown renderer. No remote scripts or network requests. */
(() => {
 const esc = s => String(s)
   .replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')
   .replace(/'/g, '&#39;');

 // Emphasis is only ever applied to plain text, never to generated markup,
 // so underscores/asterisks inside URLs, code spans and link targets survive.
 const emph = s => s
   .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
   .replace(/__([^_]+)__/g, '<strong>$1</strong>')
   .replace(/\*([^*]+)\*/g, '<em>$1</em>')
   .replace(/_([^_]+)_/g, '<em>$1</em>')
   .replace(/~~([^~]+)~~/g, '<del>$1</del>');

 // Chrome strips control characters from URLs before parsing them, so do the
 // same and then refuse script-capable schemes (defense in depth: sanitize()
 // applies the same check to the rendered HTML).
 const BAD_SCHEME = /^(javascript|vbscript|data|file):/i;
 const safeUrl = u => {
   const v = String(u).replace(/[\u0000-\u001f\u007f]/g, '').trim();
   return BAD_SCHEME.test(v) ? '' : v;
 };

 const inline = (s) => {
   const stash = [];
   const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
   // NUL is used as the placeholder marker, so strip any from the source first.
   let out = esc(String(s).replace(/\u0000/g, ''));
   out = out.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
   out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
     const src = safeUrl(url);
     return keep(`<img alt="${alt}"${src ? ` src="${src}"` : ''}${title ? ` title="${title}"` : ''}>`);
   });
   out = out.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, text, url, title) => {
     const href = safeUrl(url);
     return keep(`<a${href ? ` href="${href}"` : ''}${title ? ` title="${title}"` : ''}>${emph(text)}</a>`);
   });
   out = emph(out);
   let prev = '';
   while (out !== prev) {
     prev = out;
     out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]);
   }
   return out;
 };

 function render(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let out = '', i = 0;
  const headings = [], slugCounts = {};
  const slug = s => {
    const base = s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
    const n = slugCounts[base] || 0;
    slugCounts[base] = n + 1;
    return n ? `${base}-${n}` : base;
  };
  const h = (level, txt) => {
    const id = slug(txt);
    headings.push({ level, text: txt, id });
    return `<h${level} id="${id}">${inline(txt)}</h${level}>`;
  };
  const isFence = l => /^\s*```/.test(l);
  const isAtx = l => /^\s*#{1,6}\s+/.test(l);
  const isHr = l => /^\s*([-*_]\s*){3,}$/.test(l);
  const isQuote = l => /^\s*>/.test(l);
  const isList = l => /^\s*([-*+]\s+|\d+[.)]\s+)/.test(l);
  const isTableStart = (a, b) => !!b
    && /^\s*\|?.+\|.+\|?\s*$/.test(a)
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(b);
  const isSetext = (a, b) => !!b && !!a.trim()
    && !/^\s*(#{1,6}\s|```|>|([-*+]\s+|\d+[.)]\s+))/.test(a)
    && !isHr(a)
    && /^\s*(=+|-{2,})\s*$/.test(b);
  const DETAILS_OPEN = /^\s*<details(\s+open)?\s*>\s*$/i;
  const DETAILS_CLOSE = /^\s*<\/details>\s*$/i;
  const isDetails = l => DETAILS_OPEN.test(l) || DETAILS_CLOSE.test(l);
  const isBlockStart = k => isFence(lines[k]) || isAtx(lines[k]) || isHr(lines[k]) || isDetails(lines[k])
    || isQuote(lines[k]) || isList(lines[k])
    || isTableStart(lines[k], lines[k + 1]) || isSetext(lines[k], lines[k + 1]);

  while (i < lines.length) {
   const l = lines[i];
   if (!l.trim()) { i++; continue; }

   // <details> / <summary> blocks: the tags are recognised here and re-emitted
   // as fixed markup; everything inside is still rendered as escaped Markdown.
   const dOpen = l.match(DETAILS_OPEN);
   if (dOpen) {
     i++;
     const body = [];
     let depth = 1, fenced = false;
     while (i < lines.length) {
       const x = lines[i];
       if (isFence(x)) fenced = !fenced;
       else if (!fenced) {
         if (DETAILS_OPEN.test(x)) depth++;
         else if (DETAILS_CLOSE.test(x) && --depth === 0) break;
       }
       body.push(x);
       i++;
     }
     if (i < lines.length) i++; // skip the closing tag
     let summary = '';
     let k = 0;
     while (k < body.length && !body[k].trim()) k++;
     if (k < body.length && /^\s*<summary>/i.test(body[k])) {
       const parts = [];
       let closed = false;
       while (k < body.length && !closed) {
         let s = body[k++];
         if (!parts.length) s = s.replace(/^\s*<summary>/i, '');
         const end = s.search(/<\/summary>/i);
         if (end >= 0) {
           closed = true;
           parts.push(s.slice(0, end));
           const rest = s.slice(end).replace(/<\/summary>/i, '').trim();
           if (rest) body.splice(k, 0, rest);
         } else parts.push(s);
       }
       summary = parts.map(s => s.trim()).filter(Boolean).join(' ');
       body.splice(0, k);
     }
     out += `<details${dOpen[1] ? ' open' : ''}>${summary ? `<summary>${inline(summary)}</summary>` : ''}${render(body.join('\n')).html}</details>`;
     continue;
   }

   if (isFence(l)) {
     const m = l.match(/^\s*```\s*([\w-]*)/);
     const lang = m?.[1] || '';
     i++;
     const code = [];
     while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
     if (i < lines.length) i++;
     const raw = code.join('\n');
     if (lang.toLowerCase() === 'mermaid') out += `<div class="mermaid-source" data-mermaid="1"><pre>${esc(raw)}</pre></div>`;
     else out += `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(raw)}</code></pre>`;
     continue;
   }

   const atx = l.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
   if (atx) { out += h(atx[1].length, atx[2]); i++; continue; }

   if (isSetext(l, lines[i + 1])) {
     out += h(lines[i + 1].trim().startsWith('=') ? 1 : 2, l.trim());
     i += 2;
     continue;
   }

   if (isHr(l)) { out += '<hr>'; i++; continue; }

   if (isQuote(l)) {
     const q = [];
     while (i < lines.length && isQuote(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
     out += `<blockquote>${render(q.join('\n')).html}</blockquote>`;
     continue;
   }

   if (isList(l)) {
     const ordered = /^\s*\d/.test(l);
     const tag = ordered ? 'ol' : 'ul';
     out += `<${tag}>`;
     while (i < lines.length && new RegExp('^\\s*(' + (ordered ? '\\d+[.)]' : '[-*+]') + '\\s+)').test(lines[i])) {
      out += `<li>${inline(lines[i++].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''))}</li>`;
     }
     out += `</${tag}>`;
     continue;
   }

   if (isTableStart(l, lines[i + 1])) {
     const cells = x => x.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
     const heads = cells(l);
     i += 2;
     out += '<table><thead><tr>' + heads.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
     while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
       out += '<tr>' + cells(lines[i++]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
     }
     out += '</tbody></table>';
     continue;
   }

   const para = [l.trim()];
   i++;
   while (i < lines.length && lines[i].trim() && !isBlockStart(i)) para.push(lines[i++].trim());
   out += `<p>${para.map(inline).join('<br>')}</p>`;
  }
  return { html: out, headings };
 }

 function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const allowed = new Set(['A', 'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'DEL',
    'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG', 'DIV', 'SPAN', 'DETAILS', 'SUMMARY']);
  const attrs = new Set(['href', 'src', 'alt', 'title', 'id', 'class', 'open']);
  const badScheme = /^(javascript|vbscript|data|file):/i;
  const stripControl = v => v.replace(/[\u0000-\u001f\u007f]/g, '');

  function clean(node) {
   for (const child of [...node.children]) {
    if (!allowed.has(child.tagName)) {
      child.replaceWith(doc.createTextNode(child.textContent || ''));
      continue;
    }
    for (const a of [...child.attributes]) {
      const name = a.name.toLowerCase();
      if (!attrs.has(name) || /^on/.test(name)) { child.removeAttribute(a.name); continue; }
      if (name === 'href' || name === 'src') {
        // Chrome strips tabs/newlines from URLs before parsing them, so remove
        // control characters first and only then check the scheme.
        const v = stripControl(child.getAttribute(a.name) || '').trim();
        if (!v || badScheme.test(v)) child.removeAttribute(a.name);
      }
    }
    clean(child);
   }
  }

  clean(doc.body);
  return doc.body.innerHTML;
 }

 window.MiniMarkdown = { render, sanitize, escape: esc };
})();
