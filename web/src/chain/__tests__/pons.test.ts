import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256 } from 'viem';
import {
  computePoolId,
  creatorShareOfFee,
  poolStateSlot,
  quotePerTokenFromSqrtPrice,
  sortCurrencies,
  weiPerTokenFromReserves,
  weiPerTokenFromSqrtPrice,
} from '../pons';

const TOKEN = '0xCA75082b85bb7Bec8325d513F615b16BDa260020';
const HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';

describe('pons helpers', () => {
  it('computes the v4 PoolId with ETH as currency0', () => {
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
        ['0x0000000000000000000000000000000000000000', TOKEN, 0, 200, HOOK],
      ),
    );
    expect(computePoolId(TOKEN, '0x0000000000000000000000000000000000000000', 0, 200, HOOK)).toBe(expected);
  });

  it('puts the lower address first, whichever side the token is on', () => {
    const low = '0x0000000000000000000000000000000000000001';
    expect(sortCurrencies(TOKEN, low)).toEqual({ currency0: low, currency1: TOKEN, tokenIsCurrency0: false });
    const high = '0xFfffFFffFFFFfFFFFFFfFFfFfFFfffFffFFFFFff';
    expect(sortCurrencies(TOKEN, high)).toEqual({ currency0: TOKEN, currency1: high, tokenIsCurrency0: true });
  });

  it('flips the sqrt price when the token is currency0', () => {
    // token as currency0 at sqrtP = 2^96 * 1000: price1/0 = 1e6 quote-units per token-wei -> 1e24 per whole token.
    expect(quotePerTokenFromSqrtPrice((1n << 96n) * 1000n, true)).toBe(10n ** 24n);
    expect(quotePerTokenFromSqrtPrice((1n << 96n) * 1000n, false)).toBe(10n ** 12n);
  });

  it('derives the pool state slot from slot 6 of the PoolManager', () => {
    const id = computePoolId(TOKEN, '0x0000000000000000000000000000000000000000', 0, 200, HOOK);
    expect(poolStateSlot(id)).toBe(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [id, 6n])));
  });

  it('converts sqrtPriceX96 to wei per token', () => {
    // sqrtP = 2^96 means 1 token-wei per wei -> 1e18 wei per whole token.
    expect(weiPerTokenFromSqrtPrice(1n << 96n)).toBe(10n ** 18n);
    // sqrtP = 2^96 * 1000 means 1e6 token-wei per wei -> 1e12 wei per whole token.
    expect(weiPerTokenFromSqrtPrice((1n << 96n) * 1000n)).toBe(10n ** 12n);
    expect(weiPerTokenFromSqrtPrice(0n)).toBe(0n);
  });

  it('prices a constant-product curve', () => {
    // 1.68 ETH virtual quote against 1e9 tokens -> 1.68e-9 ETH per token.
    expect(weiPerTokenFromReserves(1_680_000_000_000_000_000n, 10n ** 27n)).toBe(1_680_000_000n);
    expect(weiPerTokenFromReserves(1n, 0n)).toBe(0n);
  });

  it('gives the creator everything but the protocol share, less the buyback slice when enabled', () => {
    expect(creatorShareOfFee(1_000n, 3000, false, 5000)).toBe(700n);
    expect(creatorShareOfFee(1_000n, 3000, true, 5000)).toBe(350n);
  });
});
