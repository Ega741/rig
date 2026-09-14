import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http } from 'viem';
import { hashMineAbi } from '../../chain/abi/hashMine';
import type { UiConfig } from '../config';
import { formatReward, formatWorkBits } from '../format';
import { loadRounds, loadShareEntries, summarizeMiners, type MinerSummary, type RoundRow } from '../stats';

const ROUNDS = 24;
/** Blocks scanned for ShareBatch events: ~1 h on Robinhood Chain (100 ms blocks). */
const BLOCK_SPAN = 36_000;

export function Stats({ config }: { config: UiConfig }) {
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [summary, setSummary] = useState<MinerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
      const current = await client.readContract({ address: config.hashMine, abi: hashMineAbi, functionName: 'currentRound' });
      const [rows, entries] = await Promise.all([loadRounds(client, config.hashMine, current, ROUNDS), loadShareEntries(client, config.hashMine, BLOCK_SPAN)]);
      setRounds(rows);
      setSummary(summarizeMiners(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <h1>Stats</h1>
      <p className="lead">Who mined, how much work each round carried and what it released. Everything here is read from the contract.</p>

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
