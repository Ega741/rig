import { makeNonce } from '../engine/share';
import type { Hit } from '../engine/types';

export const MAX_NONCES = 64;
export const MAX_DIFFICULTY = 96;
/** About one submit per round for a miner searching at its own difficulty. */
export const TARGET_SHARES_PER_MINER = 32;
/** A batch is sent only if its expected reward is at least this many times its gas. */
export const PROFIT_MARGIN = 2;

// Execution gas from the plan-01 report (submit with 1 and 64 shares, new miner, active round).
const EXEC_GAS_ONE = 48_007n;
const EXEC_GAS_64 = 80_658n;

/** Smallest D >= minDifficulty that yields at most TARGET_SHARES_PER_MINER expected shares per round. */
export function difficultyForShares(hashRate: number, roundLength: number, minDifficulty: number): number {
  const expectedHashes = hashRate * roundLength;
  let d = minDifficulty;
  while (d < MAX_DIFFICULTY && expectedHashes / 2 ** d > TARGET_SHARES_PER_MINER) d++;
  return d;
}

/** Smallest D >= minDifficulty at which one share's expected value covers `margin` times the gas of a one-share submit. */
export function difficultyForGas(minDifficulty: number, valuePerHash: bigint, gasOneShare: bigint, margin: number): number {
  const needed = gasOneShare * BigInt(margin);
  let d = minDifficulty;
  while (d < MAX_DIFFICULTY && valuePerHash * (1n << BigInt(d)) < needed) d++;
  return d;
}

export interface DifficultyInput {
  hashRate: number;
  roundLength: number;
  minDifficulty: number;
  /** wei of ETH one hash is worth; null when the token price is unknown. */
  valuePerHash: bigint | null;
  /** wei of gas for a one-share submit; null when unknown. */
  gasOneShare: bigint | null;
}

/** Spec 6.4: D = max(minDifficulty, D for <= 32 shares, D at which a share pays its gas). */
export function chooseDifficulty(input: DifficultyInput): number {
  let d = difficultyForShares(input.hashRate, input.roundLength, input.minDifficulty);
  if (input.valuePerHash !== null && input.gasOneShare !== null && input.valuePerHash > 0n) {
    d = Math.max(d, difficultyForGas(input.minDifficulty, input.valuePerHash, input.gasOneShare, PROFIT_MARGIN));
  }
  return Math.min(d, MAX_DIFFICULTY);
}

/** Gas of submit(beneficiary, round, difficulty, nonces[shares]): execution plus calldata. */
export function submitGas(shares: number): bigint {
  const execution = EXEC_GAS_ONE + ((EXEC_GAS_64 - EXEC_GAS_ONE) * BigInt(shares - 1)) / BigInt(MAX_NONCES - 1);
  const calldata = 16n * (4n + 32n * BigInt(5 + shares));
  return execution + calldata;
}

export interface ValueInput {
  rewardPool: bigint;
  releaseBps: number;
  weiPerToken: bigint;
  networkWork: bigint;
}

/** wei of ETH one unit of work earns: releaseBps/1e4 of the pool, priced, spread over the round's expected work. */
export function valuePerHashWei(input: ValueInput): bigint {
  if (input.networkWork === 0n) return 0n;
  return (input.rewardPool * BigInt(input.releaseBps) * input.weiPerToken) / (10_000n * input.networkWork * 10n ** 18n);
}

export interface RewardInput {
  rewardPool: bigint;
  releaseBps: number;
  batchWork: bigint;
  networkWork: bigint;
}

/** Tokens (wei) a batch is expected to earn; the batch's own work is part of the round's work. */
export function expectedRewardTokens(input: RewardInput): bigint {
  const total = input.networkWork > input.batchWork ? input.networkWork : input.batchWork;
  if (total === 0n) return 0n;
  return (input.rewardPool * BigInt(input.releaseBps) * input.batchWork) / (10_000n * total);
}

export interface ProfitInput {
  rewardTokens: bigint;
  weiPerToken: bigint | null;
  gasWei: bigint;
  margin: number;
}

export function isProfitable(input: ProfitInput): boolean {
  if (input.weiPerToken === null) return true;
  const rewardWei = (input.rewardTokens * input.weiPerToken) / 10n ** 18n;
  return rewardWei >= input.gasWei * BigInt(input.margin);
}

export interface Batch {
  difficulty: number;
  nonces: bigint[];
  work: bigint;
}

/** One submit per (difficulty, chunk of 64), nonces strictly increasing as HashMine requires. */
export function buildBatches(hits: Hit[]): Batch[] {
  const byDifficulty = new Map<number, bigint[]>();
  for (const hit of hits) {
    const nonce = makeNonce(hit.segment, hit.worker, hit.counter);
    const list = byDifficulty.get(hit.difficulty) ?? [];
    list.push(nonce);
    byDifficulty.set(hit.difficulty, list);
  }
  const batches: Batch[] = [];
  for (const difficulty of [...byDifficulty.keys()].sort((a, b) => a - b)) {
    const nonces = [...new Set(byDifficulty.get(difficulty)!)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 0; i < nonces.length; i += MAX_NONCES) {
      const chunk = nonces.slice(i, i + MAX_NONCES);
      batches.push({ difficulty, nonces: chunk, work: BigInt(chunk.length) << BigInt(difficulty) });
    }
  }
  return batches;
}
