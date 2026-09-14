import { useEffect, useState } from 'react';
import { getAddress, isAddress, type Address } from 'viem';
import type { UiConfig } from '../config';
import { formatCountdown, formatEth, formatHashRate, formatTokens, formatWorkBits, shortAddress } from '../format';
import { HashStrip } from '../HashStrip';
import { RoundBar } from '../RoundBar';
import { maxCores, useMiner } from '../useMiner';
import { MAX_INTENSITY, MIN_INTENSITY } from '../../miner/controller';
import { connectWallet, ensureChain, injectedProvider, sendEth } from '../wallet';

const BENEFICIARY_KEY = 'rig.beneficiary';
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
  const coreLimit = maxCores();

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
  const cpuOn = miner.settings.cores > 0;
  const gpuOn = miner.settings.useGpu && miner.gpuAvailable;

  return (
    <>
      <h1>Mine shares</h1>
      <p className="lead">
        Your browser hashes your address, the round challenge and a nonce until the result starts with enough zero bits. Each such hash is a
        share. When a round ends, the pool releases {s ? (s.releaseBps / 100).toFixed(2) : '0.48'}% of itself and splits it by work among
        everyone who sent shares.
      </p>

      <section className={`panel frame ${miner.running ? 'frame--work' : 'frame--night'}`} aria-label="Your miner">
        <div className="panel__title">
          <span>Miner</span>
          <span className={miner.running ? 'panel__state panel__state--live' : 'panel__state'}>{miner.running ? 'mining' : 'idle'}</span>
        </div>
        <div className="panel__body">
          <HashStrip hash={miner.lastShare?.hash ?? null} bits={miner.lastShare?.bits ?? 0} difficulty={s?.difficulty ?? 0} />
          <div className="stats stats--4">
            <div className="stat">
              <span className="label">Speed</span>
              <span className="num num--cyan" data-testid="hash-rate">
                {formatHashRate(s?.hashRate ?? 0)}
              </span>
            </div>
            <div className="stat">
              <span className="label">Shares found</span>
              <span className="num" data-testid="shares-found">
                {s?.hitsFound ?? 0}
              </span>
            </div>
            <div className="stat">
              <span className="label">Shares sent</span>
              <span className="num" data-testid="shares-sent">
                {s?.sharesSubmitted ?? 0}
                {s && s.buffered > 0 ? <span className="muted"> +{s.buffered}</span> : null}
              </span>
            </div>
            <div className="stat">
              <span className="label">Your difficulty</span>
              <span className="num">{s ? `${s.difficulty} bits` : '—'}</span>
            </div>
          </div>

          <div className="label">Machine</div>
          <div className="seg" role="group" aria-label="Machine">
            <button
              type="button"
              aria-pressed={cpuOn}
              disabled={miner.running}
              onClick={() => miner.setSettings({ ...miner.settings, cores: cpuOn ? 0 : coreLimit })}
            >
              CPU
            </button>
            <button
              type="button"
              aria-pressed={gpuOn}
              disabled={miner.running || !miner.gpuAvailable}
              title={miner.gpuAvailable ? undefined : 'No WebGPU in this browser'}
              onClick={() => miner.setSettings({ ...miner.settings, useGpu: !miner.settings.useGpu })}
            >
              GPU{miner.gpuName ? ` · ${miner.gpuName}` : ''}
            </button>
          </div>
          <div className="field">
            <label className="label" htmlFor="cores">
              Cores to use <span className="num">{miner.settings.cores}</span>
            </label>
            <input
              id="cores"
              type="range"
              min={0}
              max={coreLimit}
              step={1}
              value={miner.settings.cores}
              disabled={miner.running}
              aria-label="CPU cores"
              onChange={(e) => miner.setSettings({ ...miner.settings, cores: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="intensity">
              Load cap <span className="num">{miner.settings.intensity}%</span>
            </label>
            <input
              id="intensity"
              type="range"
              min={MIN_INTENSITY}
              max={MAX_INTENSITY}
              step={5}
              value={miner.settings.intensity}
              aria-label="Load cap"
              onChange={(e) => miner.setSettings({ ...miner.settings, intensity: Number(e.target.value) })}
            />
          </div>
          <p className="status">
            The miner works in bursts and rests at least as long as it works, so it never takes more than half of the machine; at most
            half of the cores are used. Change the cap any time, no restart needed.
          </p>

          <div className="actions">
            {miner.running ? (
              <button type="button" className="btn btn--ghost btn--wide frame frame--ghost" onClick={miner.stop} data-testid="stop-button">
                Stop mining
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--wide frame frame--green"
                onClick={() => void miner.start()}
                data-testid="start-button"
                disabled={!beneficiary}
              >
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
        </div>
      </section>

      <section className="panel frame frame--night" aria-label="Current round">
        <div className="panel__title panel__title--cyan">
          <span>Round</span>
          <span data-testid="round">{s ? `#${s.round.toString()}` : '—'}</span>
        </div>
        <div className="panel__body">
          <div className="stats stats--4">
            <div className="stat">
              <span className="label">Ends in</span>
              <span className="num num--cyan">{s ? formatCountdown(s.roundEndsAt - now) : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Network minimum</span>
              <span className="num">{s ? `${s.minDifficulty} bits` : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Round work</span>
              <span className="num">{s ? formatWorkBits(s.roundWork) : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Your work</span>
              <span className="num num--lime">{s ? formatWorkBits(s.ownWork) : '—'}</span>
            </div>
          </div>
          <RoundBar startsAt={s?.roundStartsAt ?? now} endsAt={s?.roundEndsAt ?? now + 1} now={now} marks={miner.marks} sendBeforeEndSec={FLUSH_BEFORE_END_SEC} />
        </div>
      </section>

      <section className="panel frame frame--night" aria-label="Rewards">
        <div className="panel__title">
          <span>Rewards</span>
          <span>{s ? `${(s.releaseBps / 100).toFixed(2)}% per round` : ''}</span>
        </div>
        <div className="panel__body">
          <div className="stat">
            <span className="label">In the pool</span>
            <span className="num num--big">{formatTokens(s?.rewardPool ?? 0n)}</span>
          </div>
          <div className="stats">
            <div className="stat">
              <span className="label">Released next</span>
              <span className="num">{s ? formatTokens((s.rewardPool * BigInt(s.releaseBps)) / 10_000n) : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Your estimate</span>
              <span className="num num--lime">{s ? formatTokens(expectedThisRound) : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Pending</span>
              <span className="num num--amber" data-testid="pending">
                {s ? formatTokens(s.pending) : '—'}
              </span>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn btn--ghost frame frame--ghost" onClick={() => void miner.claim()} disabled={!beneficiary || !s || s.pending === 0n}>
              Claim rewards
            </button>
          </div>
          <p className="status">
            Pending includes an estimate for the open round, which pays out when the round closes. Rewards are credited on chain to the
            beneficiary; anyone can claim on its behalf, nobody can redirect them.
          </p>
        </div>
      </section>

      <section className="panel frame frame--night" aria-label="Keys">
        <div className="panel__title panel__title--dim">
          <span>Keys</span>
          <span>{miner.sessionBalance === null ? '' : `${formatEth(miner.sessionBalance)} ETH for gas`}</span>
        </div>
        <div className="panel__body">
          <dl className="kv">
            <dt>Rewards go to</dt>
            <dd data-testid="beneficiary">{beneficiary ?? '— not chosen'}</dd>
            <dt>Session key</dt>
            <dd data-testid="session-address">{miner.sessionKey.address}</dd>
            <dt>Its balance</dt>
            <dd data-testid="session-balance">{miner.sessionBalance === null ? '—' : `${formatEth(miner.sessionBalance)} ETH`}</dd>
          </dl>
          <p className="status">
            The session key lives in this browser and only pays gas for submitting shares. Keep at least 0.005 ETH on it. It never receives
            rewards, and its private key is never shown. Forget it any time to get a fresh one.
          </p>
          <div className="actions">
            {provider ? (
              <>
                <button type="button" className="btn btn--ghost frame frame--ghost" onClick={() => void connect()} disabled={miner.running}>
                  {walletAccount ? `Wallet ${shortAddress(walletAccount)}` : 'Connect wallet'}
                </button>
                <button type="button" className="btn frame frame--green" onClick={() => void fund()} disabled={!walletAccount}>
                  Fund 0.01 ETH
                </button>
              </>
            ) : (
              <span className="muted">No wallet extension found: send ETH to the session key address to pay for gas.</span>
            )}
            <button type="button" className="btn btn--ghost frame frame--ghost" onClick={miner.forgetKey} disabled={miner.running}>
              Forget key
            </button>
          </div>
          {!config.beneficiary && (
            <div className="field">
              <label className="label" htmlFor="beneficiary">
                Or type the address rewards should go to
              </label>
              <input
                id="beneficiary"
                type="text"
                placeholder="0x…"
                value={addressInput}
                disabled={miner.running}
                onChange={(e) => setAddressInput(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--ghost frame frame--ghost"
                disabled={miner.running || !isAddress(addressInput)}
                onClick={() => chooseBeneficiary(getAddress(addressInput))}
              >
                Use this address
              </button>
            </div>
          )}
          {walletStatus && <p className="status">{walletStatus}</p>}
        </div>
      </section>
    </>
  );
}
