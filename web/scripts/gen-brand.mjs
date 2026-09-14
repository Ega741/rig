// Brand assets in the pixel-terminal style: public/banner.png (1500x500, X header / OG image) and
// public/avatar.png (400x400). Same glyphs as the site header (src/app/pixelfont.json).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import font from '../src/app/pixelfont.json' with { type: 'json' };
import { canvas } from './lib/png.mjs';

const BG = '#07070a';
const DOT = '#2b2d33';
const LIME = '#add064';
const INK = '#dee9fc';
const GREEN = '#65b24c';
const BRACKET = '#b9c4dd';

const out = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(out, { recursive: true });

function dots(c, step, size) {
  for (let y = step / 2; y < c.height; y += step) for (let x = step / 2; x < c.width; x += step) c.fillRect(x - size / 2, y - size / 2, size, size, DOT);
}

function text(c, segments, cell, x0, y0) {
  let x = 0;
  segments.forEach((seg, si) => {
    [...seg.text].forEach((ch, ci) => {
      const glyph = font.glyphs[ch];
      glyph.forEach((row, y) => [...row].forEach((v, dx) => v === 'X' && c.fillRect(x0 + (x + dx) * cell, y0 + y * cell, cell, cell, seg.fill)));
      x += glyph[0].length;
      if (!(si === segments.length - 1 && ci === seg.text.length - 1)) x += font.gap;
    });
  });
  return x;
}

function textWidth(segments) {
  let w = 0;
  segments.forEach((seg, si) => [...seg.text].forEach((ch, ci) => {
    w += font.glyphs[ch][0].length + (si === segments.length - 1 && ci === seg.text.length - 1 ? 0 : font.gap);
  }));
  return w;
}

// Banner: 1500 x 500, wordmark centred, 22 px cells (7 rows = 154 px).
{
  const c = canvas(1500, 500, BG);
  dots(c, 48, 4);
  const segs = [
    { text: 'RIG', fill: LIME },
    { text: '.FAN', fill: INK },
  ];
  const cell = 22;
  const w = textWidth(segs) * cell;
  text(c, segs, cell, Math.round((1500 - w) / 2), Math.round((500 - font.height * cell) / 2));
  writeFileSync(`${out}banner.png`, c.png());
}

// Avatar: 400 x 400, the graphics card from the favicon, 20 px cells on the dot grid.
{
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
  const colours = { b: BRACKET, l: LIME, g: GREEN };
  const c = canvas(400, 400, BG);
  dots(c, 40, 4);
  const cell = 20;
  const off = (400 - 16 * cell) / 2;
  MAP.forEach((row, y) => [...row].forEach((v, x) => v !== '.' && c.fillRect(off + x * cell, off + y * cell, cell, cell, colours[v])));
  writeFileSync(`${out}avatar.png`, c.png());
}

console.log(`wrote ${out}banner.png (1500x500), avatar.png (400x400)`);
