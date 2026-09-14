/** What every engine searches: a 52-byte header (beneficiary ++ challenge), a segment and a difficulty. */
export interface EngineConfig {
  header: Uint8Array;
  segment: bigint;
  difficulty: number;
  /** Duty cycle in percent (1..100): the engine works a slice of time, then idles (100 - intensity) / intensity of it. */
  intensity: number;
}

/** Idle time per unit of busy time for a duty cycle; 50 -> 1 (equal work and rest). */
export function idleRatio(intensity: number): number {
  const i = Math.min(100, Math.max(1, intensity));
  return (100 - i) / i;
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
  /** Measured share of wall time spent hashing (0..1) over the most recent reports; 0 before the first report. */
  dutyCycle(): number;
}

/** Worker id reserved for the GPU engine; CPU workers use 0..cores-1. */
export const GPU_WORKER_ID = 255n;
