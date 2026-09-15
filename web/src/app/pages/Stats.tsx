import { useCallback, useEffect, useState } from 'react';
import { createPublicClient } from 'viem';
import { rpcTransport } from '../../chain/transport';
import { hashMineAbi } from '../../chain/abi/hashMine';
import type { UiConfig } from '../config';
import { formatReward, formatWorkBits, shortAddress } from '../format';
import { leaderboard, loadRounds, loadShareEntries, summarizeMiners, type LeaderRow, type MinerSummary, type RoundRow, type ShareEntry } from '../stats';

const ROUNDS = 24;
/** Blocks scanned for ShareBatch events: ~4 h (24 rounds) on Robinhood Chain (100 ms blocks). */
const BLOCK_SPAN = 144_000;
const TOP = 20;

export function Stats({ config }: { config: UiConfig }) {
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [summary, setSummary] = useState<MinerSummary | null>(null);
  const [entries, setEntries] = useState<ShareEntry[] | null>(null);
  const [currentRound, setCurrentRound] = useState<bigint>(0n);
  const [scope, setScope] = useState<'round' | 'window'>('window');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = createPublicClient({ chain: config.chain, transport: rpcTransport(config.chain.id, config.rpcUrl) });
      const current = await client.readContract({ address: config.hashMine, abi: hashMineAbi, functionName: 'currentRound' });
      const [rows, entries] = await Promise.all([loadRounds(client, config.hashMine, current, ROUNDS), loadShareEntries(client, config.hashMine, BLOCK_SPAN)]);
      setRounds(rows);
      setSummary(summarizeMiners(entries));
      setEntries(entries);
      setCurrentRound(current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const board: LeaderRow[] | null = entries && rounds ? leaderboard(entries, rounds, currentRound, scope).slice(0, TOP) : null;
  const explorer = config.chain.blockExplorers?.default.url;

  return (
    <>
      <h1>Stats</h1>
      <p className="lead">Who mined, how much work each round carried and what it released. Everything here is read from the contract.</p>

      <section className="panel frame frame--work" aria-label="Leaderboard">
        <div className="panel__title">
          <span>Leaderboard</span>
          <span className="scope" role="tablist" aria-label="Scope">
            <button type="button" role="tab" aria-selected={scope === 'round'} className={scope === 'round' ? 'scope__on' : ''} onClick={() => setScope('round')}>
              this round
            </button>
            <button type="button" role="tab" aria-selected={scope === 'window'} className={scope === 'window' ? 'scope__on' : ''} onClick={() => setScope('window')}>
              last {ROUNDS} rounds
            </button>
          </span>
        </div>
        <div className="panel__body">
          {board && board.length === 0 && (
            <p className="status" data-testid="leaderboard-empty">
              {scope === 'round' ? `No shares in round #${currentRound.toString()} yet.` : 'No shares yet.'} Be the first: Mine → Start.
            </p>
          )}
          {board && board.length > 0 && (
            <div className="table-wrap">
              <table className="table table--board" data-testid="leaderboard">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Miner</th>
                    <th>Work</th>
                    <th>Share</th>
                    <th>Shares</th>
                    <th>{scope === 'round' ? 'Rounds' : 'Earned'}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r) => (
                    <tr key={r.beneficiary} className={r.rank <= 3 ? `board__top board__top-${r.rank}` : ''}>
                      <td className="board__rank">#{r.rank}</td>
                      <td className="mono" title={r.beneficiary}>
                        {explorer ? (
                          <a href={`${explorer}/address/${r.beneficiary}`} target="_blank" rel="noreferrer">
                            {shortAddress(r.beneficiary)}
                          </a>
                        ) : (
                          shortAddress(r.beneficiary)
                        )}
                      </td>
                      <td>
                        <span className="board__bar" style={{ ['--w' as string]: `${Math.max(2, Math.round(r.share * 100))}%` }} aria-hidden="true" />
                        {formatWorkBits(r.work)}
                      </td>
                      <td>{(r.share * 100).toFixed(1)}%</td>
                      <td>{r.shares}</td>
                      <td>{scope === 'round' ? r.rounds : formatReward(r.earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!board && !error && <p className="status">Loading…</p>}
          <p className="status">
            Work is 2<sup>difficulty</sup> per share, summed. Earned is the contract&apos;s split of every closed round in the window: release × your work ÷ round work.
          </p>
        </div>
      </section>

      <section className="panel frame frame--night" aria-label="Miners">
        <div className="panel__title panel__title--cyan">
          <span>Miners</span>
          <span>last {BLOCK_SPAN.toLocaleString('en-US')} blocks</span>
        </div>
        <div className="panel__body">
          <div className="stat">
            <span className="label">{summary?.miners === 1 ? 'Unique miner' : 'Unique miners'}</span>
            <span className="num num--big" data-testid="unique-miners">
              {summary ? summary.miners : '—'}
            </span>
          </div>
          <div className="stats">
            <div className="stat">
              <span className="label">Shares</span>
              <span className="num">{summary ? summary.shares : '—'}</span>
            </div>
            <div className="stat">
              <span className="label">Batches</span>
              <span className="num">{summary ? summary.batches : '—'}</span>
            </div>
          </div>
          <p className="status">A miner counts once per window, however many shares it sent. Rounds without a single share release nothing and do not catch up later.</p>
          <div className="actions">
            <button type="button" className="btn btn--ghost frame frame--ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {error && <p className="error status">{error}</p>}
        </div>
      </section>

      <section className="panel frame frame--night" aria-label="Rounds">
        <div className="panel__title">
          <span>Rounds</span>
          <span>last {ROUNDS}</span>
        </div>
        <div className="panel__body">
          <div className="table-wrap">
            <table className="table" data-testid="rounds-table">
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Minimum</th>
                  <th>Work</th>
                  <th>Released</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {(rounds ?? []).map((r) => (
                  <tr key={r.round.toString()}>
                    <td>#{r.round.toString()}</td>
                    <td>{r.active ? `${r.minDifficulty} bits` : '—'}</td>
                    <td>{r.active ? formatWorkBits(r.work) : '—'}</td>
                    <td>{r.closed ? formatReward(r.release) : '—'}</td>
                    <td>{r.closed ? 'closed' : r.active ? 'open' : 'empty'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
