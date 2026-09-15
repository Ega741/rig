import { fallback, http, type Transport } from 'viem';
import { robinhood } from './chains';

/** Public archive-less mirror of Robinhood Chain; takes over when the primary RPC rate-limits or misbehaves. */
export const ROBINHOOD_FALLBACK_RPC = 'https://robinhood.drpc.org';

/**
 * Transport for `url`. On Robinhood Chain mainnet the primary is backed by drpc, so a 429 or a broken
 * response from one endpoint does not take the page down; other chains (testnet, anvil) use `url` alone.
 */
export function rpcTransport(chainId: number, url: string): Transport {
  if (chainId !== robinhood.id || url.includes('drpc.org')) return http(url);
  return fallback([http(url, { retryCount: 1 }), http(ROBINHOOD_FALLBACK_RPC, { retryCount: 2 })], { rank: false });
}
