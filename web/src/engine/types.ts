/** What every engine searches: a 52-byte header (beneficiary ++ challenge), a segment and a difficulty. */
export interface EngineConfig {
  header: Uint8Array;
  segment: bigint;
  difficulty: number;
}

/** A candidate share reported by an engine. The host recomputes the hash before trusting it. */
export interface Hit {
  segment: bigint;
  worker: bigint;
  counter: bigint;
  difficulty: number;
}

export interface Engine {
  readonly name: string;
  start(config: EngineConfig): void;
  /** New round/segment/difficulty. Counters restart when header or segment change. */
  update(config: EngineConfig): void;
  stop(): void;
  onHit: ((hit: Hit) => void) | null;
  /** Hashes per second over the most recent reports; 0 before the first report. */
  hashRate(): number;
}

/** Worker id reserved for the GPU engine; CPU workers use 0..cores-1. */
export const GPU_WORKER_ID = 255n;
