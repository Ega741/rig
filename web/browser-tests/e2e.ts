import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localAnvil, robinhoodTestnet } from '../src/chain/chains';
import { ViemChainReader, ViemSubmitter, createClients, ethReward } from '../src/chain/hashMineChain';
import { CpuEngine } from '../src/engine/cpuEngine';
import { GpuEngine } from '../src/engine/gpuEngine';
import type { Engine } from '../src/engine/types';
import { MinerController, type Snapshot } from '../src/miner/controller';

interface E2EConfig {
  rpcUrl: string;
  hashMine: Address;
  sessionPrivateKey: Hex;
  beneficiary: Address;
  cores: number;
  useGpu: boolean;
  seconds: number;
  /** 46630 for the Robinhood Chain testnet; anything else means the local anvil. */
  chainId?: number;
}

interface E2EResult {
  snapshot: Snapshot;
  log: string[];
  claimTx: Hex | null;
}

const logEl = document.getElementById('log')!;
const lines: string[] = [];
function log(message: string): void {
  lines.push(message);
  logEl.textContent = lines.slice(-30).join('\n');
}

async function run(config: E2EConfig): Promise<E2EResult> {
  const account = privateKeyToAccount(config.sessionPrivateKey);
  const base = config.chainId === robinhoodTestnet.id ? robinhoodTestnet : localAnvil;
  const clients = createClients({ ...base, rpcUrls: { default: { http: [config.rpcUrl] } } }, config.rpcUrl, account);
  const engines: Engine[] = [new CpuEngine(config.cores)];
  if (config.useGpu) {
    const gpu = await GpuEngine.create();
    if (gpu) engines.push(gpu);
  }
  const controller = new MinerController({
    beneficiary: config.beneficiary,
    engines,
    chain: new ViemChainReader(clients.publicClient, config.hashMine),
    submitter: new ViemSubmitter(clients, config.hashMine, account),
    price: ethReward,
    flushBeforeEndSec: 8,
    log,
  });
  controller.onSnapshot = (s) =>
    log(`round ${s.round} D=${s.difficulty} rate=${(s.hashRate / 1e6).toFixed(1)}MH/s found=${s.hitsFound} sent=${s.sharesSubmitted} buffered=${s.buffered} err=${s.lastError ?? '-'}`);
  controller.start(1000);
  await new Promise((resolve) => setTimeout(resolve, config.seconds * 1000));
  await controller.flush();
  controller.stop();
  await controller.idle();
  let claimTx: Hex | null = null;
  try {
    claimTx = await controller.claim();
  } catch (error) {
    log(`claim failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { snapshot: controller.snapshot(), log: lines, claimTx };
}

declare global {
  interface Window {
    rigE2E: { run: typeof run };
  }
}
window.rigE2E = { run };
