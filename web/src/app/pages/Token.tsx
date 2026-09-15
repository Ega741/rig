import { useCallback, useEffect, useRef, useState } from 'react';
import { createPublicClient, formatUnits, type Address, type PublicClient } from 'viem';
import { robinhood } from '../../chain/chains';
import { rpcTransport } from '../../chain/transport';
import {
  PONS_FACTORY,
  PonsPhase,
  emptyHistory,
  findLaunchBlock,
  ponsFactoryAbi,
  readPonsSnapshot,
  scanFees,
  type FeeHistory,
  type PonsSnapshot,
} from '../../chain/pons';
import { fetchEthUsd, formatUsd, weiToUsd } from '../../chain/ethUsd';
import type { UiConfig } from '../config';
import { formatTokens, shortAddress } from '../format';

const POLL_MS = 3000;
const ETH_USD_POLL_MS = 60_000;

function quoteAmount(units: bigint, decimals: number, digits = 4): string {
  const value = Number(formatUnits(units, decimals));
  return value >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value.toFixed(digits);
}

function tokenPrice(unitsPerToken: bigint, decimals: number): string {
  const value = Number(formatUnits(unitsPerToken, decimals));
  if (value === 0) return '—';
  return value < 1e-6 ? value.toExponential(3) : value.toPrecision(4);
}

export function Token({ config }: { config: UiConfig }) {
  const token: Address | null = config.ponsToken;
  const [snapshot, setSnapshot] = useState<PonsSnapshot | null>(null);
  const [history, setHistory] = useState<FeeHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const clientRef = useRef<PublicClient | null>(null);
  const historyRef = useRef<FeeHistory | null>(null);
  const hookRef = useRef<Address | null>(null);
  const busyRef = useRef(false);

  const client = useCallback((): PublicClient => {
    if (!clientRef.current) clientRef.current = createPublicClient({ chain: robinhood, transport: rpcTransport(robinhood.id, config.ponsRpcUrl) });
    return clientRef.current;
  }, [config.ponsRpcUrl]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const tick = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const c = client();
        const s = await readPonsSnapshot(c, token);
        if (cancelled) return;
        setSnapshot(s);
        setUpdatedAt(Date.now());
        setError(null);
        if (!hookRef.current) hookRef.current = await c.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: 'memeHook' });
        if (!historyRef.current) historyRef.current = emptyHistory(await findLaunchBlock(c, token, s.blockNumber));
        if (historyRef.current.scannedTo < s.blockNumber) {
          historyRef.current = await scanFees(c, s, hookRef.current, historyRef.current, s.blockNumber);
          if (!cancelled) setHistory({ ...historyRef.current });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, client]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const v = await fetchEthUsd();
      if (!cancelled && v !== null) setEthUsd(v);
    };
    void tick();
    const timer = setInterval(() => void tick(), ETH_USD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const s = snapshot;
  const dec = s?.quoteDecimals ?? 18;
  const unit = s?.quoteSymbol ?? 'ETH';
  const eth = (units: bigint, digits = 4) => quoteAmount(units, dec, digits);
  /** USD figures only make sense for ETH-quoted launches; other quotes keep their own unit. */
  const usd = ethUsd !== null && unit === 'ETH' ? (wei: bigint) => formatUsd(weiToUsd(wei, ethUsd)) : null;
  const phaseLabel = s ? { 0: 'on the curve', 1: 'graduating', 2: 'in the pool', 3: 'rescued' }[s.phase] : '';
  const graduationPct = s && s.graduationThreshold > 0n ? Number((s.realQuoteReserve * 10_000n) / s.graduationThreshold) / 100 : 0;
  const earnedWei = history
    ? history.curveTaxWei +
      history.hookTaxEth +
      ((history.curveFeeWei + history.hookFeeEth) * BigInt(10_000 - (s?.protocolFeeShareBps ?? 3000))) / 10_000n
    : null;

  return (
    <>
      <h1>{s ? `$${s.symbol}` : 'Token'}</h1>
      <p className="lead">
        {s
          ? `${s.name} on PONS, ${phaseLabel}. Every trade pays ${(s.baseFeeBps + s.creatorTaxBps) / 100}%: ${s.creatorTaxBps / 100}% creator tax plus ${
              (100 - s.protocolFeeShareBps / 100) / 100
            } of the ${s.baseFeeBps / 100}% base fee reach the creator — ${((s.creatorTaxBps + (s.baseFeeBps * (10_000 - s.protocolFeeShareBps)) / 10_000) / 100).toFixed(2)}% of volume.`
          : 'The token launches on PONS soon. Its fees, price and market will be live here from the first trade.'}
      </p>

      {token && (
        <>
          <section className="panel frame frame--work" aria-label="Creator fees">
            <div className="panel__title">
              <span>Fees</span>
              <span className={updatedAt ? 'panel__state panel__state--live' : 'panel__state'}>
                {s ? `block ${s.blockNumber.toLocaleString('en-US')}` : 'loading'}
              </span>
            </div>
            <div className="panel__body">
              <div className="stat">
                <span className="label">Creator fees, waiting to be collected</span>
                <span className="num num--big num--lime" data-testid="creator-total">
                  {s ? `${eth(s.creatorTotalWei)} ${unit}` : '—'}
                </span>
              </div>
              <div className="stats stats--4">
                <div className="stat">
                  <span className="label">Claimable now (recipient, all launches)</span>
                  <span className="num">{s ? eth(s.escrowClaimable) : '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">On the curve</span>
                  <span className="num">{s ? eth(s.creatorOnCurveWei) : '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">In the pool, {unit}</span>
                  <span className="num">{s ? eth(s.creatorInHookWei) : '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">In the pool, tokens</span>
                  <span className="num">{s ? formatTokens(s.creatorInHookTokenWei, 0) : '—'}</span>
                </div>
              </div>
              <div className="stats stats--4">
                <div className="stat">
                  <span className="label">Earned since launch</span>
                  <span className="num num--amber">{earnedWei !== null ? `${eth(earnedWei)} ${unit}` : 'scanning…'}</span>
                </div>
                <div className="stat">
                  <span className="label">Curve volume</span>
                  <span className="num">{history ? `${eth(history.curveVolumeWei, 2)} ${unit}` : '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">Trades</span>
                  <span className="num">{history ? history.trades : '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">Updated</span>
                  <span className="num">{updatedAt ? new Date(updatedAt).toLocaleTimeString('en-GB') : '—'}</span>
                </div>
              </div>
              <p className="status">
                Claimable now is the fee recipient's balance in the PONS escrow, across every launch it receives fees from. On the curve and in the pool are fees charged but not yet swept; the pool's token-side
                fees are converted to {unit} by the PONS operator and counted here at the current price. On the next harvest 40% of this goes to the mining pool and
                60% to the team wallet, as fixed in the treasury contract.
              </p>
              {error && <p className="error status">{error}</p>}
            </div>
          </section>

          <section className="panel frame frame--night" aria-label="Market">
            <div className="panel__title panel__title--cyan">
              <span>Market</span>
              <span>{ethUsd !== null ? `${phaseLabel} · ETH ${formatUsd(ethUsd)}` : phaseLabel}</span>
            </div>
            <div className="panel__body">
              <div className="stats stats--4">
                <div className="stat">
                  <span className="label">Price</span>
                  <span className="num num--cyan" data-testid="price-usd">{s && usd ? usd(s.weiPerToken) : s ? `${tokenPrice(s.weiPerToken, dec)} ${unit}` : '—'}</span>
                  {s && usd && <span className="sub">{tokenPrice(s.weiPerToken, dec)} ETH</span>}
                </div>
                <div className="stat">
                  <span className="label">Market cap</span>
                  <span className="num" data-testid="mcap-usd">{s && usd ? usd(s.marketCapWei) : s ? `${eth(s.marketCapWei, 2)} ${unit}` : '—'}</span>
                  {s && usd && <span className="sub">{eth(s.marketCapWei, 2)} ETH</span>}
                </div>
                <div className="stat">
                  <span className="label">{unit} on the curve</span>
                  <span className="num">{s ? `${eth(s.realQuoteReserve)} / ${eth(s.graduationThreshold, 1)}` : '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">To graduation</span>
                  <span className="num">{s ? (s.phase === PonsPhase.NotGraduated ? `${graduationPct.toFixed(1)}%` : 'done') : '—'}</span>
                </div>
              </div>
              <div className="strip" role="img" aria-label={`Graduation progress ${graduationPct.toFixed(1)}%`}>
                <div className="strip__fill" style={{ width: `${s?.phase === PonsPhase.NotGraduated ? Math.min(100, graduationPct) : 100}%` }} />
              </div>
            </div>
          </section>

          <section className="panel frame frame--night" aria-label="Contracts">
            <div className="panel__title panel__title--dim">
              <span>Contracts</span>
              <span>Robinhood Chain</span>
            </div>
            <div className="panel__body">
              <dl className="kv">
                <dt>Token</dt>
                <dd>
                  <a href={`https://robinhoodchain.blockscout.com/address/${token}`} target="_blank" rel="noreferrer">
                    {token}
                  </a>
                </dd>
                <dt>Curve</dt>
                <dd>{s?.curve ?? '—'}</dd>
                <dt>Fees go to</dt>
                <dd>{s?.creatorFeeRecipient ?? '—'}</dd>
                <dt>Deployer</dt>
                <dd>{s?.deployer ?? '—'}</dd>
                <dt>PONS page</dt>
                <dd>
                  <a href={`https://ponsfamily.com/token/${token}`} target="_blank" rel="noreferrer">
                    ponsfamily.com/token/{shortAddress(token)}
                  </a>
                </dd>
              </dl>
            </div>
          </section>
        </>
      )}
    </>
  );
}
