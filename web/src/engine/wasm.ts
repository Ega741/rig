interface KeccakExports {
  memory: WebAssembly.Memory;
  header_ptr(): number;
  out_ptr(): number;
  search(segment: bigint, worker: bigint, start: bigint, count: number, difficulty: number): bigint;
  hash_into(segment: bigint, worker: bigint, counter: bigint): void;
}

/** Typed wrapper over miner-wasm (see miner-wasm/src/lib.rs). One instance per worker. */
export class KeccakWasm {
  private constructor(private readonly ex: KeccakExports) {}

  static async instantiate(bytes: BufferSource): Promise<KeccakWasm> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new KeccakWasm(instance.exports as unknown as KeccakExports);
  }

  /** beneficiary (20 bytes) ++ challenge (32 bytes). */
  setHeader(header: Uint8Array): void {
    if (header.length !== 52) throw new RangeError('header must be 52 bytes');
    new Uint8Array(this.ex.memory.buffer).set(header, this.ex.header_ptr());
  }

  /** 32-byte hash of one nonce, in wire (big-endian) byte order. */
  hash(segment: bigint, worker: bigint, counter: bigint): Uint8Array {
    this.ex.hash_into(segment, worker, counter);
    const ptr = this.ex.out_ptr();
    return new Uint8Array(this.ex.memory.buffer.slice(ptr, ptr + 32));
  }

  /** First counter in [start, start + count) whose hash has >= difficulty leading zero bits, else null. */
  search(segment: bigint, worker: bigint, start: bigint, count: number, difficulty: number): bigint | null {
    // i64 results arrive as signed BigInt; the counter is unsigned.
    const result = BigInt.asUintN(64, this.ex.search(segment, worker, start, count, difficulty));
    return result === 0n ? null : result - 1n;
  }
}

/** Browser-side loader; Vite turns the URL into a hashed asset at build time. */
export async function loadKeccakWasm(): Promise<KeccakWasm> {
  const response = await fetch(new URL('./wasm/hashmine_keccak.wasm', import.meta.url));
  if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`);
  return KeccakWasm.instantiate(await response.arrayBuffer());
}
