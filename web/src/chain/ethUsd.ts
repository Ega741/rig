/** ETH/USD spot for display. Coinbase first, CoinGecko as fallback; both allow browser requests. */
export async function fetchEthUsd(fetchFn: typeof fetch = fetch): Promise<number | null> {
  try {
    const r = await fetchFn('https://api.coinbase.com/v2/prices/ETH-USD/spot');
    const j = (await r.json()) as { data?: { amount?: string } };
    const v = Number(j.data?.amount);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    /* fall through */
  }
  try {
    const r = await fetchFn('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const j = (await r.json()) as { ethereum?: { usd?: number } };
    const v = Number(j.ethereum?.usd);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    /* no price */
  }
  return null;
}

/** USD value of `wei` at `ethUsd` dollars per ETH. */
export function weiToUsd(wei: bigint, ethUsd: number): number {
  // Display only: a double keeps ~16 significant digits, plenty for prices down to 1e-12 ETH.
  return (Number(wei) / 1e18) * ethUsd;
}

/** "$4,750", "$12.30", "$0.0117", "$0.00001173" — four significant digits below a cent, cents above. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  const digits = Math.max(4, -Math.floor(Math.log10(value)) + 3);
  return `$${value.toFixed(Math.min(digits, 12))}`;
}
