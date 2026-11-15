// Builds the ZIP uploaded to the Chrome Web Store. Pure Node, no
// dependencies: collects only the files the extension needs at runtime and
// writes them as a standard deflate ZIP with manifest.json at the root.
//
//   node tools/package.mjs
//
// Output: dist/markdown-folder-viewer-<version>.zip
import { deflateRawSync, crc32 } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Top-level files shipped with the extension; tests, tools, package.json and
// the SVG icon source stay out of the package.
function collectFiles() {
  const top = readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => n === 'manifest.json' || n === 'LICENSE' || /\.(js|html|css)$/.test(n));
  const icons = readdirSync(join(ROOT, 'icons'))
    .filter((n) => n.endsWith('.png'))
    .map((n) => `icons/${n}`);
  return [...top, ...icons].sort();
}

// Every file the manifest points at must be in the package.
function checkManifestRefs(manifest, files) {
  const refs = new Set();
  const add = (v) => typeof v === 'string' && refs.add(v);
  Object.values(manifest.icons ?? {}).forEach(add);
  Object.values(manifest.action?.default_icon ?? {}).forEach(add);
  add(manifest.action?.default_popup);
  add(manifest.options_ui?.page);
  for (const cs of manifest.content_scripts ?? []) {
    (cs.js ?? []).forEach(add);
    (cs.css ?? []).forEach(add);
  }
  for (const war of manifest.web_accessible_resources ?? []) (war.resources ?? []).forEach(add);
  const missing = [...refs].filter((r) => !files.includes(r));
  if (missing.length) throw new Error(`manifest.json references missing files: ${missing.join(', ')}`);
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function buildZip(entries) {
  const { time, date } = dosTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) {
  throw new Error(`version mismatch: manifest.json ${manifest.version}, package.json ${pkg.version}`);
}

const files = collectFiles();
checkManifestRefs(manifest, files);

const zip = buildZip(files.map((name) => ({ name, data: readFileSync(join(ROOT, name)) })));
const out = join(DIST, `${pkg.name}-${manifest.version}.zip`);
mkdirSync(DIST, { recursive: true });
rmSync(out, { force: true });
writeFileSync(out, zip);

console.log(files.map((f) => `  ${f}`).join('\n'));
console.log(`\n${files.length} files -> ${out} (${(zip.length / 1024).toFixed(1)} KiB)`);
