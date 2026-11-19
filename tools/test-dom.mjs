// Runs the browser-side tests under test/dom/ with headless Chrome:
//
//   test/dom/sanitize.html  renderer escaping, URL policy, sanitizer, mXSS
//   test/dom/page.html      the file:// content script (page.js) end to end
//
//   node tools/test-dom.mjs                 # skips with a notice without Chrome
//   REQUIRE_DOM=1 node tools/test-dom.mjs   # fail instead of skipping (CI)
//   CHROME=/path/to/chrome node tools/test-dom.mjs
//
// The pages need a real DOM (DOMParser, FileSystem handles, chrome.*), so they
// cannot run under node --test; this runner is the node-friendly wrapper.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

const unescapeHtml = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

function runPage(chrome, file) {
  const profile = mkdtempSync(join(tmpdir(), 'mfv-dom-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=8000',
    '--dump-dom',
    'file://' + join(ROOT, 'test', 'dom', file),
  ];
  const run = spawnSync(chrome, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  rmSync(profile, { recursive: true, force: true });

  const match = (run.stdout || '').match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!match) {
    const errors = (run.stderr || '').split('\n').filter((l) => /ERROR|FATAL/.test(l)).slice(-5);
    return {
      file,
      error: `did not report a result (chrome exit ${run.status}${run.error ? ', ' + run.error.message : ''})`
        + (errors.length ? '\n      ' + errors.join('\n      ') : ''),
      cases: [],
    };
  }
  try {
    return { file, ...JSON.parse(unescapeHtml(match[1])) };
  } catch (e) {
    return { file, error: 'could not parse the result payload: ' + e.message, cases: [] };
  }
}

const chrome = findChrome();
if (!chrome) {
  const message = 'test-dom: no Chrome/Chromium found (set CHROME=/path/to/chrome)';
  if (process.env.REQUIRE_DOM === '1') {
    console.error(message);
    process.exit(1);
  }
  console.log(message + ' — skipping the browser security tests');
  process.exit(0);
}

let failed = 0, total = 0;

for (const file of ['sanitize.html', 'page.html']) {
  const report = runPage(chrome, file);
  const cases = report.cases || [];
  const failures = cases.filter((c) => c.problems.length);
  total += cases.length;
  if (report.error) {
    console.error(`test-dom: ${file}: ${report.error}`);
    failed++;
    continue;
  }
  if (failures.length) {
    console.error(`test-dom: ${file}: ${failures.length} of ${cases.length} cases failed`);
    for (const c of failures) {
      console.error(`  - ${c.name}`);
      for (const p of c.problems) console.error(`      ${p}`);
      if (c.output) console.error(`      output: ${c.output.slice(0, 200)}`);
    }
    failed += failures.length;
    continue;
  }
  console.log(`test-dom: ${file}: ${cases.length} cases ok`);
}

if (failed) {
  console.error(`test-dom: ${failed} failure(s)`);
  process.exit(1);
}
console.log(`test-dom: ${total} cases, 0 failed`);
