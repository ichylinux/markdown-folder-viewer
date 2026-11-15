// Generates the PNG icons required by Chrome (SVG is not supported for
// manifest icons). Pure Node, no dependencies: rasterizes the same shapes as
// icons/icon.svg with 4x4 supersampling and writes them as PNG.
//
//   node tools/make-icons.mjs
//
// Output: icons/icon16.png, icons/icon48.png, icons/icon128.png
//         store/icon128.png (Chrome Web Store listing icon: 96x96 artwork
//         centered in 128x128 with 16px transparent padding, per the store's
//         image guidelines; kept outside icons/ so it is not packaged)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
const STORE_OUT = join(ROOT, 'store');

const BLUE = [9, 105, 218, 255];
const WHITE = [255, 255, 255, 255];
const LIGHT = [182, 215, 255, 255];
const SIZE = 128; // master canvas, matching icon.svg's viewBox-in-user-units
const SS = 4; // supersampling factor per axis

const pagePoly = [[26, 25], [74, 25], [102, 53], [102, 103], [26, 103]];
const foldPoly = [[74, 25], [74, 53], [102, 53]];
const strokes = [
  [42, 68, 85, 68],
  [42, 82, 85, 82],
  [42, 96, 72, 96],
];
const STROKE_WIDTH = 6;

function inRoundRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const dx = Math.max(r - x, 0, x - (w - r));
  const dy = Math.max(r - y, 0, y - (h - r));
  return dx * dx + dy * dy <= r * r;
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inStroke(x, y, x1, y1, x2, y2, w) {
  const vx = x2 - x1, vy = y2 - y1;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2)) : 0;
  const px = x1 + t * vx, py = y1 + t * vy;
  const dx = x - px, dy = y - py;
  return dx * dx + dy * dy <= (w / 2) * (w / 2);
}

function colorAt(x, y) {
  for (const [x1, y1, x2, y2] of strokes) if (inStroke(x, y, x1, y1, x2, y2, STROKE_WIDTH)) return BLUE;
  if (inPoly(x, y, foldPoly)) return LIGHT;
  if (inPoly(x, y, pagePoly)) return WHITE;
  if (inRoundRect(x, y, SIZE, SIZE, 22)) return BLUE;
  return null;
}

// pad: transparent border in output pixels; the artwork fills size - 2*pad.
function render(size, pad = 0) {
  const art = size - 2 * pad;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x - pad + (sx + 0.5) / SS) * SIZE) / art;
          const uy = ((y - pad + (sy + 0.5) / SS) * SIZE) / art;
          const c = colorAt(ux, uy);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a === 0) continue;
      // Un-premultiply so edge pixels keep their color with partial alpha.
      px[i] = Math.round(r / (a / 255));
      px[i + 1] = Math.round(g / (a / 255));
      px[i + 2] = Math.round(b / (a / 255));
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

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

function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}

mkdirSync(STORE_OUT, { recursive: true });
const storeFile = join(STORE_OUT, 'icon128.png');
writeFileSync(storeFile, encodePng(128, render(128, 16)));
console.log(`wrote ${storeFile}`);
