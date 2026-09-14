import type { Mark } from './useMiner';

interface RoundBarProps {
  startsAt: number;
  endsAt: number;
  now: number;
  marks: Mark[];
  /** Seconds before the end at which buffered shares are sent. */
  sendBeforeEndSec: number;
}

/** The round as a timeline: elapsed time fills it, shares and submits leave marks, "send by" is the flush deadline. */
export function RoundBar({ startsAt, endsAt, now, marks, sendBeforeEndSec }: RoundBarProps) {
  const length = Math.max(endsAt - startsAt, 1);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - startsAt) / length) * 100))}%`;
  const sendBy = endsAt - sendBeforeEndSec * 1000;
  return (
    <div>
      <div className="bar" role="img" aria-label={`Round timeline, ${marks.length} marks`}>
        <div className="bar__fill" style={{ width: pct(now) }} />
        <div className="bar__sendby" style={{ left: pct(sendBy) }}>
          <span>send by</span>
        </div>
        {marks.map((mark, i) => (
          <div key={`${mark.at}-${i}`} className={mark.kind === 'submit' ? 'bar__mark bar__mark--submit' : 'bar__mark'} style={{ left: pct(mark.at) }} />
        ))}
        <div className="bar__now" style={{ left: pct(now) }} />
      </div>
      <div className="bar__legend">
        <span>
          <i style={{ background: 'var(--signal)' }} />
          share found
        </span>
        <span>
          <i style={{ background: 'var(--cobalt)' }} />
          batch sent
        </span>
        <span>
          <i style={{ background: 'var(--cobalt-2)' }} />
          elapsed
        </span>
      </div>
    </div>
  );
}
