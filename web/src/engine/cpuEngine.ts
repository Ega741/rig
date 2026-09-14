import type { CpuWorkerIn, CpuWorkerOut } from './cpuWorker';
import type { Engine, EngineConfig, Hit } from './types';

/** One Web Worker per core, each searching its own worker-id nonce space on the WASM keccak. */
export class CpuEngine implements Engine {
  readonly name = 'cpu';
  onHit: ((hit: Hit) => void) | null = null;
  onError: ((worker: number, message: string) => void) | null = null;

  private workers: Worker[] = [];
  private rates: number[] = [];
  private duties: number[] = [];

  constructor(readonly cores: number) {
    if (!Number.isInteger(cores) || cores < 1) throw new RangeError('cores must be a positive integer');
  }

  start(config: EngineConfig): void {
    this.stop();
    this.rates = new Array<number>(this.cores).fill(0);
    this.duties = new Array<number>(this.cores).fill(0);
    for (let i = 0; i < this.cores; i++) {
      const worker = new Worker(new URL('./cpuWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<CpuWorkerOut>) => this.handle(i, event.data);
      worker.onerror = (event) => this.onError?.(i, event.message);
      this.post(worker, { type: 'start', header: config.header, segment: config.segment.toString(), worker: i, difficulty: config.difficulty, intensity: config.intensity });
      this.workers.push(worker);
    }
  }

  update(config: EngineConfig): void {
    for (const worker of this.workers) {
      this.post(worker, { type: 'update', header: config.header, segment: config.segment.toString(), difficulty: config.difficulty, intensity: config.intensity });
    }
  }

  stop(): void {
    for (const worker of this.workers) {
      this.post(worker, { type: 'stop' });
      worker.terminate();
    }
    this.workers = [];
    this.rates = [];
    this.duties = [];
  }

  hashRate(): number {
    return this.rates.reduce((sum, rate) => sum + rate, 0);
  }

  dutyCycle(): number {
    return this.duties.length === 0 ? 0 : this.duties.reduce((sum, d) => sum + d, 0) / this.duties.length;
  }

  private post(worker: Worker, message: CpuWorkerIn): void {
    worker.postMessage(message);
  }

  private handle(index: number, msg: CpuWorkerOut): void {
    if (msg.type === 'hit') {
      this.onHit?.({ segment: BigInt(msg.segment), worker: BigInt(msg.worker), counter: BigInt(msg.counter), difficulty: msg.difficulty });
    } else if (msg.type === 'rate') {
      this.rates[index] = msg.ms > 0 ? (msg.hashes * 1000) / msg.ms : 0;
      this.duties[index] = msg.ms > 0 ? Math.min(1, msg.busyMs / msg.ms) : 0;
    } else if (msg.type === 'error') {
      this.onError?.(index, msg.message);
    }
  }
}
