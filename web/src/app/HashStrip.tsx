import type { Hex } from 'viem';

interface HashStripProps {
  hash: Hex | null;
  /** Leading zero bits of `hash`; the work the share was paid for. */
  bits: number;
  difficulty: number;
}

/** A share hash as 256 bit cells (4 rows of 64). Leading zero bits, the work, light up; ones are dim. */
export function HashStrip({ hash, bits, difficulty }: HashStripProps) {
  const cells: Array<'lead' | 'zero' | 'one'> = [];
  if (hash) {
    const value = BigInt(hash);
    for (let i = 255; i >= 0; i--) {
      const one = (value >> BigInt(i)) & 1n;
      const index = 255 - i;
      cells.push(one ? 'one' : index < bits ? 'lead' : 'zero');
    }
  }
  const leadHex = hash ? Math.floor(bits / 4) : 0;
  return (
    <div className="hashstrip" data-testid="hash-strip">
      <div className="hashstrip__caption">
        <span className="label">{hash ? 'Last share' : 'No share yet'}</span>
        <span className="label">{hash ? `${bits} zero bits · needed ${difficulty}` : `target ${difficulty} zero bits`}</span>
      </div>
      <div className="hashstrip__bits" role="img" aria-label={hash ? `Share hash with ${bits} leading zero bits` : 'No share found yet'}>
        {(hash ? cells : Array.from({ length: 256 }, () => 'zero' as const)).map((kind, i) => (
          <span key={i} className={kind === 'lead' ? 'hashstrip__bit hashstrip__bit--lead' : kind === 'one' ? 'hashstrip__bit hashstrip__bit--one' : 'hashstrip__bit'} />
        ))}
      </div>
      <div className="hashstrip__hex">
        {hash ? (
          <>
            0x<b>{hash.slice(2, 2 + leadHex)}</b>
            {hash.slice(2 + leadHex)}
          </>
        ) : (
          'Your browser hashes until a result starts with enough zero bits. That result appears here.'
        )}
      </div>
    </div>
  );
}
