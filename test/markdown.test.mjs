// markdown.js is a browser script that publishes window.MiniMarkdown.
// The stub window lets it load under Node; sanitize() needs a real DOM and is
// therefore not covered here (it is exercised in the browser).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
await import('../markdown.js');
const { render } = globalThis.window.MiniMarkdown;

const html = src => render(src).html;

test('underscores in link targets are not turned into emphasis', () => {
  const out = html('see [doc](https://example.com/my_file_name_en.md)');
  assert.match(out, /<a href="https:\/\/example\.com\/my_file_name_en\.md">doc<\/a>/);
  assert.doesNotMatch(out, /<em>/);
});

test('asterisks in link targets are preserved', () => {
  const out = html('[x](https://e.com/a*b*c)');
  assert.match(out, /href="https:\/\/e\.com\/a\*b\*c"/);
  assert.doesNotMatch(out, /<em>/);
});

test('underscores inside inline code are preserved', () => {
  const out = html('run `my_var_name` now');
  assert.equal(out, '<p>run <code>my_var_name</code> now</p>');
});

test('emphasis inside link text still works', () => {
  const out = html('[**bold** text](https://e.com/a_b)');
  assert.match(out, /<a href="https:\/\/e\.com\/a_b"><strong>bold<\/strong> text<\/a>/);
});

test('code span inside link text is preserved', () => {
  const out = html('[see `a_b`](x.md)');
  assert.match(out, /<a href="x\.md">see <code>a_b<\/code><\/a>/);
});

test('html in the source is escaped, never emitted as markup', () => {
  const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<img/i);
  assert.match(out, /&lt;script&gt;/);
});

test('script-capable url schemes are dropped at render time', () => {
  const out = html('[x](javascript:alert) and ![y](data:image/png;base64,AA)');
  assert.doesNotMatch(out, /href=/);
  assert.doesNotMatch(out, /src=/);
  assert.match(out, /<a>x<\/a>/);
});

test('control characters cannot smuggle a scheme past the check', () => {
  const out = html('[x](java\tscript:alert)');
  assert.doesNotMatch(out, /href="javascript:/i);
});

test('normal relative and http links keep their href', () => {
  assert.match(html('[a](x.md)'), /href="x\.md"/);
  assert.match(html('[b](https://e.com/?a=1&b=2)'), /href="https:\/\/e\.com\/\?a=1&amp;b=2"/);
});

test('horizontal rule after a paragraph line is treated as a setext heading', () => {
  assert.equal(html('Title\n---'), '<h2 id="title">Title</h2>');
});

test('horizontal rule after a blank line is an <hr>', () => {
  assert.equal(html('text\n\n---'), '<p>text</p><hr>');
});

test('setext heading levels', () => {
  assert.equal(html('Big\n==='), '<h1 id="big">Big</h1>');
  assert.equal(html('Small\n---'), '<h2 id="small">Small</h2>');
});

test('table directly after a paragraph is not swallowed', () => {
  const out = html('intro\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(out, /<p>intro<\/p><table>/);
});

test('atx headings get unique ids and feed the table of contents', () => {
  const { html: out, headings } = render('# One\n\n# One\n\n## Two');
  assert.deepEqual(headings.map(h => h.id), ['one', 'one-1', 'two']);
  assert.match(out, /<h1 id="one">One<\/h1>/);
});

test('fenced code is escaped and keeps its language class', () => {
  const out = html('```js\nconst a = "<b>" ;\n```');
  assert.match(out, /<pre><code class="language-js">const a = &quot;&lt;b&gt;&quot; ;<\/code><\/pre>/);
});

test('mermaid fences are marked for the flowchart renderer', () => {
  const out = html('```mermaid\nflowchart TD\nA[Start] --> B[End]\n```');
  assert.match(out, /data-mermaid="1"/);
  assert.match(out, /A\[Start\] --&gt; B\[End\]/);
});

test('lists, quotes and ordered lists render', () => {
  assert.equal(html('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(html('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(html('> quoted'), '<blockquote><p>quoted</p></blockquote>');
});

test('paragraph line breaks use <br>', () => {
  assert.equal(html('line1\nline2'), '<p>line1<br>line2</p>');
});

test('windows and mac line endings are normalized', () => {
  assert.equal(html('# A\r\n\r\ntext\rtext'), '<h1 id="a">A</h1><p>text<br>text</p>');
});

test('details/summary blocks render as collapsible markup', () => {
  const out = html('<details>\n<summary>✅ v1 — <b>x</b></summary>\n\n- [x] item\n\n</details>');
  assert.equal(out, '<details><summary>✅ v1 — &lt;b&gt;x&lt;/b&gt;</summary><ul><li>[x] item</li></ul></details>');
});

test('details supports open attribute, nesting and fenced </details>', () => {
  const out = html('<details open>\n<summary>a</summary>\n<details>\n<summary>b</summary>\ntext\n</details>\n```\n</details>\n```\n</details>\n\nafter');
  assert.match(out, /^<details open><summary>a<\/summary><details><summary>b<\/summary><p>text<\/p><\/details><pre><code>&lt;\/details&gt;<\/code><\/pre><\/details><p>after<\/p>$/);
});

test('unclosed details does not swallow the render', () => {
  assert.equal(html('<details>\n<summary>s</summary>\nbody'), '<details><summary>s</summary><p>body</p></details>');
});
