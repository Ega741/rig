// Generates public/favicon.svg, public/favicon-32.png and public/apple-touch-icon.png from one 16x16 pixel map:
// the graphics card from the brand mark. Pure Node, no dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const COLORS = { '.': '#07070a', b: '#b9c4dd', l: '#add064', g: '#65b24c' };
// 16x16: bracket (b), board (l), two fans cut out of the board with a lime hub, PCIe edge (g).
const MAP = [
  '................',
  '................',
  '................',
  '.bb.............',
  '.bbllllllllllll.',
  '.bbl....l....ll.',
  '.bbl....l....ll.',
  '.bbl.ll.l.ll.ll.',
  '.bbl.ll.l.ll.ll.',
  '.bbl....l....ll.',
  '.bbl....l....ll.',
  '.bbllllllllllll.',
  '.bbgggggggggggg.',
  '................',
  '................',
  '................',
];

const out = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(out, { recursive: true });

// SVG: one rect per pixel, crisp edges.
const rects = [];
MAP.forEach((row, y) =>
  [...row].forEach((c, x) => {
    if (c !== '.') rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORS[c]}"/>`);
  }),
);
writeFileSync(
  `${out}favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="${COLORS['.']}"/>${rects.join('')}</svg>\n`,
);

// PNG encoder: RGB, no filter, one IDAT.
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
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function png(size, pad) {
  const scale = Math.floor((size - 2 * pad) / 16);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const bg = hex(COLORS['.']);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = Math.floor((x - pad) / scale);
      const py = Math.floor((y - pad) / scale);
      const c = px >= 0 && px < 16 && py >= 0 && py < 16 ? MAP[py][px] : '.';
      const [r, g, b] = c === '.' ? bg : hex(COLORS[c]);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(`${out}favicon-32.png`, png(32, 0));
writeFileSync(`${out}apple-touch-icon.png`, png(180, 2));
console.log(`wrote ${out}favicon.svg, favicon-32.png, apple-touch-icon.png`);
