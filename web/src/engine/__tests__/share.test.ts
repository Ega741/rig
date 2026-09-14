import { describe, expect, it } from 'vitest';
import { getAddress, hexToBytes, type Address, type Hex } from 'viem';
import vectors from '../../../../contracts/vectors/share-vectors.json';
import {
  MASK64,
  headerBytes,
  isValidShare,
  leadingZeroBits,
  makeNonce,
  shareHash,
  splitNonce,
} from '../share';

describe('share reference (viem)', () => {
  it('has 12 vectors, the last four being real shares', () => {
    expect(vectors).toHaveLength(12);
    expect(Math.min(...vectors.slice(8).map((v) => v.leadingZeroBits))).toBeGreaterThanOrEqual(12);
  });

  it.each(vectors)('matches Solidity for $hash', (v) => {
    const beneficiary = getAddress(v.beneficiary) as Address;
    const nonce = BigInt(v.nonce);
    expect(shareHash(beneficiary, v.challenge as Hex, nonce)).toBe(v.hash);
    expect(leadingZeroBits(v.hash as Hex)).toBe(v.leadingZeroBits);
    expect(isValidShare(beneficiary, v.challenge as Hex, nonce, v.leadingZeroBits)).toBe(true);
    expect(isValidShare(beneficiary, v.challenge as Hex, nonce, v.leadingZeroBits + 1)).toBe(false);
  });

  it('packs and splits nonces', () => {
    const nonce = makeNonce(7n, 3n, 123456789n);
    expect(nonce).toBe((7n << 128n) | (3n << 64n) | 123456789n);
    expect(splitNonce(nonce)).toEqual({ segment: 7n, worker: 3n, counter: 123456789n });
    expect(() => makeNonce(MASK64 + 1n, 0n, 0n)).toThrow(RangeError);
  });

  it('builds a 52-byte header', () => {
    const v = vectors[0]!;
    const header = headerBytes(getAddress(v.beneficiary) as Address, v.challenge as Hex);
    expect(header).toHaveLength(52);
    expect(header.slice(0, 20)).toEqual(hexToBytes(v.beneficiary as Hex));
    expect(header.slice(20)).toEqual(hexToBytes(v.challenge as Hex));
  });

  it('counts leading zero bits of edge hashes', () => {
    expect(leadingZeroBits(('0x' + '00'.repeat(32)) as Hex)).toBe(256);
    expect(leadingZeroBits(('0x80' + '00'.repeat(31)) as Hex)).toBe(0);
    expect(leadingZeroBits(('0x0001' + '00'.repeat(30)) as Hex)).toBe(15);
  });
});
