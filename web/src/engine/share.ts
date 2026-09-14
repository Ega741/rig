import { concatHex, getAddress, hexToBytes, keccak256, pad, toHex, type Address, type Hex } from 'viem';

export const MASK64 = (1n << 64n) - 1n;

/** nonce = segment << 128 | worker << 64 | counter; every part is an unsigned 64-bit value. */
export function makeNonce(segment: bigint, worker: bigint, counter: bigint): bigint {
  for (const part of [segment, worker, counter]) {
    if (part < 0n || part > MASK64) throw new RangeError('nonce part must fit in 64 bits');
  }
  return (segment << 128n) | (worker << 64n) | counter;
}

export function splitNonce(nonce: bigint): { segment: bigint; worker: bigint; counter: bigint } {
  return { segment: (nonce >> 128n) & MASK64, worker: (nonce >> 64n) & MASK64, counter: nonce & MASK64 };
}

/** beneficiary (20 bytes) ++ challenge (32 bytes): the part of the message every engine keeps fixed. */
export function headerBytes(beneficiary: Address, challenge: Hex): Uint8Array {
  const header = hexToBytes(concatHex([getAddress(beneficiary), challenge]));
  if (header.length !== 52) throw new RangeError('header must be 52 bytes');
  return header;
}

/** keccak256(abi.encodePacked(beneficiary, challenge, nonce)) — exactly what HashMine.submit checks. */
export function shareHash(beneficiary: Address, challenge: Hex, nonce: bigint): Hex {
  return keccak256(concatHex([getAddress(beneficiary), challenge, pad(toHex(nonce), { size: 32 })]));
}

/** Leading zero bits of a 32-byte hash read as a big-endian integer. */
export function leadingZeroBits(hash: Hex): number {
  const value = BigInt(hash);
  return value === 0n ? 256 : 256 - value.toString(2).length;
}

export function isValidShare(beneficiary: Address, challenge: Hex, nonce: bigint, difficulty: number): boolean {
  return leadingZeroBits(shareHash(beneficiary, challenge, nonce)) >= difficulty;
}

/** Hex of a 32-byte hash handed back by WASM or WGSL (already in wire byte order). */
export function bytesToHashHex(bytes: Uint8Array): Hex {
  return toHex(bytes);
}
