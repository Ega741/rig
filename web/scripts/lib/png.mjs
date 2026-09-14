// Minimal PNG encoder (RGB, no filter) — enough for pixel art. No dependencies.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A width x height RGB canvas with fillRect, encoded by png(). */
export function canvas(width, height, background) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const bg = hex(background);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(bg, y * (width * 3 + 1) + 1 + x * 3);
  }
  return {
    width,
    height,
    fillRect(x0, y0, w, h, colour) {
      const c = hex(colour);
      for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
        for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) raw.set(c, y * (width * 3 + 1) + 1 + x * 3);
      }
    },
    png() {
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width, 0);
      ihdr.writeUInt32BE(height, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ]);
    },
  };
}
