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

  // URL policy. Markdown can come from an untrusted folder (a cloned
  // repository, a downloaded attachment), so links may only be relative or use
  // an explicit web/mail scheme, and images may only point inside the
  // document's own folder. Remote images would send a request to a third party
  // the moment the file is opened (tracking pixels, IP disclosure), so they are
  // rendered as ordinary links the reader can follow on purpose.
  //
  // Chrome strips control characters from URLs before parsing them, so do the
  // same and then check the scheme (defense in depth: sanitize() applies the
  // same policy to the rendered HTML).
  const STRIP_CONTROL = /[\u0000-\u001f\u007f]/g;
  const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;
  const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
  const stripControl = u => String(u).replace(STRIP_CONTROL, '').trim();

  // Relative, http(s), mailto: and tel: only; javascript:, data:, file:,
  // blob:, chrome:, chrome-extension: and friends are dropped.
  const safeHref = u => {
      const v = stripControl(u);
      return v && HAS_SCHEME.test(v) && !SAFE_SCHEME.test(v) ? '' : v;
  };

  // Same-folder relative path only: a scheme or a leading slash (including
  // //host) would reach the network or the filesystem root.
  const safeSrc = u => {
      const v = stripControl(u);
      return !v || HAS_SCHEME.test(v) || /^[\\/]/.test(v) ? '' : v;
  };

  const inline = (s) => {
      const stash = [];
      const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
      // NUL is used as the placeholder marker, so strip any from the source first.
      let out = esc(String(s).replace(/\u0000/g, ''));
      out = out.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
      out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
          const src = safeSrc(url);
          const attr = title ? ` title="${title}"` : '';
          if (src) return keep(`<img alt="${alt}" src="${src}"${attr}>`);
          // Nothing is loaded for images outside the folder; an http(s) image
          // stays reachable as a normal link instead of becoming a beacon.
          const href = safeHref(url);
          return href ? keep(`<a href="${href}"${attr}>${alt || href}</a>`) : keep(alt);
      });
      out = out.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, text, url, title) => {
          const href = safeHref(url);
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

  // A crafted document can nest <details> or ">" thousands of times; stop
  // recursing and show the rest as plain text instead of overflowing the stack
  // (a denial of service against the viewer tab).
  const MAX_DEPTH = 32;

  function render(src, depth = 0) {
    if (depth > MAX_DEPTH) return { html: `<pre>${esc(src)}</pre>`, headings: [] };
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
    const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
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
    const isBlockStart = k => isFence(lines[k]) || isAtx(lines[k]) || isHr(lines[k]) || isDetails(lines[k]) || /^\s*<!--/.test(lines[k])
        || isQuote(lines[k]) || isList(lines[k])
        || isTableStart(lines[k], lines[k + 1]) || isSetext(lines[k], lines[k + 1]);

    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }

      // HTML comments (single or multi-line) are not rendered.
      if (/^\s*<!--/.test(l)) {
          while (i < lines.length && !/-->/.test(lines[i])) i++;
          i++;
          continue;
      }

      // <details> / <summary> blocks: the tags are recognised here and re-emitted
      // as fixed markup; everything inside is still rendered as escaped Markdown.
      const dOpen = l.match(DETAILS_OPEN);
      if (dOpen) {
          i++;
          const body = [];
          let level = 1, fenced = false;
          while (i < lines.length) {
              const x = lines[i];
              if (isFence(x)) fenced = !fenced;
              else if (!fenced) {
                  if (DETAILS_OPEN.test(x)) level++;
                  else if (DETAILS_CLOSE.test(x) && --level === 0) break;
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
          out += `<details${dOpen[1] ? ' open' : ''}>${summary ? `<summary>${inline(summary)}</summary>` : ''}${render(body.join('\n'), depth + 1).html}</details>`;
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
          out += `<blockquote>${render(q.join('\n'), depth + 1).html}</blockquote>`;
          continue;
      }

      const first = l.match(LIST_ITEM);
      if (first) {
          const ordered = /\d/.test(first[2]);
          const tag = ordered ? 'ol' : 'ul';
          const base = first[1].length;
          const indentOf = x => x.match(/^\s*/)[0].length;
          const sameList = m => !!m && m[1].length === base && /\d/.test(m[2]) === ordered;
          const start = ordered ? parseInt(first[2], 10) : 1;
          const items = [];
          let loose = false;
          // Lines indented past the marker belong to the item (continuation
          // text, nested lists); a blank line only ends the list if what follows
          // is neither indented nor another item of this list.
          while (i < lines.length) {
              const m = lines[i].match(LIST_ITEM);
              if (!sameList(m)) break;
              const contentCol = m[1].length + m[2].length + m[3].length;
              const body = [m[4]];
              i++;
              while (i < lines.length) {
                  const x = lines[i];
                  if (!x.trim()) {
                      let k = i;
                      while (k < lines.length && !lines[k].trim()) k++;
                      if (k >= lines.length) { i = k; break; }
                      if (indentOf(lines[k]) > base) {
                          loose = true;
                          while (i < k) { body.push(''); i++; }
                          continue;
                      }
                      if (sameList(lines[k].match(LIST_ITEM))) { loose = true; i = k; }
                      break;
                  }
                  if (indentOf(x) <= base) break;
                  body.push(x.slice(Math.min(indentOf(x), contentCol)));
                  i++;
              }
              items.push(body.join('\n'));
          }
          out += ordered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
          for (const body of items) {
              const inner = render(body, depth + 1).html;
              out += `<li>${loose ? inner : inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`;
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

  // Exactly the tags the renderer emits. Anything else is reduced to its text,
  // so a crafted document cannot smuggle markup or event handlers in.
  const ALLOWED_TAGS = new Set(['A', 'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'DEL',
      'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG', 'DIV', 'DETAILS', 'SUMMARY']);
  const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  // Attributes are allowed per element: ids only on headings (so no DOM
  // clobbering), classes only where the renderer puts them (language-* on code,
  // mermaid-source on the diagram wrapper) and URLs only inside the folder or
  // on a safe link scheme.
  const ALLOWED_ATTRS = new Map([
      ['A', new Set(['href', 'title'])],
      ['IMG', new Set(['src', 'alt', 'title'])],
      ['CODE', new Set(['class'])],
      ['DIV', new Set(['class', 'data-mermaid'])],
      ['DETAILS', new Set(['open'])],
      ['OL', new Set(['start'])],
      ...[...HEADINGS].map(h => [h, new Set(['id'])]),
  ]);

  function attrAllowed(tag, name, value) {
      const allowed = ALLOWED_ATTRS.get(tag);
      if (!allowed || !allowed.has(name) || /^on/.test(name)) return false;
      if (name === 'href') return !!value && safeHref(value) === value;
      if (name === 'src') return !!value && safeSrc(value) === value;
      if (name === 'id') return /^[\p{L}\p{N}_-]+$/u.test(value);
      if (name === 'class') {
          return tag === 'CODE' ? /^language-[a-z0-9_+-]+$/i.test(value) : value === 'mermaid-source';
      }
      if (name === 'data-mermaid') return value === '1';
      if (name === 'start') return /^\d{1,9}$/.test(value);
      return true;
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

    function clean(node) {
      for (const child of [...node.children]) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
            child.replaceWith(doc.createTextNode(child.textContent || ''));
            continue;
        }
        for (const a of [...child.attributes]) {
            if (!attrAllowed(child.tagName, a.name.toLowerCase(), a.value)) {
                child.removeAttribute(a.name);
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
