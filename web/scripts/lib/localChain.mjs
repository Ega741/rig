// Shared e2e bootstrap: anvil with 1 s blocks, DeployLocal, a funder from anvil account 0.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Starts anvil, deploys HashMine seeded with ETH, returns clients and a stop() that kills anvil. */
export async function startLocalChain() {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['-p', String(port), '-b', '1', '--silent'], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    execFileSync(
      'forge',
      ['script', 'script/DeployLocal.s.sol:DeployLocal', '--rpc-url', rpcUrl, '--broadcast', '--private-key', ANVIL_KEY, '--silent'],
      { cwd: `${ROOT}contracts`, stdio: 'inherit' },
    );
  } catch (error) {
    anvil.kill();
    throw error;
  }
  const broadcast = JSON.parse(readFileSync(`${ROOT}contracts/broadcast/DeployLocal.s.sol/31337/run-latest.json`, 'utf8'));
  const hashMine = broadcast.transactions.find((t) => t.contractName === 'HashMine').contractAddress;
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const funder = createWalletClient({ account: privateKeyToAccount(ANVIL_KEY), transport: http(rpcUrl) });
  return {
    rpcUrl,
    hashMine,
    publicClient,
    async fund(address, eth = '1') {
      const hash = await funder.sendTransaction({ to: address, value: parseEther(eth), chain: null });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    stop() {
      anvil.kill();
    },
  };
}
