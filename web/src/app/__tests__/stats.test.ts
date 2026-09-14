import { describe, expect, it } from 'vitest';
import { blockRanges, leaderboard, summarizeMiners, type RoundRow, type ShareEntry } from '../stats';

const entry = (beneficiary: string, round: bigint, count: number, work: bigint): ShareEntry => ({ beneficiary, round, count, work });
const round = (r: bigint, work: bigint, release: bigint, closed = true): RoundRow => ({ round: r, work, release, minDifficulty: 20, closed, active: work > 0n });

describe('stats', () => {
  it('counts unique beneficiaries and shares', () => {
    const summary = summarizeMiners([entry('0xa', 1n, 3, 3n << 20n), entry('0xA', 2n, 1, 1n << 20n), entry('0xb', 2n, 64, 64n << 20n)]);
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

describe('leaderboard', () => {
  const entries = [
    entry('0xAAA', 1n, 3, 300n),
    entry('0xbbb', 1n, 1, 100n),
    entry('0xaaa', 2n, 2, 200n), // same miner as 0xAAA, different case
    entry('0xbbb', 2n, 6, 600n),
    entry('0xccc', 2n, 1, 100n),
  ];
  const rounds = [round(2n, 900n, 0n, false), round(1n, 400n, 4_000n)];

  it('ranks the window by total work and credits ETH from closed rounds only', () => {
    const rows = leaderboard(entries, rounds, 2n, 'window');
    expect(rows.map((r) => [r.rank, r.beneficiary, r.work, r.shares, r.rounds])).toEqual([
      [1, '0xbbb', 700n, 7, 2],
      [2, '0xaaa', 500n, 5, 2],
      [3, '0xccc', 100n, 1, 1],
    ]);
    // Round 1 released 4000 over 400 work: aaa had 300 -> 3000, bbb 100 -> 1000; round 2 is open.
    expect(rows.map((r) => r.earned)).toEqual([1_000n, 3_000n, 0n]);
    expect(rows.map((r) => r.share)).toEqual([0.5385, 0.3846, 0.0769]);
  });

  it('ranks the current round alone', () => {
    const rows = leaderboard(entries, rounds, 2n, 'round');
    expect(rows.map((r) => [r.rank, r.beneficiary, r.work])).toEqual([
      [1, '0xbbb', 600n],
      [2, '0xaaa', 200n],
      [3, '0xccc', 100n],
    ]);
    expect(rows[0]!.share).toBe(0.6667);
  });

  it('is empty without shares', () => {
    expect(leaderboard([], rounds, 2n, 'window')).toEqual([]);
  });
});
