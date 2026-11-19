// Minimal ZIP write/read used by the packaging scripts. Pure Node, no
// dependencies: enough for the extension package (no zip64, no data
// descriptors) and for reading that package back to prove the artifact matches
// the working tree.
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Runtime files shipped with the extension. Tests, tools, package.json and the
// SVG icon source stay out of the package.
export function collectFiles(root) {
  const top = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => n === 'manifest.json' || n === 'LICENSE' || /\.(js|html|css)$/.test(n));
  const icons = readdirSync(join(root, 'icons'))
    .filter((n) => n.endsWith('.png'))
    .map((n) => `icons/${n}`);
  return [...top, ...icons].sort();
}

// Every file the manifest points at must be in the package.
export function checkManifestRefs(manifest, files) {
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

export function buildZip(entries, when = new Date()) {
  const { time, date } = dosTime(when);
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

// Returns [{ name, data, crc }] for a ZIP produced by buildZip() above.
export function readZip(zip) {
  let eocd = -1;
  const earliest = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= earliest; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file (no end of central directory record)');
  const count = zip.readUInt16LE(eocd + 10);
  let off = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = zip.readUInt16LE(off + 10);
    const crc = zip.readUInt32LE(off + 16);
    const size = zip.readUInt32LE(off + 20);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const localOffset = zip.readUInt32LE(off + 42);
    const name = zip.toString('utf8', off + 46, off + 46 + nameLen);
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + size);
    entries.push({ name, data: method === 0 ? raw : inflateRawSync(raw), crc });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Compares a built ZIP against the files that would be packaged now. A stale
// package (shipped JS/CSS/manifest that no longer matches the source) is a
// release-integrity problem, so the caller decides how loud to be.
export function verifyZip(zipBuffer, files, root) {
  const problems = [];
  let entries;
  try {
    entries = readZip(zipBuffer);
  } catch (e) {
    return [`cannot read package: ${e.message}`];
  }
  const packaged = new Map(entries.map((e) => [e.name, e]));
  for (const name of files) {
    const entry = packaged.get(name);
    if (!entry) { problems.push(`missing from package: ${name}`); continue; }
    const source = readFileSync(join(root, name));
    if (crc32(source) !== entry.crc || !source.equals(entry.data)) {
      problems.push(`stale in package: ${name} (${statSync(join(root, name)).size} bytes in source)`);
    }
  }
  for (const { name } of entries) {
    if (!files.includes(name)) problems.push(`unexpected in package: ${name}`);
  }
  return problems;
}
