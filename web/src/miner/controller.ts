import type { Address, Hex } from 'viem';
import { headerBytes, isValidShare, makeNonce } from '../engine/share';
import type { Engine, Hit } from '../engine/types';
import {
  PROFIT_MARGIN,
  buildBatches,
  chooseDifficulty,
  expectedRewardTokens,
  isProfitable,
  submitGas,
  valuePerHashWei,
} from './policy';

export interface RoundState {
  round: bigint;
  /** unix seconds */
  genesis: number;
  roundLength: number;
  challenge: Hex;
  minDifficulty: number;
  roundWork: bigint;
  /** Work of the last active round, the difficulty anchor; 0 before the first share ever. */
  anchorWork: bigint;
  rewardPool: bigint;
  releaseBps: number;
  /** HashMine.pending(beneficiary) */
  pending: bigint;
}

export interface ChainReader {
  roundState(beneficiary: Address): Promise<RoundState>;
  gasPriceWei(): Promise<bigint>;
}

export interface Submitter {
  submit(beneficiary: Address, round: bigint, difficulty: number, nonces: bigint[]): Promise<Hex>;
  claim(beneficiary: Address): Promise<Hex>;
}

export interface PriceSource {
  /** wei per whole token (1e18 token-wei); null when unknown. */
  weiPerToken(): Promise<bigint | null>;
}

export interface ControllerOptions {
  beneficiary: Address;
  engines: Engine[];
  chain: ChainReader;
  submitter: Submitter;
  price: PriceSource;
  /** ms clock; Date.now in production */
  now?: () => number;
  /** Flush pending shares when this many seconds are left in the round. */
  flushBeforeEndSec?: number;
  /** Difficulty used until the engines report a hash rate, so a fast GPU does not flood cheap shares. 0 disables. */
  warmupDifficulty?: number;
  log?: (message: string) => void;
}

export type MinerEvent =
  | { type: 'round'; at: number; round: bigint }
  | { type: 'hit'; at: number; difficulty: number }
  | { type: 'submit'; at: number; count: number; tx: Hex };

export interface Snapshot {
  round: bigint;
  roundEndsAt: number;
  roundStartsAt: number;
  roundLength: number;
  releaseBps: number;
  roundWork: bigint;
  /** Work this beneficiary has submitted or buffered in the current round. */
  ownWork: bigint;
  challenge: Hex | null;
  difficulty: number;
  minDifficulty: number;
  segment: bigint;
  hashRate: number;
  hitsFound: number;
  sharesSubmitted: number;
  batchesSubmitted: number;
  buffered: number;
  rewardPool: bigint;
  pending: bigint;
  engineErrors: string[];
  lastError: string | null;
  lastTx: Hex | null;
}

/** Ties engines to HashMine: tracks the round, picks the difficulty, verifies hits, batches submits. */
export class MinerController {
  onSnapshot: ((snapshot: Snapshot) => void) | null = null;
  onEvent: ((event: MinerEvent) => void) | null = null;

  private readonly beneficiary: Address;
  private readonly engines: Engine[];
  private readonly chain: ChainReader;
  private readonly submitter: Submitter;
  private readonly price: PriceSource;
  private readonly now: () => number;
  private readonly flushBeforeEndSec: number;
  private readonly warmupDifficulty: number;
  private readonly log: (message: string) => void;

  private state: RoundState | null = null;
  private header: Uint8Array | null = null;
  private segment = 0n;
  private difficulty = 0;
  private buffer: Hit[] = [];
  private ownWork = 0n;
  private active = new Set<Engine>();
  private engineErrors: string[] = [];
  private hitsFound = 0;
  private sharesSubmitted = 0;
  private batchesSubmitted = 0;
  private lastError: string | null = null;
  private lastTx: Hex | null = null;
  private weiPerToken: bigint | null = null;
  private gasPrice = 0n;
  private pendingWork: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** false while `difficulty` was chosen without a measured hash rate (warm-up). */
  private difficultyFromKnownRate = false;

  constructor(options: ControllerOptions) {
    this.beneficiary = options.beneficiary;
    this.engines = options.engines;
    this.chain = options.chain;
    this.submitter = options.submitter;
    this.price = options.price;
    this.now = options.now ?? (() => Date.now());
    this.flushBeforeEndSec = options.flushBeforeEndSec ?? 20;
    this.warmupDifficulty = options.warmupDifficulty ?? 24;
    this.log = options.log ?? (() => {});
    for (const engine of this.engines) engine.onHit = (hit) => this.handleHit(engine, hit);
  }

  /** Periodic ticks; the first one starts the engines. */
  start(tickMs = 2000): void {
    if (this.timer) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const engine of this.active) engine.stop();
    this.active.clear();
  }

  /** Resolves once queued hit handling and flushes are done (tests). */
  idle(): Promise<void> {
    return this.pendingWork;
  }

  snapshot(): Snapshot {
    const s = this.state;
    return {
      round: s?.round ?? 0n,
      roundEndsAt: s ? (s.genesis + Number(s.round) * s.roundLength) * 1000 : 0,
      roundStartsAt: s ? (s.genesis + (Number(s.round) - 1) * s.roundLength) * 1000 : 0,
      roundLength: s?.roundLength ?? 0,
      releaseBps: s?.releaseBps ?? 0,
      roundWork: s?.roundWork ?? 0n,
      ownWork: this.ownWork,
      challenge: s?.challenge ?? null,
      difficulty: this.difficulty,
      minDifficulty: s?.minDifficulty ?? 0,
      segment: this.segment,
      hashRate: [...this.active].reduce((sum, engine) => sum + engine.hashRate(), 0),
      hitsFound: this.hitsFound,
      sharesSubmitted: this.sharesSubmitted,
      batchesSubmitted: this.batchesSubmitted,
      buffered: this.buffer.length,
      rewardPool: s?.rewardPool ?? 0n,
      pending: s?.pending ?? 0n,
      engineErrors: [...this.engineErrors],
      lastError: this.lastError,
      lastTx: this.lastTx,
    };
  }

  async tick(): Promise<void> {
    try {
      const [state, gasPrice, weiPerToken] = await Promise.all([
        this.chain.roundState(this.beneficiary),
        this.chain.gasPriceWei(),
        this.price.weiPerToken(),
      ]);
      if (this.stopped) return;
      this.gasPrice = gasPrice;
      this.weiPerToken = weiPerToken;
      const previous = this.state;
      this.state = state;
      if (!previous || previous.round !== state.round) {
        this.enterRound(state);
      } else {
        const wasWarmingUp = !this.difficultyFromKnownRate;
        const difficulty = this.pickDifficulty();
        // Two bits of hysteresis against rate jitter; a raised network minimum and the end of warm-up apply at once.
        const mustApply = this.difficulty < state.minDifficulty || wasWarmingUp;
        if (difficulty !== this.difficulty && (mustApply || Math.abs(difficulty - this.difficulty) >= 2)) {
          this.log(`difficulty ${this.difficulty} -> ${difficulty}`);
          this.difficulty = difficulty;
          this.configureEngines();
        }
      }
      const secondsLeft = state.genesis + Number(state.round) * state.roundLength - this.now() / 1000;
      if (this.buffer.length > 0 && secondsLeft <= this.flushBeforeEndSec) await this.flush();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log(`tick failed: ${this.lastError}`);
    }
    this.onSnapshot?.(this.snapshot());
  }

  /** Submits everything buffered, one transaction per (difficulty, 64 nonces). Serialised. */
  flush(): Promise<void> {
    const run = async () => {
      const state = this.state;
      if (!state || this.buffer.length === 0) return;
      const hits = this.buffer;
      this.buffer = [];
      // Later hits must carry a segment above everything sent so far: bump before sending.
      this.segment += 1n;
      this.configureEngines();
      const networkWork = this.estimateNetworkWork(state);
      for (const batch of buildBatches(hits)) {
        if (this.state?.round !== state.round) {
          this.log(`round moved on during flush; dropping the rest`);
          break;
        }
        const reward = expectedRewardTokens({ rewardPool: state.rewardPool, releaseBps: state.releaseBps, batchWork: batch.work, networkWork });
        const gasWei = submitGas(batch.nonces.length) * this.gasPrice;
        if (!isProfitable({ rewardTokens: reward, weiPerToken: this.weiPerToken, gasWei, margin: PROFIT_MARGIN })) {
          this.log(`skip batch of ${batch.nonces.length}: reward ${reward} < ${PROFIT_MARGIN}x gas ${gasWei}`);
          continue;
        }
        try {
          this.lastTx = await this.submitter.submit(this.beneficiary, state.round, batch.difficulty, batch.nonces);
          this.sharesSubmitted += batch.nonces.length;
          this.batchesSubmitted += 1;
          this.onEvent?.({ type: 'submit', at: this.now(), count: batch.nonces.length, tx: this.lastTx });
          this.lastError = null;
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.log(`submit failed: ${this.lastError}`);
        }
      }
      this.onSnapshot?.(this.snapshot());
    };
    this.pendingWork = this.pendingWork.then(run, run);
    return this.pendingWork;
  }

  /** Serialised behind pending submits so the session key never has two transactions in flight. */
  claim(): Promise<Hex> {
    const result = this.pendingWork.then(() => this.submitter.claim(this.beneficiary));
    this.pendingWork = result.then(
      () => undefined,
      () => undefined,
    );
    return result.then((tx) => {
      this.lastTx = tx;
      return tx;
    });
  }

  private enterRound(state: RoundState): void {
    this.log(`round ${state.round}, min difficulty ${state.minDifficulty}`);
    this.buffer = [];
    this.segment = 0n;
    this.ownWork = 0n;
    this.header = headerBytes(this.beneficiary, state.challenge);
    this.difficulty = this.pickDifficulty();
    if (this.active.size === 0) {
      for (const engine of this.engines) {
        if (this.engineErrors.some((e) => e.startsWith(engine.name))) continue;
        engine.start({ header: this.header, segment: this.segment, difficulty: this.difficulty });
        this.active.add(engine);
      }
    } else {
      this.configureEngines();
    }
    this.onEvent?.({ type: 'round', at: this.now(), round: state.round });
  }

  private configureEngines(): void {
    if (!this.header) return;
    for (const engine of this.active) engine.update({ header: this.header, segment: this.segment, difficulty: this.difficulty });
  }

  private pickDifficulty(): number {
    const state = this.state!;
    const hashRate =
      [...this.active].reduce((sum, engine) => sum + engine.hashRate(), 0) || this.engines.reduce((sum, e) => sum + e.hashRate(), 0);
    const valuePerHash =
      this.weiPerToken === null
        ? null
        : valuePerHashWei({ rewardPool: state.rewardPool, releaseBps: state.releaseBps, weiPerToken: this.weiPerToken, networkWork: this.estimateNetworkWork(state) });
    const gasOneShare = this.gasPrice > 0n ? submitGas(1) * this.gasPrice : null;
    const chosen = chooseDifficulty({ hashRate, roundLength: state.roundLength, minDifficulty: state.minDifficulty, valuePerHash, gasOneShare });
    this.difficultyFromKnownRate = hashRate > 0;
    return hashRate > 0 ? chosen : Math.min(Math.max(chosen, this.warmupDifficulty), 96);
  }

  /** Work the round will end with: the anchor's work, or the current round's pace, whichever is larger. */
  private estimateNetworkWork(state: RoundState): bigint {
    const elapsed = Math.max(this.now() / 1000 - (state.genesis + (Number(state.round) - 1) * state.roundLength), 1);
    const paced = (state.roundWork * BigInt(state.roundLength)) / BigInt(Math.ceil(elapsed));
    return paced > state.anchorWork ? paced : state.anchorWork;
  }

  private handleHit(engine: Engine, hit: Hit): void {
    const state = this.state;
    if (!state || !this.active.has(engine)) return;
    if (hit.segment !== this.segment) return; // superseded by a flush or a new round
    const nonce = makeNonce(hit.segment, hit.worker, hit.counter);
    if (!isValidShare(this.beneficiary, state.challenge, nonce, hit.difficulty)) {
      engine.stop();
      this.active.delete(engine);
      this.engineErrors.push(`${engine.name}: reported an invalid share, engine disabled`);
      this.log(this.engineErrors[this.engineErrors.length - 1]!);
      return;
    }
    this.hitsFound += 1;
    this.buffer.push(hit);
    this.ownWork += 1n << BigInt(hit.difficulty);
    this.onEvent?.({ type: 'hit', at: this.now(), difficulty: hit.difficulty });
    if (this.buffer.length >= 64) void this.flush();
  }
}
