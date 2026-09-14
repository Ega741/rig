import { describe, expect, it } from 'vitest';
import type { Hit } from '../../engine/types';
import {
  MAX_NONCES,
  buildBatches,
  chooseDifficulty,
  difficultyForGas,
  difficultyForShares,
  expectedRewardTokens,
  isProfitable,
  submitGas,
  valuePerHashWei,
} from '../policy';

const hit = (segment: bigint, worker: bigint, counter: bigint, difficulty: number): Hit => ({ segment, worker, counter, difficulty });

describe('difficultyForShares', () => {
  it('matches the simulation vectors (<= 32 expected shares per round)', () => {
    // farm 6 GH/s * 600 s = 3.6e12 hashes: 2^36 -> 52 shares, 2^37 -> 26.
    expect(difficultyForShares(6e9, 600, 20)).toBe(37);
    // 4-core CPU 23.2 MH/s: 1.392e10 hashes: 2^28 -> 51.9, 2^29 -> 25.9.
    expect(difficultyForShares(23.2e6, 600, 20)).toBe(29);
  });

  it('never goes below the network minimum, nor above 96', () => {
    expect(difficultyForShares(23.2e6, 600, 35)).toBe(35);
    expect(difficultyForShares(0, 600, 20)).toBe(20);
    expect(difficultyForShares(1e30, 600, 20)).toBe(96);
  });
});

describe('difficultyForGas', () => {
  it('raises difficulty until one share pays twice its gas', () => {
    // value 1e-13 ETH/hash = 1e5 wei/hash; gas of one share 0.01 ETH = 1e16 wei; margin 2 -> 2^D >= 2e11 -> D = 38.
    expect(difficultyForGas(20, 100_000n, 10n ** 16n, 2)).toBe(38);
  });
  it('keeps the minimum when a share already pays', () => {
    expect(difficultyForGas(20, 10n ** 18n, 1n, 2)).toBe(20);
  });
});

describe('chooseDifficulty', () => {
  it('takes the max of the minimum, the share target and the gas floor', () => {
    expect(chooseDifficulty({ hashRate: 23.2e6, roundLength: 600, minDifficulty: 20, valuePerHash: 100_000n, gasOneShare: 10n ** 16n })).toBe(38);
    expect(chooseDifficulty({ hashRate: 6e9, roundLength: 600, minDifficulty: 20, valuePerHash: null, gasOneShare: null })).toBe(37);
  });
});

describe('gas and reward', () => {
  it('reproduces the plan-01 gas report endpoints plus calldata', () => {
    expect(submitGas(1)).toBe(48_007n + 16n * (4n + 32n * 6n));
    expect(submitGas(64)).toBe(80_658n + 16n * (4n + 32n * 69n));
  });

  it('computes value per hash in wei', () => {
    // pool 1e24 token-wei, 48 bps, 1 token = 1e15 wei, network work 1e12 -> 1e24*48/1e4*1e15/1e18/1e12 = 4.8e6 wei.
    expect(valuePerHashWei({ rewardPool: 10n ** 24n, releaseBps: 48, weiPerToken: 10n ** 15n, networkWork: 10n ** 12n })).toBe(4_800_000n);
  });

  it('splits the release in proportion to work', () => {
    expect(expectedRewardTokens({ rewardPool: 10n ** 24n, releaseBps: 48, batchWork: 10n ** 11n, networkWork: 10n ** 12n })).toBe(48n * 10n ** 19n);
    expect(expectedRewardTokens({ rewardPool: 10n ** 24n, releaseBps: 48, batchWork: 10n ** 12n, networkWork: 10n ** 11n })).toBe(48n * 10n ** 20n);
  });

  it('is profitable when reward >= margin * gas, and always when the price is unknown', () => {
    expect(isProfitable({ rewardTokens: 10n ** 18n, weiPerToken: 10n ** 15n, gasWei: 4n * 10n ** 14n, margin: 2 })).toBe(true);
    expect(isProfitable({ rewardTokens: 10n ** 18n, weiPerToken: 10n ** 15n, gasWei: 6n * 10n ** 14n, margin: 2 })).toBe(false);
    expect(isProfitable({ rewardTokens: 1n, weiPerToken: null, gasWei: 10n ** 18n, margin: 2 })).toBe(true);
  });
});

describe('buildBatches', () => {
  it('groups by difficulty, sorts nonces and chunks by 64', () => {
    const hits: Hit[] = [];
    for (let i = 130; i >= 1; i--) hits.push(hit(3n, BigInt(i % 3), BigInt(i), 30));
    hits.push(hit(3n, 255n, 5n, 31));
    const batches = buildBatches(hits);
    expect(batches.map((b) => [b.difficulty, b.nonces.length])).toEqual([[30, 64], [30, 64], [30, 2], [31, 1]]);
    for (const batch of batches) {
      for (let i = 1; i < batch.nonces.length; i++) expect(batch.nonces[i]! > batch.nonces[i - 1]!).toBe(true);
    }
    // Smallest nonce: worker 0 (i % 3 == 0), counter 3.
    expect(batches[0]!.nonces[0]).toBe((3n << 128n) | 3n);
    expect(batches[1]!.nonces[0]! > batches[0]!.nonces[63]!).toBe(true);
    expect(MAX_NONCES).toBe(64);
  });
});
