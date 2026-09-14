import { describe, expect, it } from 'vitest';
import { localAnvil } from '../../chain/chains';
import { connectWallet, ensureChain, sendEth, type Eip1193Provider } from '../wallet';

class FakeProvider implements Eip1193Provider {
  calls: Array<{ method: string; params?: unknown[] }> = [];
  chainId = '0x1';
  failSwitch = false;
  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    this.calls.push(args);
    switch (args.method) {
      case 'eth_requestAccounts':
        return ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'];
      case 'eth_chainId':
        return this.chainId;
      case 'wallet_switchEthereumChain':
        if (this.failSwitch) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
        this.chainId = (args.params![0] as { chainId: string }).chainId;
        return null;
      case 'wallet_addEthereumChain':
        this.chainId = (args.params![0] as { chainId: string }).chainId;
        return null;
      case 'eth_sendTransaction':
        return '0x' + 'ab'.repeat(32);
      default:
        throw new Error(`unexpected ${args.method}`);
    }
  }
}

describe('wallet', () => {
  it('connects and checksums the account', async () => {
    const p = new FakeProvider();
    expect(await connectWallet(p)).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('switches chains, adding the chain when the wallet does not know it', async () => {
    const p = new FakeProvider();
    await ensureChain(p, localAnvil, 'http://127.0.0.1:8545');
    expect(p.chainId).toBe('0x7a69');
    const q = new FakeProvider();
    q.failSwitch = true;
    await ensureChain(q, localAnvil, 'http://127.0.0.1:8545');
    expect(q.calls.map((c) => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
    expect(q.chainId).toBe('0x7a69');
  });

  it('sends eth with a hex value', async () => {
    const p = new FakeProvider();
    const tx = await sendEth(p, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x1111111111111111111111111111111111111111', 10n ** 16n);
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
    const call = p.calls.find((c) => c.method === 'eth_sendTransaction')!;
    expect((call.params![0] as { value: string }).value).toBe('0x2386f26fc10000');
  });
});
