// Runs browser-tests/ in headless Chromium against the Vite dev server. Exit code 1 on any failure.
// HASHMINE_CHROME overrides the browser binary (default: the cached Chromium 1243 with WebGPU on Metal).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const CHROME =
  process.env.HASHMINE_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CORES = Number(process.env.HASHMINE_TEST_CORES ?? 2);
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(CHROME)) {
  console.log(`FAIL browser binary not found: ${CHROME} (set HASHMINE_CHROME)`);
  process.exit(1);
}

const server = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto(`${url}browser-tests/index.html`);
  await page.waitForFunction(() => typeof window.hashmineTest === 'object');

  const gpu = await page.evaluate(() => window.hashmineTest.gpu());
  console.log('gpu:', JSON.stringify(gpu));
  check(gpu.available, 'gpu: WebGPU adapter available');
  if (gpu.available) {
    check(gpu.vectorsOk === gpu.vectorsTotal, `gpu: vectors ${gpu.vectorsOk}/${gpu.vectorsTotal}`);
    check(gpu.search.hits > 0 && gpu.search.invalid.length === 0, `gpu: ${gpu.search.verified}/${gpu.search.hits} hits verified`);
    check(gpu.search.rate > 20e6, `gpu: ${(gpu.search.rate / 1e6).toFixed(1)} MH/s > 20`);
  }

  const cpu = await page.evaluate((cores) => window.hashmineTest.cpu(cores), CORES);
  console.log('cpu:', JSON.stringify(cpu));
  check(cpu.errors.length === 0, `cpu: no worker errors`);
  check(cpu.search.hits > 0 && cpu.search.invalid.length === 0, `cpu: ${cpu.search.verified}/${cpu.search.hits} hits verified`);
  check(cpu.search.rate > 2e6 * CORES, `cpu: ${(cpu.search.rate / 1e6).toFixed(2)} MH/s > ${2 * CORES}`);
} finally {
  await browser.close();
  await server.close();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nall browser tests passed');
