import { describe, expect, it } from 'vitest';
import { blockRanges, summarizeMiners } from '../stats';

describe('stats', () => {
  it('counts unique beneficiaries and shares', () => {
    const summary = summarizeMiners([
      { beneficiary: '0xa', count: 3 },
      { beneficiary: '0xA', count: 1 },
      { beneficiary: '0xb', count: 64 },
    ]);
    expect(summary).toEqual({ miners: 2, shares: 68, batches: 3 });
  });

  it('splits a block span into chunks that end at the latest block', () => {
    // floor = 1000 - 250 = 750; chunks of 100 counted back from the latest block.
    expect(blockRanges(1000n, 250, 100)).toEqual([
      [901n, 1000n],
      [801n, 900n],
      [750n, 800n],
    ]);
    expect(blockRanges(50n, 250, 100)).toEqual([[0n, 50n]]);
  });
});
