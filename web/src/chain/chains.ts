import { defineChain, type Address, type Chain } from 'viem';

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  testnet: true,
});

/** anvil; no multicall3, so readers fall back to parallel calls. */
export const localAnvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
});

export interface AppConfig {
  chain: Chain;
  rpcUrl: string;
  hashMine: Address;
  /** Optional: enables harvest() calls. */
  treasury: Address | null;
  feeEscrow: Address | null;
}

const CHAINS: Record<string, Chain> = { mainnet: robinhood, testnet: robinhoodTestnet, local: localAnvil };

/** Reads VITE_CHAIN (local|testnet|mainnet), VITE_RPC_URL, VITE_HASHMINE_ADDRESS, VITE_TREASURY_ADDRESS, VITE_FEE_ESCROW_ADDRESS. */
export function configFromEnv(env: Record<string, string | undefined>): AppConfig {
  const chain = CHAINS[env.VITE_CHAIN ?? 'testnet'];
  if (!chain) throw new Error(`unknown VITE_CHAIN: ${env.VITE_CHAIN}`);
  const hashMine = env.VITE_HASHMINE_ADDRESS;
  if (!hashMine) throw new Error('VITE_HASHMINE_ADDRESS is not set');
  return {
    chain,
    rpcUrl: env.VITE_RPC_URL ?? chain.rpcUrls.default.http[0]!,
    hashMine: hashMine as Address,
    treasury: (env.VITE_TREASURY_ADDRESS as Address | undefined) ?? null,
    feeEscrow: (env.VITE_FEE_ESCROW_ADDRESS as Address | undefined) ?? null,
  };
}
