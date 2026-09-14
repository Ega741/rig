import { describe, expect, it } from 'vitest';
import { formatCountdown, formatEth, formatHashRate, formatTokens, formatWorkBits, shortAddress } from '../format';

describe('format', () => {
  it('hash rate picks a unit and keeps three significant digits', () => {
    expect(formatHashRate(0)).toBe('0 H/s');
    expect(formatHashRate(820)).toBe('820 H/s');
    expect(formatHashRate(5_312_000)).toBe('5.31 MH/s');
    expect(formatHashRate(142_600_000)).toBe('143 MH/s');
    expect(formatHashRate(6.02e9)).toBe('6.02 GH/s');
  });

  it('tokens use thin-space grouping and two decimals', () => {
    expect(formatTokens(1_203_411_520_000_000_000_000_000n)).toBe('1\u202f203\u202f411.52');
    expect(formatTokens(0n)).toBe('0.00');
    expect(formatTokens(5n * 10n ** 15n)).toBe('0.01');
  });

  it('eth keeps four decimals', () => {
    expect(formatEth(42_100_000_000_000_000n)).toBe('0.0421');
    expect(formatEth(10n ** 18n)).toBe('1.0000');
  });

  it('countdown is mm:ss and clamps at zero', () => {
    expect(formatCountdown(401_000)).toBe('06:41');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(3_599_000)).toBe('59:59');
  });

  it('addresses are shortened to 0x1234…abcd', () => {
    expect(shortAddress('0x94006Dfc006DF5fA095293cA64c54cEc54705ccc')).toBe('0x9400…5ccc');
  });

  it('work is shown as bits', () => {
    expect(formatWorkBits(0n)).toBe('0 bits');
    expect(formatWorkBits(1n << 33n)).toBe('33.0 bits');
    expect(formatWorkBits(3n << 33n)).toBe('34.6 bits');
  });
});
