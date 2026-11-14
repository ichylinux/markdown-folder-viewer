window.MfvRender = (() => {
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

  // The document lives in an inner scroller that is filled in by script, so
  // Chrome cannot restore its position on reload. Remember it per tab instead.
  function isReload() {
    try {
      const type = performance.getEntriesByType('navigation')[0]?.type;
      return type === 'reload' || type === 'back_forward';
    } catch {
      return false;
    }
  }

  // Saves `scroller`'s position under the current key and can put it back.
  // Late layout changes (images, diagrams) would clamp the position, so the
  // target is re-applied for a short while unless the user scrolls first.
  function scrollKeeper(scroller) {
    let key = null;
    let restoring = false;
    let frame = 0;
    let stop = () => {};

    scroller.addEventListener('scroll', () => {
      if (!key || restoring || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try { sessionStorage.setItem(key, String(scroller.scrollTop)); } catch { /* storage unavailable */ }
      });
    });

    // Start tracking `content` (the scroller or its child) under `newKey`;
    // with `restore`, jump to the position saved for that key first.
    function track(newKey, content, restore) {
      stop();
      key = newKey;
      let target = 0;
      if (restore) {
        try { target = Number(sessionStorage.getItem(newKey)) || 0; } catch { /* storage unavailable */ }
      }
      if (!target) return;

      restoring = true;
      const apply = () => { if (Math.abs(scroller.scrollTop - target) > 1) scroller.scrollTop = target; };
      const observer = new ResizeObserver(apply);
      const interrupts = ['wheel', 'touchstart', 'keydown', 'mousedown'];
      const timer = setTimeout(() => stop(), 3000);
      stop = () => {
        clearTimeout(timer);
        observer.disconnect();
        for (const type of interrupts) scroller.removeEventListener(type, stop);
        restoring = false;
        stop = () => {};
      };
      for (const type of interrupts) scroller.addEventListener(type, stop, { passive: true });
      // When the content is itself the scroller its own box never resizes, so
      // watch its children too.
      observer.observe(content);
      for (const child of content.children) observer.observe(child);
      apply();
    }

    return { track };
  }

  return { makeToc, renderMermaid, isReload, scrollKeeper };
})();
