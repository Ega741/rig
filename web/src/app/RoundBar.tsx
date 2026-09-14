import type { Mark } from './useMiner';

interface RoundBarProps {
  startsAt: number;
  endsAt: number;
  now: number;
  marks: Mark[];
  /** Seconds before the end at which buffered shares are sent. */
  sendBeforeEndSec: number;
}

/** The round as a strip of cells: elapsed time fills it, shares and submits leave marks, the dotted line is the send deadline. */
export function RoundBar({ startsAt, endsAt, now, marks, sendBeforeEndSec }: RoundBarProps) {
  const length = Math.max(endsAt - startsAt, 1);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - startsAt) / length) * 100))}%`;
  const sendBy = endsAt - sendBeforeEndSec * 1000;
  return (
    <div>
      <div className="strip" role="img" aria-label={`Round timeline, ${marks.length} marks`}>
        <div className="strip__fill" style={{ width: pct(now) }} />
        <div className="strip__sendby" style={{ left: pct(sendBy) }} />
        {marks.map((mark, i) => (
          <div key={`${mark.at}-${i}`} className={mark.kind === 'submit' ? 'strip__mark strip__mark--submit' : 'strip__mark'} style={{ left: pct(mark.at) }} />
        ))}
        <div className="strip__now" style={{ left: pct(now) }} />
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--lime)' }} />
          share found
        </span>
        <span>
          <i style={{ background: 'var(--cyan)' }} />
          batch sent
        </span>
        <span>
          <i style={{ background: 'var(--ink-2)' }} />
          send by
        </span>
      </div>
    </div>
  );
}
