import { describe, expect, it } from 'vitest';
import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';
import { isValidShare, makeNonce, splitNonce } from '../../engine/share';
import type { Engine, EngineConfig, Hit } from '../../engine/types';
import { MinerController, type ChainReader, type PriceSource, type RoundState, type Submitter } from '../controller';

const BENEFICIARY = getAddress('0x1111111111111111111111111111111111111111') as Address;

class FakeEngine implements Engine {
  readonly name = 'fake';
  onHit: ((hit: Hit) => void) | null = null;
  config: EngineConfig | null = null;
  started = 0;
  stopped = 0;
  rate = 1e6;
  start(config: EngineConfig): void {
    this.config = config;
    this.started++;
  }
  update(config: EngineConfig): void {
    this.config = config;
  }
  stop(): void {
    this.stopped++;
  }
  hashRate(): number {
    return this.rate;
  }
  /** Emits a real share of the configured difficulty (brute force; difficulty is tiny in tests). */
  emitValid(challenge: Hex, worker = 0n): Hit {
    const { segment, difficulty } = this.config!;
    let counter = 0n;
    while (!isValidShare(BENEFICIARY, challenge, makeNonce(segment, worker, counter), difficulty)) counter++;
    const hit = { segment, worker, counter, difficulty };
    this.onHit?.(hit);
    return hit;
  }
  emitBogus(): void {
    const { segment, difficulty } = this.config!;
    this.onHit?.({ segment, worker: 9n, counter: 123456789n, difficulty: difficulty + 40 });
  }
}

class FakeChain implements ChainReader {
  state: RoundState;
  constructor(state: RoundState) {
    this.state = state;
  }
  async roundState(): Promise<RoundState> {
    return { ...this.state };
  }
  async gasPriceWei(): Promise<bigint> {
    return 100_000_000n; // 0.1 gwei
  }
}

class FakeSubmitter implements Submitter {
  submits: Array<{ round: bigint; difficulty: number; nonces: bigint[] }> = [];
  claims = 0;
  async submit(_beneficiary: Address, round: bigint, difficulty: number, nonces: bigint[]): Promise<Hex> {
    this.submits.push({ round, difficulty, nonces });
    return '0xabc';
  }
  async claim(): Promise<Hex> {
    this.claims++;
    return '0xdef';
  }
}

const noPrice: PriceSource = { weiPerToken: async () => null };

function state(round: bigint, now: number): RoundState {
  const roundLength = 600;
  return {
    round,
    genesis: now - (Number(round) - 1) * roundLength,
    roundLength,
    challenge: keccak256(toHex(round)),
    minDifficulty: 4,
    roundWork: 0n,
    anchorWork: 0n,
    rewardPool: 10n ** 24n,
    releaseBps: 48,
    pending: 0n,
  };
}

function setup(now = 1_000_000, options: { warmupDifficulty?: number } = {}) {
  const engine = new FakeEngine();
  const chain = new FakeChain(state(1n, now));
  const submitter = new FakeSubmitter();
  let clock = now * 1000;
  const controller = new MinerController({
    beneficiary: BENEFICIARY,
    engines: [engine],
    chain,
    submitter,
    price: noPrice,
    now: () => clock,
    flushBeforeEndSec: 20,
    warmupDifficulty: options.warmupDifficulty ?? 0,
  });
  return { engine, chain, submitter, controller, advance: (sec: number) => (clock += sec * 1000) };
}

describe('MinerController', () => {
  it('starts engines on the first tick with the round header and chosen difficulty', async () => {
    const { engine, controller } = setup();
    await controller.tick();
    expect(engine.started).toBe(1);
    // 1 MH/s * 600 s = 6e8 hashes; 2^24 -> 35.8 shares, 2^25 -> 17.9.
    expect(engine.config?.difficulty).toBe(25);
    expect(engine.config?.segment).toBe(0n);
    expect(engine.config?.header).toHaveLength(52);
    expect(controller.snapshot().round).toBe(1n);
  });

  it('collects verified hits and submits 64 at once, bumping the segment', async () => {
    const { engine, chain, submitter, controller } = setup();
    engine.rate = 0; // difficulty stays at the minimum (4) so shares are cheap to brute force
    await controller.tick();
    expect(engine.config?.difficulty).toBe(4);
    let counter = 0n;
    for (let i = 0; i < 64; i++) {
      const { segment, difficulty } = engine.config!;
      while (!isValidShare(BENEFICIARY, chain.state.challenge, makeNonce(segment, 0n, counter), difficulty)) counter++;
      engine.onHit?.({ segment, worker: 0n, counter, difficulty });
      counter++;
    }
    await controller.idle();
    expect(submitter.submits).toHaveLength(1);
    expect(submitter.submits[0]!.nonces).toHaveLength(64);
    expect(submitter.submits[0]!.round).toBe(1n);
    expect(engine.config?.segment).toBe(1n);
    expect(controller.snapshot().sharesSubmitted).toBe(64);
  });

  it('drops an engine whose hit does not verify', async () => {
    const { engine, controller } = setup();
    await controller.tick();
    engine.emitBogus();
    await controller.idle();
    expect(engine.stopped).toBe(1);
    expect(controller.snapshot().engineErrors).toEqual([expect.stringContaining('fake')]);
  });

  it('flushes what it has when the round is about to end', async () => {
    const { engine, chain, submitter, controller, advance } = setup();
    engine.rate = 0;
    await controller.tick();
    engine.emitValid(chain.state.challenge);
    await controller.tick();
    expect(submitter.submits).toHaveLength(0);
    advance(585);
    await controller.tick();
    expect(submitter.submits).toHaveLength(1);
    expect(submitter.submits[0]!.nonces).toHaveLength(1);
  });

  it('ignores hits from a superseded segment', async () => {
    const { engine, chain, submitter, controller } = setup();
    engine.rate = 0;
    await controller.tick();
    const stale = engine.emitValid(chain.state.challenge);
    await controller.flush();
    expect(submitter.submits).toHaveLength(1);
    engine.onHit?.(stale);
    await controller.flush();
    expect(submitter.submits).toHaveLength(1);
    expect(splitNonce(submitter.submits[0]!.nonces[0]!).segment).toBe(0n);
  });

  it('switches to a new round: drops the buffer, resets the segment, updates engines', async () => {
    const { engine, chain, submitter, controller, advance } = setup();
    engine.rate = 0;
    await controller.tick();
    engine.emitValid(chain.state.challenge);
    await controller.flush();
    expect(engine.config?.segment).toBe(1n);
    engine.emitValid(chain.state.challenge);
    advance(600);
    chain.state = state(2n, 1_000_000 - 600);
    await controller.tick();
    expect(controller.snapshot().round).toBe(2n);
    expect(engine.config?.segment).toBe(0n);
    expect(engine.started).toBe(1);
    await controller.flush();
    expect(submitter.submits).toHaveLength(1);
  });

  it('uses the warm-up difficulty until a hash rate is known', async () => {
    const { engine, controller } = setup(1_000_000, { warmupDifficulty: 24 });
    engine.rate = 0;
    await controller.tick();
    expect(engine.config?.difficulty).toBe(24);
    engine.rate = 1e6;
    await controller.tick();
    expect(engine.config?.difficulty).toBe(25);
  });

  it('applies two bits of hysteresis to rate jitter', async () => {
    const { engine, controller } = setup();
    await controller.tick();
    expect(engine.config?.difficulty).toBe(25);
    engine.rate = 3e6; // -> 26 alone: within one bit, keep 25
    await controller.tick();
    expect(engine.config?.difficulty).toBe(25);
    engine.rate = 6e6; // -> 27: two bits away, change
    await controller.tick();
    expect(engine.config?.difficulty).toBe(27);
  });

  it('claim waits for an in-flight submit', async () => {
    const { engine, chain, submitter, controller } = setup();
    engine.rate = 0;
    await controller.tick();
    engine.emitValid(chain.state.challenge);
    const order: string[] = [];
    const originalSubmit = submitter.submit.bind(submitter);
    submitter.submit = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('submit');
      return originalSubmit(...args);
    };
    const originalClaim = submitter.claim.bind(submitter);
    submitter.claim = async () => {
      order.push('claim');
      return originalClaim();
    };
    void controller.flush();
    await controller.claim();
    expect(order).toEqual(['submit', 'claim']);
  });

  it('claim goes through the submitter and stop stops engines', async () => {
    const { engine, submitter, controller } = setup();
    await controller.tick();
    await controller.claim();
    expect(submitter.claims).toBe(1);
    controller.stop();
    expect(engine.stopped).toBe(1);
  });

  it('reports events and round timing for the UI', async () => {
    const { engine, chain, controller, advance } = setup();
    engine.rate = 0;
    const events: string[] = [];
    controller.onEvent = (event) => events.push(event.type);
    await controller.tick();
    engine.emitValid(chain.state.challenge);
    await controller.flush();
    const s = controller.snapshot();
    expect(s.roundStartsAt).toBe(1_000_000 * 1000);
    expect(s.roundLength).toBe(600);
    expect(s.releaseBps).toBe(48);
    expect(s.ownWork).toBe(1n << 4n);
    expect(events).toEqual(['round', 'hit', 'submit']);
    advance(600);
    chain.state = state(2n, 1_000_000 - 600);
    await controller.tick();
    expect(events.at(-1)).toBe('round');
  });
});
