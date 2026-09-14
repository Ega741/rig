import { getAddress, isAddress, type Address } from 'viem';
import { configFromEnv, type AppConfig } from '../chain/chains';

export interface UiConfig extends AppConfig {
  /** Beneficiary fixed by the URL (?beneficiary=0x…); otherwise the page asks for a wallet or an address. */
  beneficiary: Address | null;
}

function addressParam(value: string | null, name: string): Address | null {
  if (value === null || value === '') return null;
  if (!isAddress(value)) throw new Error(`${name} is not an address: ${value}`);
  return getAddress(value);
}

/** Build-time env with URL query overrides: chain, rpc, hashMine, treasury, feeEscrow, beneficiary. */
export function loadConfig(env: Record<string, string | undefined>, search: string): UiConfig {
  const query = new URLSearchParams(search);
  const merged: Record<string, string | undefined> = {
    ...env,
    VITE_CHAIN: query.get('chain') ?? env.VITE_CHAIN,
    VITE_RPC_URL: query.get('rpc') ?? env.VITE_RPC_URL,
    VITE_HASHMINE_ADDRESS: query.get('hashMine') ?? env.VITE_HASHMINE_ADDRESS,
    VITE_TREASURY_ADDRESS: query.get('treasury') ?? env.VITE_TREASURY_ADDRESS,
    VITE_FEE_ESCROW_ADDRESS: query.get('feeEscrow') ?? env.VITE_FEE_ESCROW_ADDRESS,
  };
  const base = configFromEnv(merged);
  if (!isAddress(base.hashMine)) throw new Error(`VITE_HASHMINE_ADDRESS is not an address: ${base.hashMine}`);
  return {
    ...base,
    hashMine: getAddress(base.hashMine),
    treasury: addressParam(base.treasury, 'VITE_TREASURY_ADDRESS'),
    feeEscrow: addressParam(base.feeEscrow, 'VITE_FEE_ESCROW_ADDRESS'),
    beneficiary: addressParam(query.get('beneficiary'), 'beneficiary'),
  };
}
