// Builds the ZIP uploaded to the Chrome Web Store.
//
//   node tools/package.mjs
//
// Output: dist/markdown-folder-viewer-<version>.zip
//
// The freshly written archive is read back and compared with the working tree,
// so a packaging bug cannot ship a stale script, style or manifest.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip, checkManifestRefs, collectFiles, verifyZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) {
  throw new Error(`version mismatch: manifest.json ${manifest.version}, package.json ${pkg.version}`);
}

const files = collectFiles(ROOT);
checkManifestRefs(manifest, files);

const zip = buildZip(files.map((name) => ({ name, data: readFileSync(join(ROOT, name)) })));
const out = join(DIST, `${pkg.name}-${manifest.version}.zip`);
mkdirSync(DIST, { recursive: true });
rmSync(out, { force: true });
writeFileSync(out, zip);

const problems = verifyZip(readFileSync(out), files, ROOT);
if (problems.length) throw new Error(`package verification failed:\n  ${problems.join('\n  ')}`);

console.log(files.map((f) => `  ${f}`).join('\n'));
console.log(`\n${files.length} files -> ${out} (${(zip.length / 1024).toFixed(1)} KiB)`);
