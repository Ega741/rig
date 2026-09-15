import { describe, expect, it } from 'vitest';
import { fetchEthUsd, formatUsd, weiToUsd } from '../ethUsd';

describe('formatUsd', () => {
  it('groups thousands and drops cents for big values', () => {
    expect(formatUsd(4750.4)).toBe('$4,750');
    expect(formatUsd(1_234_567)).toBe('$1,234,567');
  });
  it('keeps cents from $1 up and four decimals from a cent up', () => {
    expect(formatUsd(12.3)).toBe('$12.30');
    expect(formatUsd(0.0117)).toBe('$0.0117');
  });
  it('shows four significant digits for token-sized prices', () => {
    expect(formatUsd(0.000011733)).toBe('$0.00001173');
    expect(formatUsd(0.0000000042)).toBe('$0.000000004200');
  });
  it('handles zero and garbage', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(NaN)).toBe('—');
  });
});

describe('weiToUsd', () => {
  it('converts wei at the given rate without losing tiny amounts', () => {
    expect(weiToUsd(10n ** 18n, 2500)).toBe(2500);
    expect(weiToUsd(4_749_000_000n, 2500)).toBeCloseTo(0.0000118725, 12); // 4.749e-9 ETH
    expect(weiToUsd(4_750_000_000_000_000_000n, 2470.855)).toBeCloseTo(11736.56, 2);
  });
});

describe('fetchEthUsd', () => {
  it('reads Coinbase spot', async () => {
    const fetchFn = (async () => ({ json: async () => ({ data: { amount: '2470.855' } }) })) as unknown as typeof fetch;
    expect(await fetchEthUsd(fetchFn)).toBe(2470.855);
  });
  it('falls back to CoinGecko when Coinbase fails', async () => {
    const fetchFn = (async (url: string) => {
      if (url.includes('coinbase')) throw new Error('down');
      return { json: async () => ({ ethereum: { usd: 2468 } }) };
    }) as unknown as typeof fetch;
    expect(await fetchEthUsd(fetchFn)).toBe(2468);
  });
  it('returns null when both fail', async () => {
    const fetchFn = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchEthUsd(fetchFn)).toBeNull();
  });
});
