import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { feeRouteCalldata, feeRouteStatus } from '../feeRoute';

const TOKEN = '0x1111111111111111111111111111111111111111';
const TREASURY = '0x2222222222222222222222222222222222222222';

describe('feeRouteCalldata', () => {
  it('encodes transferCreatorFeeRecipient(token, treasury)', () => {
    const data = feeRouteCalldata(TOKEN, TREASURY);
    const selector = keccak256(toBytes('transferCreatorFeeRecipient(address,address)')).slice(0, 10);
    expect(data.slice(0, 10)).toBe(selector);
    expect(data.slice(10, 74)).toBe(TOKEN.slice(2).padStart(64, '0'));
    expect(data.slice(74, 138)).toBe(TREASURY.slice(2).padStart(64, '0'));
    expect(data.length).toBe(138);
  });
});

describe('feeRouteStatus', () => {
  it('is routed only when the recipient is the treasury (case-insensitive)', () => {
    expect(feeRouteStatus(true, TREASURY, TREASURY)).toBe('routed');
    expect(feeRouteStatus(true, TREASURY.toLowerCase() as typeof TREASURY, TREASURY)).toBe('routed');
    expect(feeRouteStatus(true, TOKEN, TREASURY)).toBe('wallet');
    expect(feeRouteStatus(false, TREASURY, TREASURY)).toBe('unknown');
  });
});
