const THIN_SPACE = ' ';

function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

function significant(value: number, digits = 3): string {
  if (value === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, digits - 1 - magnitude);
  return value.toFixed(decimals);
}

export function formatHashRate(hashesPerSecond: number): string {
  const units: Array<[number, string]> = [
    [1e9, 'GH/s'],
    [1e6, 'MH/s'],
    [1e3, 'kH/s'],
  ];
  for (const [scale, unit] of units) {
    if (hashesPerSecond >= scale) return `${significant(hashesPerSecond / scale)} ${unit}`;
  }
  return `${Math.round(hashesPerSecond)} H/s`;
}

/** Token-wei (18 decimals) as "1 203 411.52". */
export function formatTokens(wei: bigint, decimals = 2): string {
  const scale = 10n ** 18n;
  const whole = wei / scale;
  const fraction = wei % scale;
  const fractionDigits = (fraction * 10n ** BigInt(decimals) + scale / 2n) / scale;
  const carry = fractionDigits >= 10n ** BigInt(decimals) ? 1n : 0n;
  const digits = (fractionDigits - carry * 10n ** BigInt(decimals)).toString().padStart(decimals, '0');
  return `${group((whole + carry).toString())}.${digits}`;
}

export function formatEth(wei: bigint): string {
  return formatTokens(wei, 4);
}

/** Mining rewards: wei as "0.027000 ETH" — six decimals, because a round's share can be well under a millieth. */
export function formatReward(wei: bigint): string {
  return `${formatTokens(wei, 6)} ETH`;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** log2 of a work amount, one decimal: what the difficulty ladder is measured in. */
export function formatWorkBits(work: bigint): string {
  if (work === 0n) return '0 bits';
  const bits = work.toString(2).length - 1;
  const top = Number(work >> BigInt(Math.max(0, bits - 52))) / 2 ** Math.min(bits, 52);
  return `${(bits + Math.log2(top)).toFixed(1)} bits`;
}
