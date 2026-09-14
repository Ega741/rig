import { getAddress, numberToHex, type Address, type Chain, type Hex } from 'viem';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** The injected wallet, if any (MetaMask, Rabby, …). */
export function injectedProvider(): Eip1193Provider | null {
  const w = window as unknown as { ethereum?: Eip1193Provider };
  return w.ethereum ?? null;
}

export async function connectWallet(provider: Eip1193Provider): Promise<Address> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts[0]) throw new Error('the wallet returned no account');
  return getAddress(accounts[0]);
}

/** Switches the wallet to `chain`, adding it first when the wallet does not know it (error 4902). */
export async function ensureChain(provider: Eip1193Provider, chain: Chain, rpcUrl: string): Promise<void> {
  const chainId = numberToHex(chain.id);
  const current = (await provider.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() === chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [rpcUrl],
          blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
        },
      ],
    });
  }
}

/** One popup: a plain value transfer from the connected wallet to the session key. */
export async function sendEth(provider: Eip1193Provider, from: Address, to: Address, valueWei: bigint): Promise<Hex> {
  return (await provider.request({ method: 'eth_sendTransaction', params: [{ from, to, value: numberToHex(valueWei) }] })) as Hex;
}
