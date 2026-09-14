import { loadKeccakWasm, type KeccakWasm } from './wasm';

/** Messages from CpuEngine. bigint travels as decimal strings: structured clone supports bigint, but strings keep DevTools readable. */
export type CpuWorkerIn =
  | { type: 'start'; header: Uint8Array; segment: string; worker: number; difficulty: number }
  | { type: 'update'; header: Uint8Array; segment: string; difficulty: number }
  | { type: 'stop' };

export type CpuWorkerOut =
  | { type: 'ready' }
  | { type: 'hit'; segment: string; worker: number; counter: string; difficulty: number }
  | { type: 'rate'; hashes: number; ms: number }
  | { type: 'error'; message: string };

const CHUNK = 1 << 16;
const REPORT_MS = 500;

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<CpuWorkerIn>) => void) | null;
  postMessage(message: CpuWorkerOut): void;
};

let wasm: KeccakWasm | null = null;
let running = false;
let workerId = 0n;
let segment = 0n;
let difficulty = 0;
let counter = 0n;
let generation = 0;
let header: Uint8Array = new Uint8Array(52);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

// setTimeout(0) is clamped to >= 4 ms after a few nested calls; a MessageChannel hop is not.
const yieldChannel = new MessageChannel();
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(null);
  });
}

async function loop(myGeneration: number): Promise<void> {
  let hashes = 0;
  let since = performance.now();
  while (running && myGeneration === generation && wasm) {
    const found = wasm.search(segment, workerId, counter, CHUNK, difficulty);
    if (found === null) {
      hashes += CHUNK;
      counter += BigInt(CHUNK);
    } else {
      hashes += Number(found - counter) + 1;
      ctx.postMessage({ type: 'hit', segment: segment.toString(), worker: Number(workerId), counter: found.toString(), difficulty });
      counter = found + 1n;
    }
    const now = performance.now();
    if (now - since >= REPORT_MS) {
      ctx.postMessage({ type: 'rate', hashes, ms: now - since });
      hashes = 0;
      since = now;
    }
    // Yield so 'update'/'stop' messages get through between chunks (~12 ms each at 5 MH/s).
    await yieldToEventLoop();
  }
}

ctx.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'start') {
      if (!wasm) wasm = await loadKeccakWasm();
      workerId = BigInt(msg.worker);
      header = msg.header;
      segment = BigInt(msg.segment);
      difficulty = msg.difficulty;
      counter = 0n;
      wasm.setHeader(header);
      running = true;
      ctx.postMessage({ type: 'ready' });
      void loop(++generation);
    } else if (msg.type === 'update') {
      const newSegment = BigInt(msg.segment);
      if (!sameBytes(header, msg.header) || newSegment !== segment) counter = 0n;
      header = msg.header;
      segment = newSegment;
      difficulty = msg.difficulty;
      wasm?.setHeader(header);
    } else if (msg.type === 'stop') {
      running = false;
      generation++;
    }
  } catch (error) {
    ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
