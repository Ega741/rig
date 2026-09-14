import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http } from 'viem';
import { hashMineAbi } from '../../chain/abi/hashMine';
import type { UiConfig } from '../config';
import { formatTokens, formatWorkBits } from '../format';
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
      <div className="grid">
        <section className="card" aria-label="Miners">
          <div className="big" data-testid="unique-miners">
            {summary ? summary.miners : '—'}
            <small>
              {summary?.miners === 1 ? 'miner' : 'miners'} in the last {BLOCK_SPAN.toLocaleString('en-US')} blocks
            </small>
          </div>
          <dl className="kv">
            <dt>Shares</dt>
            <dd>{summary ? summary.shares : '—'}</dd>
            <dt>Batches</dt>
            <dd>{summary ? summary.batches : '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <p className="muted">A miner counts once per window, however many shares it sent. Rounds without a single share release nothing and do not catch up later.</p>
          <div className="actions">
            <button className="btn btn--ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {error && <p className="error status">{error}</p>}
        </section>
      </div>
      <section className="card" style={{ marginTop: 24 }} aria-label="Rounds">
        <h2>Last {ROUNDS} rounds</h2>
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
                  <td>{r.round.toString()}</td>
                  <td>{r.active ? `${r.minDifficulty} bits` : '—'}</td>
                  <td>{r.active ? formatWorkBits(r.work) : '—'}</td>
                  <td>{r.closed ? formatTokens(r.release) : '—'}</td>
                  <td>{r.closed ? 'closed' : r.active ? 'open' : 'empty'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
