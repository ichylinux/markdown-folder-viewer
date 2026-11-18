// Draws a 1px #d0d7de frame on the inside edge of store/screenshots/*.png
// (1280x800 RGB). Pure Node, no dependencies — same approach as make-icons.mjs.
//
//   node tools/frame-screenshots.mjs
//
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'store', 'screenshots');
const BORDER = [208, 215, 222]; // #d0d7de — matches GitHub/default light border tone
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRow(filter, row, prev, bpp) {
  const out = Buffer.from(row);
  const n = row.length;
  for (let i = 0; i < n; i++) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const upLeft = i >= bpp && prev ? prev[i - bpp] : 0;
    let v = out[i];
    switch (filter) {
      case 0: break;
      case 1: v = (v + left) & 0xff; break;
      case 2: v = (v + up) & 0xff; break;
      case 3: v = (v + Math.floor((left + up) / 2)) & 0xff; break;
      case 4: v = (v + paeth(left, up, upLeft)) & 0xff; break;
      default: throw new Error(`unsupported PNG filter ${filter}`);
    }
    out[i] = v;
  }
  return out;
}

function decodePngRgb(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  let i = 8;
  let ihdr = null;
  const idats = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i); i += 4;
    const type = buf.toString('ascii', i, i + 4); i += 4;
    const data = buf.subarray(i, i + len); i += len;
    i += 4; // crc
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG missing IHDR');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(`expected 8-bit RGB (color type 2), got depth ${bitDepth} type ${colorType}`);
  }
  const bpp = 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idats));
  const rgb = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    const row = raw.subarray(base + 1, base + 1 + stride);
    const recon = unfilterRow(filter, row, prev, bpp);
    recon.copy(rgb, y * stride);
    prev = recon;
  }
  return { width, height, rgb };
}

function encodePngRgb(width, height, rgb) {
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(rgb, width, x, y, color) {
  const i = (y * width + x) * 3;
  rgb[i] = color[0];
  rgb[i + 1] = color[1];
  rgb[i + 2] = color[2];
}

function frameRgb(rgb, width, height) {
  for (let x = 0; x < width; x++) {
    setPixel(rgb, width, x, 0, BORDER);
    setPixel(rgb, width, x, height - 1, BORDER);
  }
  for (let y = 0; y < height; y++) {
    setPixel(rgb, width, 0, y, BORDER);
    setPixel(rgb, width, width - 1, y, BORDER);
  }
}

for (const name of readdirSync(DIR).filter(f => f.endsWith('.png')).sort()) {
  const file = join(DIR, name);
  const { width, height, rgb } = decodePngRgb(readFileSync(file));
  frameRgb(rgb, width, height);
  writeFileSync(file, encodePngRgb(width, height, rgb));
  console.log(`framed ${file} (${width}x${height})`);
}