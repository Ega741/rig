import { parseAbiItem, type Address, type PublicClient } from 'viem';
import { hashMineAbi } from '../chain/abi/hashMine';

export interface RoundRow {
  round: bigint;
  work: bigint;
  release: bigint;
  minDifficulty: number;
  closed: boolean;
  active: boolean;
}

export interface ShareEntry {
  beneficiary: string;
  round: bigint;
  count: number;
  work: bigint;
}

export interface LeaderRow {
  rank: number;
  beneficiary: string;
  /** Work in the ranked scope (the window, or the current round). */
  work: bigint;
  /** Share of the scope's total work, 0..1. */
  share: number;
  shares: number;
  rounds: number;
  /** ETH from closed rounds in the window: release x work / round work, per round. */
  earned: bigint;
}

export interface MinerSummary {
  miners: number;
  shares: number;
  batches: number;
}

const SHARE_BATCH = parseAbiItem(
  'event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)',
);

/** Last `count` rounds up to and including `latest`, newest first. */
export async function loadRounds(client: PublicClient, hashMine: Address, latest: bigint, count: number): Promise<RoundRow[]> {
  const rounds: bigint[] = [];
  for (let r = latest; r >= 1n && rounds.length < count; r--) rounds.push(r);
  const infos = await Promise.all(
    rounds.map((round) => client.readContract({ address: hashMine, abi: hashMineAbi, functionName: 'roundInfo', args: [round] })),
  );
  return rounds.map((round, i) => {
    const info = infos[i]!;
    return {
      round,
      work: info.work,
      release: info.closed ? (info.rewardPerWork * info.work) / 10n ** 36n : 0n,
      minDifficulty: info.minDifficulty,
      closed: info.closed,
      active: info.work > 0n,
    };
  });
}

/** [from, to] block ranges covering the last `span` blocks in chunks of `chunk`, newest first. */
export function blockRanges(latest: bigint, span: number, chunk: number): Array<[bigint, bigint]> {
  const ranges: Array<[bigint, bigint]> = [];
  let to = latest;
  const floor = latest > BigInt(span) ? latest - BigInt(span) : 0n;
  while (to >= floor) {
    const from = to - BigInt(chunk) + 1n > floor ? to - BigInt(chunk) + 1n : floor;
    ranges.push([from, to]);
    if (from === floor) break;
    to = from - 1n;
  }
  return ranges;
}

/** ShareBatch events of the last `span` blocks. Robinhood RPCs take 100k-block ranges; anvil takes anything. */
export async function loadShareEntries(client: PublicClient, hashMine: Address, span: number, chunk = 20_000): Promise<ShareEntry[]> {
  const latest = await client.getBlockNumber();
  const entries: ShareEntry[] = [];
  for (const [fromBlock, toBlock] of blockRanges(latest, span, chunk)) {
    const logs = await client.getLogs({ address: hashMine, event: SHARE_BATCH, fromBlock, toBlock });
    for (const log of logs) entries.push({ beneficiary: log.args.beneficiary!, round: log.args.round!, count: Number(log.args.count!), work: log.args.work! });
  }
  return entries;
}

/**
 * Miners ranked by work. `scope` "round" ranks the current round only; "window" ranks every entry and
 * credits ETH from the closed rounds in `rounds` (the contract's split: release x work / round work).
 */
export function leaderboard(entries: ShareEntry[], rounds: RoundRow[], currentRound: bigint, scope: 'round' | 'window'): LeaderRow[] {
  const closed = new Map(rounds.filter((r) => r.closed && r.work > 0n).map((r) => [r.round, r]));
  const scoped = scope === 'round' ? entries.filter((e) => e.round === currentRound) : entries;
  const byMiner = new Map<string, { work: bigint; shares: number; rounds: Set<bigint>; earned: bigint; perRound: Map<bigint, bigint> }>();
  for (const e of scoped) {
    const key = e.beneficiary.toLowerCase();
    const m = byMiner.get(key) ?? { work: 0n, shares: 0, rounds: new Set<bigint>(), earned: 0n, perRound: new Map<bigint, bigint>() };
    m.work += e.work;
    m.shares += e.count;
    m.rounds.add(e.round);
    m.perRound.set(e.round, (m.perRound.get(e.round) ?? 0n) + e.work);
    byMiner.set(key, m);
  }
  for (const m of byMiner.values()) {
    for (const [round, work] of m.perRound) {
      const info = closed.get(round);
      if (info) m.earned += (info.release * work) / info.work;
    }
  }
  const total = [...byMiner.values()].reduce((sum, m) => sum + m.work, 0n);
  return [...byMiner.entries()]
    .sort((a, b) => (a[1].work === b[1].work ? a[0].localeCompare(b[0]) : a[1].work > b[1].work ? -1 : 1))
    .map(([beneficiary, m], i) => ({
      rank: i + 1,
      beneficiary,
      work: m.work,
      share: total === 0n ? 0 : Number((m.work * 10_000n + total / 2n) / total) / 10_000,
      shares: m.shares,
      rounds: m.rounds.size,
      earned: m.earned,
    }));
}

export function summarizeMiners(entries: ShareEntry[]): MinerSummary {
  const miners = new Set(entries.map((e) => e.beneficiary.toLowerCase()));
  return { miners: miners.size, shares: entries.reduce((sum, e) => sum + e.count, 0), batches: entries.length };
}
