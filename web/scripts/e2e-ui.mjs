// UI end-to-end: the real Mine page against anvil. Starts mining, waits for shares on screen and on chain,
// opens Stats, saves screenshots to e2e-artifacts/. Env: RIG_CHROME, E2E_UI_TIMEOUT (default 120 s).
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { parseAbiItem } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'vite';
import { startLocalChain } from './lib/localChain.mjs';

const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const TIMEOUT_MS = Number(process.env.E2E_UI_TIMEOUT ?? 120) * 1000;
const ARTIFACTS = 'e2e-artifacts';

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(CHROME)) {
  console.log(`FAIL browser binary not found: ${CHROME}`);
  process.exit(1);
}
mkdirSync(ARTIFACTS, { recursive: true });

const chain = await startLocalChain();
let vite;
let browser;
try {
  const { rpcUrl, hashMine, publicClient } = chain;
  const beneficiary = privateKeyToAccount(generatePrivateKey()).address;
  vite = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  const query = new URLSearchParams({ chain: 'local', rpc: rpcUrl, hashMine, beneficiary });
  await page.goto(`${url}?${query.toString()}#/mine`);

  const sessionAddress = (await page.getByTestId('session-address').textContent({ timeout: 15_000 })).trim();
  check(/^0x[0-9a-fA-F]{40}$/.test(sessionAddress), `session key shown: ${sessionAddress}`);
  await chain.fund(sessionAddress, '0.5');
  // The balance refreshes every 10 s; the first read may predate the funding transfer.
  await page.waitForFunction(() => document.querySelector('[data-testid="session-balance"]').textContent.includes('0.5000 ETH'), null, { timeout: 30_000 });
  check(true, 'session balance shows 0.5000 ETH');
  check((await page.getByTestId('beneficiary').textContent()).trim() === beneficiary, 'beneficiary from the URL is shown');

  await page.getByLabel('CPU cores').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => /MH\/s|kH\/s/.test(document.querySelector('[data-testid="hash-rate"]').textContent), null, { timeout: 30_000 });
  console.log('hash rate:', (await page.getByTestId('hash-rate').textContent()).trim());
  await page.waitForFunction(() => Number.parseInt(document.querySelector('[data-testid="shares-sent"]').textContent, 10) > 0, null, { timeout: TIMEOUT_MS });
  const sent = Number.parseInt((await page.getByTestId('shares-sent').textContent()).trim(), 10);
  check(sent > 0, `shares sent on screen: ${sent}`);
  check((await page.locator('.strip__mark').count()) > 0, 'round strip shows share marks');
  check((await page.locator('.hashstrip__bit--lead').count()) >= 8, 'hash strip lights the leading zero bits of the last share');
  await page.screenshot({ path: `${ARTIFACTS}/mine.png`, fullPage: true });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal overflow at 400px (${overflow}px)`);
  await page.screenshot({ path: `${ARTIFACTS}/mine-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1200, height: 900 });

  const logs = await publicClient.getLogs({
    address: hashMine,
    event: parseAbiItem('event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)'),
    args: { beneficiary },
    fromBlock: 0n,
  });
  const onChain = logs.reduce((sum, l) => sum + Number(l.args.count), 0);
  check(onChain >= sent, `ShareBatch on chain: ${onChain} shares`);

  await page.getByTestId('stop-button').click();
  check((await page.getByTestId('status').textContent()).includes('Stopped'), 'status says Stopped');

  await page.goto(`${url}?${query.toString()}#/stats`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="rounds-table"] tbody tr').length > 0, null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="unique-miners"]').textContent.startsWith('—'), null, { timeout: 30_000 });
  const miners = (await page.getByTestId('unique-miners').textContent()).trim();
  check(miners.startsWith('1'), `stats shows 1 unique miner (${miners})`);
  await page.screenshot({ path: `${ARTIFACTS}/stats.png`, fullPage: true });

  await page.goto(`${url}?${query.toString()}#/docs`);
  check((await page.locator('h1').textContent()).includes('How it works'), 'docs page renders');
  await page.screenshot({ path: `${ARTIFACTS}/docs.png`, fullPage: true });
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  chain.stop();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`\nui e2e passed; screenshots in web/${ARTIFACTS}/`);
