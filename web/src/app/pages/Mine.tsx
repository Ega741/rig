import { useEffect, useState } from 'react';
import { getAddress, isAddress, type Address } from 'viem';
import type { UiConfig } from '../config';
import { formatCountdown, formatEth, formatHashRate, formatTokens, formatWorkBits, shortAddress } from '../format';
import { RoundBar } from '../RoundBar';
import { useMiner } from '../useMiner';
import { connectWallet, ensureChain, injectedProvider, sendEth } from '../wallet';

const BENEFICIARY_KEY = 'hashmine.beneficiary';
const FUND_WEI = 10n ** 16n; // 0.01 ETH
const FLUSH_BEFORE_END_SEC = 20;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function storedBeneficiary(): Address | null {
  const value = localStorage.getItem(BENEFICIARY_KEY);
  return value && isAddress(value) ? getAddress(value) : null;
}

export function Mine({ config }: { config: UiConfig }) {
  const [beneficiary, setBeneficiary] = useState<Address | null>(() => config.beneficiary ?? storedBeneficiary());
  const [walletAccount, setWalletAccount] = useState<Address | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const miner = useMiner(config, beneficiary);
  const now = useNow();
  const s = miner.snapshot;
  const provider = injectedProvider();

  const chooseBeneficiary = (address: Address) => {
    setBeneficiary(address);
    localStorage.setItem(BENEFICIARY_KEY, address);
  };

  const connect = async () => {
    if (!provider) return;
    try {
      const account = await connectWallet(provider);
      setWalletAccount(account);
      chooseBeneficiary(account);
      setWalletStatus(null);
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const fund = async () => {
    if (!provider || !walletAccount) return;
    try {
      setWalletStatus('Confirm the transfer in your wallet…');
      await ensureChain(provider, config.chain, config.rpcUrl);
      const tx = await sendEth(provider, walletAccount, miner.sessionKey.address, FUND_WEI);
      setWalletStatus(`Sent. Transaction ${tx}`);
      setTimeout(() => void miner.refreshBalance(), 3000);
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const expectedThisRound =
    s && s.roundWork + s.ownWork > 0n
      ? (s.rewardPool * BigInt(s.releaseBps) * s.ownWork) / (10_000n * (s.roundWork > s.ownWork ? s.roundWork : s.ownWork))
      : 0n;

  return (
    <>
      <section className="round" aria-label="Current round">
        <div className="round__head">
          <div>
            <div className="round__label">Round</div>
            <div className="round__number" data-testid="round">
              {s ? s.round.toString() : '—'}
            </div>
          </div>
          <div>
            <div className="round__label">Ends in</div>
            <div className="round__number">{s ? formatCountdown(s.roundEndsAt - now) : '—'}</div>
          </div>
          <div>
            <div className="round__label">Network minimum</div>
            <div className="round__number">{s ? `${s.minDifficulty} bits` : '—'}</div>
          </div>
          <div>
            <div className="round__label">Round work so far</div>
            <div className="round__number">{s ? formatWorkBits(s.roundWork) : '—'}</div>
          </div>
        </div>
        <RoundBar startsAt={s?.roundStartsAt ?? now} endsAt={s?.roundEndsAt ?? now + 1} now={now} marks={miner.marks} sendBeforeEndSec={FLUSH_BEFORE_END_SEC} />
      </section>

      <div className="grid">
        <section className="card" aria-label="Your miner">
          <div className="big" data-testid="hash-rate">
            {formatHashRate(s?.hashRate ?? 0)}
          </div>
          <dl className="kv">
            <dt>Engines</dt>
            <dd>
              {miner.settings.cores} CPU core{miner.settings.cores === 1 ? '' : 's'}
              {miner.settings.useGpu && miner.gpuAvailable ? ` · GPU${miner.gpuName ? ` (${miner.gpuName})` : ''}` : ''}
            </dd>
            <dt>Your difficulty</dt>
            <dd>{s ? `${s.difficulty} bits` : '—'}</dd>
            <dt>Shares found</dt>
            <dd data-testid="shares-found">{s?.hitsFound ?? 0}</dd>
            <dt>Shares sent</dt>
            <dd data-testid="shares-sent">
              {s?.sharesSubmitted ?? 0}
              {s && s.buffered > 0 ? ` (+${s.buffered} waiting)` : ''}
            </dd>
            <dt>Your work this round</dt>
            <dd>{s ? formatWorkBits(s.ownWork) : '—'}</dd>
          </dl>
          <div className="field">
            <label htmlFor="cores">CPU cores</label>
            <input
              id="cores"
              type="number"
              min={0}
              max={64}
              value={miner.settings.cores}
              disabled={miner.running}
              onChange={(e) => miner.setSettings({ ...miner.settings, cores: Math.max(0, Math.min(64, Number(e.target.value) || 0)) })}
            />
            <label>
              <input
                type="checkbox"
                checked={miner.settings.useGpu}
                disabled={miner.running || !miner.gpuAvailable}
                onChange={(e) => miner.setSettings({ ...miner.settings, useGpu: e.target.checked })}
              />{' '}
              GPU{miner.gpuAvailable ? '' : ' (no WebGPU in this browser)'}
            </label>
          </div>
          <div className="actions">
            {miner.running ? (
              <button className="btn" onClick={miner.stop} data-testid="stop-button">
                Stop mining
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => void miner.start()} data-testid="start-button" disabled={!beneficiary}>
                Start mining
              </button>
            )}
          </div>
          <p className="status" data-testid="status">
            {miner.status ?? (beneficiary ? 'Ready.' : 'Choose where rewards go, then start.')}
            {s?.lastError && <span className="error"> {s.lastError}</span>}
            {s?.engineErrors.map((e) => (
              <span key={e} className="error">
                {' '}
                {e}
              </span>
            ))}
          </p>
        </section>

        <section className="card" aria-label="Rewards">
          <div className="big">
            {formatTokens(s?.rewardPool ?? 0n)}
            <small>in the pool</small>
          </div>
          <dl className="kv">
            <dt>Released per round</dt>
            <dd>{s ? `${(s.releaseBps / 100).toFixed(2)}% ≈ ${formatTokens((s.rewardPool * BigInt(s.releaseBps)) / 10_000n)}` : '—'}</dd>
            <dt>Your estimate this round</dt>
            <dd>{s ? formatTokens(expectedThisRound) : '—'}</dd>
            <dt>Pending</dt>
            <dd data-testid="pending">{s ? formatTokens(s.pending) : '—'}</dd>
          </dl>
          <div className="actions">
            <button className="btn btn--ghost" onClick={() => void miner.claim()} disabled={!beneficiary || !s || s.pending === 0n}>
              Claim rewards
            </button>
          </div>
          <p className="muted status">
            Pending includes an estimate for the open round, which pays out when the round closes. Rewards are credited on chain to the
            beneficiary and can be claimed by anyone on its behalf.
          </p>
        </section>
      </div>

      <section className="card" aria-label="Accounts" style={{ marginTop: 24 }}>
        <dl className="kv">
          <dt>Rewards go to</dt>
          <dd data-testid="beneficiary">{beneficiary ?? '— not chosen'}</dd>
          <dt>Session key</dt>
          <dd data-testid="session-address">{miner.sessionKey.address}</dd>
          <dt>Session key balance</dt>
          <dd data-testid="session-balance">{miner.sessionBalance === null ? '—' : `${formatEth(miner.sessionBalance)} ETH`}</dd>
        </dl>
        <p className="muted status">
          The session key lives in this browser and only pays gas for submitting shares. Keep at least 0.005 ETH on it. It never receives rewards.
        </p>
        <div className="actions">
          {provider ? (
            <>
              <button className="btn btn--ghost" onClick={() => void connect()} disabled={miner.running}>
                {walletAccount ? `Wallet ${shortAddress(walletAccount)}` : 'Connect wallet'}
              </button>
              <button className="btn btn--ghost" onClick={() => void fund()} disabled={!walletAccount}>
                Fund session key with 0.01 ETH
              </button>
            </>
          ) : (
            <span className="muted">No wallet extension found: send ETH to the session key address to pay for gas.</span>
          )}
          <button className="btn btn--ghost" onClick={() => alert(miner.sessionKey.exportPrivateKey())}>
            Show private key
          </button>
          <button className="btn btn--ghost" onClick={miner.forgetKey} disabled={miner.running}>
            Forget key
          </button>
        </div>
        {!config.beneficiary && (
          <div className="field">
            <label htmlFor="beneficiary">Or type the address rewards should go to</label>
            <input
              id="beneficiary"
              className="mono"
              placeholder="0x…"
              value={addressInput}
              disabled={miner.running}
              onChange={(e) => setAddressInput(e.target.value)}
            />
            <button
              className="btn btn--ghost"
              disabled={miner.running || !isAddress(addressInput)}
              onClick={() => chooseBeneficiary(getAddress(addressInput))}
            >
              Use this address
            </button>
          </div>
        )}
        {walletStatus && <p className="status">{walletStatus}</p>}
      </section>
    </>
  );
}
