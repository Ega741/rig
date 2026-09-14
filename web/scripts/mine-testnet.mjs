// Seeds the Robinhood Chain testnet HashMine with real miners: N headless Chromium pages, each with its own
// session key (funded from the testnet deployer) and beneficiary, mining for SECONDS, then claiming.
// Env: MINERS (3), SECONDS (1260 ≈ 2 rounds), CORES (1), FUND_ETH (0.0004), RIG_CHROME.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { createPublicClient, createWalletClient, http, parseAbiItem, parseEther, formatEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { robinhoodTestnet } from '../src/chain/chains.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const MINERS = Number(process.env.MINERS ?? 3);
const SECONDS = Number(process.env.SECONDS ?? 1260);
const CORES = Number(process.env.CORES ?? 1);
const FUND_ETH = process.env.FUND_ETH ?? '0.0004';

const env = Object.fromEntries(readFileSync(`${ROOT}web/.env.testnet`, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.split('=')));
const deployerKey = readFileSync(`${ROOT}contracts/.env`, 'utf8').match(/^DEPLOYER_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
if (!deployerKey) throw new Error('DEPLOYER_KEY not found in contracts/.env');
if (!existsSync(CHROME)) throw new Error(`browser binary not found: ${CHROME}`);
const hashMine = env.VITE_HASHMINE_ADDRESS;
const rpcUrl = robinhoodTestnet.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain: robinhoodTestnet, transport: http(rpcUrl) });
const funder = createWalletClient({ account: privateKeyToAccount(deployerKey), chain: robinhoodTestnet, transport: http(rpcUrl) });

const miners = Array.from({ length: MINERS }, () => {
  const sessionKey = generatePrivateKey();
  return { sessionKey, session: privateKeyToAccount(sessionKey).address, beneficiary: privateKeyToAccount(generatePrivateKey()).address };
});
console.log(`HashMine ${hashMine} on ${rpcUrl}; funding ${MINERS} session keys with ${FUND_ETH} tETH each`);
for (const m of miners) {
  const hash = await funder.sendTransaction({ to: m.session, value: parseEther(FUND_ETH) });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  miner ${m.beneficiary} session ${m.session} funded (${hash})`);
}

// No dependency discovery: it would re-optimise and reload every page mid-run.
const vite = await createServer({ configFile: `${ROOT}web/vite.config.ts`, root: `${ROOT}web`, server: { port: 0 }, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
await vite.listen();
const url = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'] });
// Warm the module graph once so the miners' pages load without surprises.
{
  const warm = await browser.newPage();
  await warm.goto(`${url}browser-tests/e2e.html`);
  await warm.waitForFunction(() => typeof window.rigE2E === 'object');
  await warm.waitForTimeout(5000);
  await warm.close();
}
const started = Date.now();
const runs = miners.map(async (m, i) => {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log(`[miner ${i} pageerror]`, error.message));
  const config = { rpcUrl, hashMine, sessionPrivateKey: m.sessionKey, beneficiary: m.beneficiary, cores: CORES, useGpu: i === 0, seconds: SECONDS, chainId: robinhoodTestnet.id };
  let result;
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${url}browser-tests/e2e.html`);
    await page.waitForFunction(() => typeof window.rigE2E === 'object');
    // Vite may reload the page once right after the first load (dependency optimisation); run again then.
    await page.waitForTimeout(5000);
    const progress = setInterval(() => void page.evaluate(() => document.getElementById('log')?.textContent?.trim().split('\n').pop() ?? '').then((line) => console.log(`[miner ${i} ${Math.round((Date.now() - started) / 1000)}s] ${line}`)).catch(() => {}), 120_000);
    try {
      result = await page.evaluate((c) => window.rigE2E.run(c), config);
      clearInterval(progress);
      break;
    } catch (error) {
      clearInterval(progress);
      if (attempt >= 6 || !String(error).includes('Execution context was destroyed')) throw error;
      console.log(`[miner ${i}] page reloaded under us, retrying (${attempt})`);
    }
  }
  console.log(`--- miner ${i} (${m.beneficiary}) after ${Math.round((Date.now() - started) / 1000)} s:\n${result.log.slice(-15).join('\n')}\nclaim tx: ${result.claimTx}`);
  return result;
});
const results = await Promise.all(runs);
await browser.close();
await vite.close();

const fromBlock = 119_450_500n;
const shares = await publicClient.getLogs({ address: hashMine, event: parseAbiItem('event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)'), fromBlock });
const closed = await publicClient.getLogs({ address: hashMine, event: parseAbiItem('event RoundClosed(uint256 indexed round, uint256 work, uint256 release)'), fromBlock });
const claimed = await publicClient.getLogs({ address: hashMine, event: parseAbiItem('event Claimed(address indexed beneficiary, uint256 amount)'), fromBlock });
console.log(`\nchain: ${shares.length} ShareBatch, rounds closed ${closed.map((l) => `#${l.args.round}=${formatEther(l.args.release)} ETH`).join(', ') || 'none'}`);
for (const m of miners) {
  const mine = shares.filter((l) => l.args.beneficiary.toLowerCase() === m.beneficiary.toLowerCase());
  const paid = claimed.filter((l) => l.args.beneficiary.toLowerCase() === m.beneficiary.toLowerCase()).reduce((s, l) => s + l.args.amount, 0n);
  console.log(`  ${m.beneficiary}: ${mine.reduce((s, l) => s + Number(l.args.count), 0)} shares in ${mine.length} batches, claimed ${formatEther(paid)} ETH`);
}
console.log(`errors: ${results.flatMap((r) => r.snapshot.engineErrors).join('; ') || 'none'}`);
