// Renders a brand/*.html template to PNG with the cached Chromium (same binary as the e2e tests).
// Usage: node scripts/render-post.mjs brand/round1-top3.html out.png [width height scale]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import font from '../src/app/pixelfont.json' with { type: 'json' };

const [, , template, out, w = '1600', h = '900', scale = '2'] = process.argv;
const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
if (!existsSync(CHROME)) throw new Error(`browser binary not found: ${CHROME}`);

// The site wordmark: RIG in lime, .FAN in ink, one rect per lit pixel.
function wordmark() {
  const segs = [
    { text: 'RIG', fill: '#add064' },
    { text: '.FAN', fill: '#dee9fc' },
  ];
  const rects = [];
  let x = 0;
  segs.forEach((seg, si) =>
    [...seg.text].forEach((ch, ci) => {
      const glyph = font.glyphs[ch];
      glyph.forEach((row, y) => [...row].forEach((v, dx) => v === 'X' && rects.push(`<rect x="${x + dx}" y="${y}" width="1" height="1" fill="${seg.fill}"/>`)));
      x += glyph[0].length;
      if (!(si === segs.length - 1 && ci === seg.text.length - 1)) x += font.gap;
    }),
  );
  return `<svg viewBox="0 0 ${x} ${font.height}" shape-rendering="crispEdges" role="img" aria-label="RIG.FAN">${rects.join('')}</svg>`;
}

const html = readFileSync(template, 'utf8').replace('{{WORDMARK}}', wordmark());
const tmp = resolve(template).replace(/\.html$/, '.rendered.html');
writeFileSync(tmp, html);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale) });
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: Number(w), height: Number(h) } });
await browser.close();
console.log(`wrote ${out} (${w}x${h} @${scale}x); fonts loaded: ${[...new Set(loaded)].join(', ') || 'none'}`);
