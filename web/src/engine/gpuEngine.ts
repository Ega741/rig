import { BLOCK_WORDS, blockWords, keccakShaderSource } from './keccakWgsl';
import { GPU_WORKER_ID, idleRatio, type Engine, type EngineConfig, type Hit } from './types';

const WORKGROUP_SIZE = 256;
const MAX_HITS = 1024;
const MIN_DISPATCH = 1 << 16;
const MAX_DISPATCH = 1 << 24;
/** Target wall time of one dispatch: long enough to amortise readback, short enough to keep the page drawing. */
const TARGET_MS = 60;

interface DispatchResult {
  hits: Array<{ lo: number; hi: number }>;
  hitCount: number;
  debugHash: Uint32Array;
  ms: number;
}

/** WebGPU share search. One dispatch hashes `count` consecutive counters of the GPU worker id. */
export class GpuEngine implements Engine {
  readonly name = 'gpu';
  onHit: ((hit: Hit) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private config: EngineConfig | null = null;
  private running = false;
  private base = 0n;
  private dispatchSize = 1 << 20;
  private rate = 0;
  private duty = 0;
  private windowBusy = 0;
  private windowWall = 0;
  private windowStart = 0;

  private readonly paramsBuffer: GPUBuffer;
  private readonly blockBuffer: GPUBuffer;
  private readonly hitsBuffer: GPUBuffer;
  private readonly debugBuffer: GPUBuffer;
  private readonly hitsStaging: GPUBuffer;
  private readonly debugStaging: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    readonly adapterInfo: { vendor: string; architecture: string; description: string },
  ) {
    const hitsSize = 8 + 8 * MAX_HITS;
    this.paramsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blockBuffer = device.createBuffer({ size: 4 * BLOCK_WORDS, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.hitsBuffer = device.createBuffer({ size: hitsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.debugBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.hitsStaging = device.createBuffer({ size: hitsSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.debugStaging = device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.blockBuffer } },
        { binding: 2, resource: { buffer: this.hitsBuffer } },
        { binding: 3, resource: { buffer: this.debugBuffer } },
      ],
    });
  }

  /** null when the browser has no WebGPU or no adapter; throws on shader compile errors. */
  static async create(): Promise<GpuEngine | null> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: keccakShaderSource(WORKGROUP_SIZE) });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);
    if (errors.length > 0) throw new Error(`WGSL: ${errors.join(' | ')}`);
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const raw = adapter.info;
    return new GpuEngine(device, pipeline, { vendor: raw.vendor, architecture: raw.architecture, description: raw.description });
  }

  start(config: EngineConfig): void {
    this.config = config;
    this.base = 0n;
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  update(config: EngineConfig): void {
    const previous = this.config;
    if (!previous || previous.segment !== config.segment || !sameBytes(previous.header, config.header)) this.base = 0n;
    this.config = config;
  }

  stop(): void {
    this.running = false;
    this.windowStart = 0;
    this.windowBusy = 0;
  }

  hashRate(): number {
    return this.running ? this.rate : 0;
  }

  dutyCycle(): number {
    return this.running ? this.duty : 0;
  }

  /** Hash of one nonce, for cross-implementation tests. Not used while mining. */
  async hashOne(header: Uint8Array, segment: bigint, worker: bigint, counter: bigint): Promise<Uint8Array> {
    const result = await this.dispatch(blockWords(header, segment, worker), counter, 1, 200, 1);
    return new Uint8Array(result.debugHash.buffer.slice(0, 32));
  }

  private async loop(): Promise<void> {
    try {
      while (this.running && this.config) {
        const { header, segment, difficulty } = this.config;
        const base = this.base;
        const count = this.dispatchSize;
        const cycleStart = performance.now();
        const result = await this.dispatch(blockWords(header, segment, GPU_WORKER_ID), base, count, difficulty, 0);
        // A config change during the dispatch restarted the counter space; drop these hits.
        if (this.config.segment === segment && sameBytes(this.config.header, header)) {
          this.base = base + BigInt(count);
          for (const { lo, hi } of result.hits) {
            const counter = (BigInt(hi) << 32n) | BigInt(lo);
            this.onHit?.({ segment, worker: GPU_WORKER_ID, counter, difficulty });
          }
        }
        if (result.ms < TARGET_MS / 2 && this.dispatchSize < MAX_DISPATCH) this.dispatchSize *= 2;
        else if (result.ms > TARGET_MS * 2 && this.dispatchSize > MIN_DISPATCH) this.dispatchSize /= 2;
        // Duty cycle: rest in proportion to the whole busy cycle (dispatch + readback), so the GPU share of
        // wall time stays below the cap; the reported rate covers the whole cycle.
        const busy = performance.now() - cycleStart;
        const rest = busy * idleRatio(this.config.intensity);
        if (rest >= 1) await new Promise<void>((resolve) => setTimeout(resolve, rest));
        const cycle = performance.now() - cycleStart;
        this.rate = (count * 1000) / cycle;
        // Duty measured over ~1 s windows of real wall time, including the rests.
        if (this.windowStart === 0) this.windowStart = cycleStart;
        this.windowBusy += busy;
        this.windowWall = performance.now() - this.windowStart;
        if (this.windowWall >= 1000) {
          this.duty = Math.min(1, this.windowBusy / this.windowWall);
          this.windowBusy = 0;
          this.windowStart = performance.now();
        }
      }
    } catch (error) {
      this.running = false;
      this.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private async dispatch(words: Uint32Array<ArrayBuffer>, base: bigint, count: number, difficulty: number, debug: number): Promise<DispatchResult> {
    const device = this.device;
    const baseLo = Number(base & 0xffffffffn);
    const baseHi = Number((base >> 32n) & 0xffffffffn);
    device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([baseLo, baseHi, count, difficulty, MAX_HITS, debug, 0, 0]));
    device.queue.writeBuffer(this.blockBuffer, 0, words);
    device.queue.writeBuffer(this.hitsBuffer, 0, new Uint32Array(2 + 2 * MAX_HITS));
    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(this.hitsBuffer, 0, this.hitsStaging, 0, 8 + 8 * MAX_HITS);
    encoder.copyBufferToBuffer(this.debugBuffer, 0, this.debugStaging, 0, 32);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = Math.max(performance.now() - t0, 0.001);

    await this.hitsStaging.mapAsync(GPUMapMode.READ);
    const hitWords = new Uint32Array(this.hitsStaging.getMappedRange().slice(0));
    this.hitsStaging.unmap();
    await this.debugStaging.mapAsync(GPUMapMode.READ);
    const debugHash = new Uint32Array(this.debugStaging.getMappedRange().slice(0));
    this.debugStaging.unmap();

    const hitCount = hitWords[0]!;
    const hits: DispatchResult['hits'] = [];
    for (let i = 0; i < Math.min(hitCount, MAX_HITS); i++) hits.push({ lo: hitWords[2 + 2 * i]!, hi: hitWords[3 + 2 * i]! });
    return { hits, hitCount, debugHash, ms };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
