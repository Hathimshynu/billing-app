#!/usr/bin/env node
/**
 * Generates the PWA icons (PNG) and favicon (SVG) into public/ without image dependencies:
 * an indigo tile with a white receipt. Run: node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const INDIGO = [79, 70, 229];
const WHITE = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** size: px; maskable: full-bleed background with the glyph inside the 80% safe zone. */
function icon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.2;
  const inside = (x, y) => {
    if (!radius) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  const scale = maskable ? 0.62 : 0.72;
  const w = size * scale * 0.62;
  const h = size * scale;
  const left = (size - w) / 2;
  const top = (size - h) / 2;
  const tooth = w / 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inside(x + 0.5, y + 0.5)) continue;
      let color = INDIGO;
      const rx = x - left;
      const ry = y - top;
      if (rx >= 0 && rx <= w && ry >= 0 && ry <= h) {
        // zig-zag bottom edge of the receipt
        const zig = Math.abs(((rx / tooth) % 2) - 1) * tooth * 0.8;
        const isPaper = ry <= h - zig;
        if (isPaper) {
          color = WHITE;
          // text lines
          const line = (ry - h * 0.18) / (h * 0.14);
          if (ry > h * 0.15 && ry < h * 0.75 && line % 1 > 0.55 && line % 1 < 0.85 && rx > w * 0.18 && rx < w * (Math.floor(line) % 2 ? 0.62 : 0.82)) color = INDIGO;
        }
      }
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(out, 'pwa-192x192.png'), icon(192));
writeFileSync(join(out, 'pwa-512x512.png'), icon(512));
writeFileSync(join(out, 'maskable-512x512.png'), icon(512, { maskable: true }));
writeFileSync(join(out, 'apple-touch-icon.png'), icon(180, { maskable: true }));
writeFileSync(
  join(out, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#4f46e5"/><path d="M21 14h22v34l-3.7-2.6-3.6 2.6-3.7-2.6-3.7 2.6-3.6-2.6L21 48z" fill="#fff"/><path d="M25 22h14M25 28h10M25 34h14" stroke="#4f46e5" stroke-width="2.6" stroke-linecap="round"/></svg>\n`,
);
console.log('Icons written to public/');
