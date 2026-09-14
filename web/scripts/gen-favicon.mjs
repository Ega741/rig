// Generates public/favicon.svg, public/favicon-32.png and public/apple-touch-icon.png from one 16x16 pixel map:
// the graphics card from the brand mark. Pure Node, no dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canvas } from './lib/png.mjs';

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

function png(size, pad) {
  const scale = Math.floor((size - 2 * pad) / 16);
  const c = canvas(size, size, COLORS['.']);
  MAP.forEach((row, y) => [...row].forEach((v, x) => v !== '.' && c.fillRect(pad + x * scale, pad + y * scale, scale, scale, COLORS[v])));
  return c.png();
}

writeFileSync(`${out}favicon-32.png`, png(32, 0));
writeFileSync(`${out}apple-touch-icon.png`, png(180, 2));
console.log(`wrote ${out}favicon.svg, favicon-32.png, apple-touch-icon.png`);
