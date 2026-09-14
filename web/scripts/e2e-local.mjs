// End-to-end: anvil -> DeployLocal -> fund a session key -> mine in headless Chromium -> check chain state.
// Env: RIG_CHROME (browser binary), E2E_SECONDS (default 75), E2E_CORES (default 2), E2E_GPU (default 1).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { parseAbiItem } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'vite';
import { startLocalChain } from './lib/localChain.mjs';

const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SECONDS = Number(process.env.E2E_SECONDS ?? 75);
const CORES = Number(process.env.E2E_CORES ?? 2);
const USE_GPU = (process.env.E2E_GPU ?? '1') === '1';

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(CHROME)) {
  console.log(`FAIL browser binary not found: ${CHROME}`);
  process.exit(1);
}

const chain = await startLocalChain();
let vite;
let browser;
try {
  const { rpcUrl, hashMine, token, publicClient } = chain;
  console.log(`anvil ${rpcUrl}; HashMine ${hashMine}; token ${token}`);
  const sessionKey = generatePrivateKey();
  const session = privateKeyToAccount(sessionKey);
  const beneficiary = privateKeyToAccount(generatePrivateKey()).address;
  await chain.fund(session.address);

  vite = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'] });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto(`${url}browser-tests/e2e.html`);
  await page.waitForFunction(() => typeof window.rigE2E === 'object');
  const result = await page.evaluate(
    (config) => window.rigE2E.run(config),
    { rpcUrl, hashMine, sessionPrivateKey: sessionKey, beneficiary, cores: CORES, useGpu: USE_GPU, seconds: SECONDS },
  );
  console.log(result.log.slice(-12).join('\n'));
  const s = result.snapshot;
  check(s.engineErrors.length === 0, `no engine errors (${s.engineErrors.join('; ')})`);
  check(s.hitsFound > 0, `hits found: ${s.hitsFound}`);
  check(s.batchesSubmitted > 0, `batches submitted: ${s.batchesSubmitted} (${s.sharesSubmitted} shares)`);

  const shareLogs = await publicClient.getLogs({
    address: hashMine,
    event: parseAbiItem('event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)'),
    args: { beneficiary },
    fromBlock: 0n,
  });
  const onChainShares = shareLogs.reduce((sum, l) => sum + Number(l.args.count), 0);
  check(onChainShares === s.sharesSubmitted, `ShareBatch events on chain: ${onChainShares} shares in ${shareLogs.length} batches`);
  const closed = await publicClient.getLogs({
    address: hashMine,
    event: parseAbiItem('event RoundClosed(uint256 indexed round, uint256 work, uint256 release)'),
    fromBlock: 0n,
  });
  check(closed.length > 0, `rounds closed: ${closed.length}`);
  const balance = await publicClient.readContract({
    address: token,
    abi: [parseAbiItem('function balanceOf(address) view returns (uint256)')],
    functionName: 'balanceOf',
    args: [beneficiary],
  });
  check(result.claimTx !== null && balance > 0n, `claimed ${balance} token-wei to beneficiary (tx ${result.claimTx})`);
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  chain.stop();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\ne2e passed');
