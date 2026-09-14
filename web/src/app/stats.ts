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
  count: number;
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

export async function loadShareEntries(client: PublicClient, hashMine: Address, span: number, chunk = 2000): Promise<ShareEntry[]> {
  const latest = await client.getBlockNumber();
  const entries: ShareEntry[] = [];
  for (const [fromBlock, toBlock] of blockRanges(latest, span, chunk)) {
    const logs = await client.getLogs({ address: hashMine, event: SHARE_BATCH, fromBlock, toBlock });
    for (const log of logs) entries.push({ beneficiary: log.args.beneficiary!, count: Number(log.args.count!) });
  }
  return entries;
}

export function summarizeMiners(entries: ShareEntry[]): MinerSummary {
  const miners = new Set(entries.map((e) => e.beneficiary.toLowerCase()));
  return { miners: miners.size, shares: entries.reduce((sum, e) => sum + e.count, 0), batches: entries.length };
}
