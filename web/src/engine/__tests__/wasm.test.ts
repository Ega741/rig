import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import vectors from '../vectors/share-vectors.json';
import { bytesToHashHex, headerBytes, isValidShare, makeNonce, splitNonce } from '../share';
import { KeccakWasm } from '../wasm';

const wasmBytes = readFileSync(fileURLToPath(new URL('../wasm/hashmine_keccak.wasm', import.meta.url)));

describe('keccak wasm', () => {
  let wasm: KeccakWasm;

  beforeAll(async () => {
    wasm = await KeccakWasm.instantiate(wasmBytes);
  });

  it.each(vectors)('hashes $hash like Solidity', (v) => {
    wasm.setHeader(headerBytes(getAddress(v.beneficiary) as Address, v.challenge as Hex));
    const { segment, worker, counter } = splitNonce(BigInt(v.nonce));
    expect(bytesToHashHex(wasm.hash(segment, worker, counter))).toBe(v.hash);
    expect(wasm.search(segment, worker, counter, 1, v.leadingZeroBits)).toBe(counter);
    expect(wasm.search(segment, worker, counter, 1, v.leadingZeroBits + 1)).toBeNull();
  });

  it('finds the same first share as a JS scan', () => {
    const v = vectors[0]!;
    const beneficiary = getAddress(v.beneficiary) as Address;
    const challenge = v.challenge as Hex;
    wasm.setHeader(headerBytes(beneficiary, challenge));
    let js = 0n;
    while (!isValidShare(beneficiary, challenge, makeNonce(1n, 0n, js), 12)) js++;
    expect(wasm.search(1n, 0n, 0n, 1 << 20, 12)).toBe(js);
  });

  it('rejects a header of the wrong size', () => {
    expect(() => wasm.setHeader(new Uint8Array(51))).toThrow(RangeError);
  });

  // Sanity floor, not a benchmark: vitest runs files in parallel (5.2 MH/s measured alone, 1.1 under load).
  it('hashes at least 0.5 MH/s on one thread', () => {
    const count = 1 << 20;
    const t0 = performance.now();
    expect(wasm.search(1n, 0n, 0n, count, 64)).toBeNull();
    const rate = count / ((performance.now() - t0) / 1000);
    expect(rate).toBeGreaterThan(500_000);
  });
});
