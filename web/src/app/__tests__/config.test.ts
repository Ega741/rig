import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';

const HASHMINE = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

describe('loadConfig', () => {
  it('reads env and defaults to the testnet rpc', () => {
    const c = loadConfig({ VITE_CHAIN: 'testnet', VITE_HASHMINE_ADDRESS: HASHMINE }, '');
    expect(c.chain.id).toBe(46630);
    expect(c.rpcUrl).toBe('https://rpc.testnet.chain.robinhood.com');
    expect(c.hashMine).toBe(HASHMINE);
    expect(c.treasury).toBeNull();
    expect(c.beneficiary).toBeNull();
    expect(c.ponsToken).toBeNull();
    expect(c.ponsRpcUrl).toBe('https://rpc.mainnet.chain.robinhood.com');
  });

  it('reads the PONS token from env or query', () => {
    const c = loadConfig({ VITE_CHAIN: 'testnet', VITE_HASHMINE_ADDRESS: HASHMINE, VITE_PONS_TOKEN: HASHMINE }, '');
    expect(c.ponsToken).toBe(HASHMINE);
    const q = loadConfig({ VITE_CHAIN: 'testnet', VITE_HASHMINE_ADDRESS: HASHMINE }, '?token=0x1111111111111111111111111111111111111111');
    expect(q.ponsToken).toBe('0x1111111111111111111111111111111111111111');
  });

  it('query parameters override env', () => {
    const c = loadConfig(
      { VITE_CHAIN: 'testnet', VITE_HASHMINE_ADDRESS: HASHMINE },
      `?chain=local&rpc=http://127.0.0.1:9999&hashMine=${HASHMINE}&beneficiary=0x1111111111111111111111111111111111111111`,
    );
    expect(c.chain.id).toBe(31337);
    expect(c.rpcUrl).toBe('http://127.0.0.1:9999');
    expect(c.beneficiary).toBe('0x1111111111111111111111111111111111111111');
  });

  it('rejects a bad address', () => {
    expect(() => loadConfig({ VITE_CHAIN: 'local', VITE_HASHMINE_ADDRESS: 'nope' }, '')).toThrow(/VITE_HASHMINE_ADDRESS/);
    expect(() => loadConfig({ VITE_CHAIN: 'local', VITE_HASHMINE_ADDRESS: HASHMINE }, '?beneficiary=0x12')).toThrow(/beneficiary/);
  });
});
