/* Draws the Ledgerly logo and writes assets/ledgerly.ico (+ ledgerly.png).
   node tools/make-icon.js
   No dependencies: a tiny anti-aliased rasteriser, a PNG encoder, and an ICO container. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');

/* ---- the logo, in a 32 x 32 design space (matches the sprite in index.html) ---- */
const W1 = [[10, 8], [10, 23], [23, 23]];                 // white "L" (axis)
const G1 = [[14, 18], [17.5, 14.5], [20, 16.5], [24, 11.5]]; // aqua trend line
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TOP = hex('#2f78cf'), BOT = hex('#1f5cae'), WHITE = [255, 255, 255], AQUA = hex('#73e0b2');

const distSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const nearLine = (px, py, pts, half) => { for (let i = 0; i < pts.length - 1; i++) if (distSeg(px, py, pts[i], pts[i + 1]) <= half) return true; return false; };
const inRoundRect = (x, y, r) => {
  if (x < 0 || y < 0 || x > 32 || y > 32) return false;
  const cx = x < r ? r : x > 32 - r ? 32 - r : x, cy = y < r ? r : y > 32 - r ? 32 - r : y;
  return Math.hypot(x - cx, y - cy) <= r;
};
/** Colour of the logo at a point in design space, or null when transparent. */
const sample = (x, y) => {
  if (!inRoundRect(x, y, 9)) return null;
  if (nearLine(x, y, G1, 1.2)) return AQUA;
  if (nearLine(x, y, W1, 1.5)) return WHITE;
  const t = y / 32;
  return TOP.map((c, i) => c + (BOT[i] - c) * t);
};

/** Render the logo to an RGBA buffer with n x n supersampling. */
const render = size => {
  const N = 5, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const c = sample((px + (sx + 0.5) / N) / size * 32, (py + (sy + 0.5) / N) / size * 32);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (py * size + px) * 4;
    if (a) { buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); buf[o + 3] = Math.round(255 * a / (N * N)); }
  }
  return buf;
};

/* ---- PNG encoder ---- */
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (rgba, size) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

/* ---- ICO container (PNG-compressed entries, supported since Windows Vista) ---- */
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map(s => png(render(s), s));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
let offset = 6 + 16 * SIZES.length;
const entries = SIZES.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12); offset += images[i].length;
  return e;
});
const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ledgerly.ico'), Buffer.concat([head, ...entries, ...images]));
fs.writeFileSync(path.join(out, 'ledgerly.png'), images[SIZES.length - 1]);
console.log(`Wrote assets/ledgerly.ico (${SIZES.join(', ')} px) and assets/ledgerly.png`);
