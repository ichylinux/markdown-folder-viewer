// Verifies that dist/markdown-folder-viewer-<version>.zip matches the working
// tree. Run it before uploading a release, or from CI after a build:
//
//   node tools/verify-package.mjs
//
// Exits non-zero when the archive is missing, stale or built from a different
// version, so the shipped package can never drift from the reviewed source.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifestRefs, collectFiles, verifyZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const problems = [];

if (pkg.version !== manifest.version) {
  problems.push(`version mismatch: manifest.json ${manifest.version}, package.json ${pkg.version}`);
}

const files = collectFiles(ROOT);
checkManifestRefs(manifest, files);

const out = join(DIST, `${pkg.name}-${manifest.version}.zip`);
if (!existsSync(out)) {
  problems.push(`package not built: ${out} — run npm run package`);
} else {
  problems.push(...verifyZip(readFileSync(out), files, ROOT));
}

if (problems.length) {
  console.error('verify-package: FAILED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`verify-package: ok — ${files.length} files in ${out} match the working tree`);
