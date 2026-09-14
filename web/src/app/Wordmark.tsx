import font from './pixelfont.json';

export interface WordmarkSegment {
  text: string;
  fill: string;
}

type Glyph = readonly string[];
const glyphs = font.glyphs as Record<string, Glyph>;

/** Cells of a text run: [x, y] for every lit pixel, and the run's width in cells. */
export function layout(segments: WordmarkSegment[]): { cells: Array<{ x: number; y: number; fill: string }>; width: number } {
  const cells: Array<{ x: number; y: number; fill: string }> = [];
  let x = 0;
  segments.forEach((segment, si) => {
    [...segment.text.toUpperCase()].forEach((ch, ci) => {
      const glyph = glyphs[ch];
      if (!glyph) throw new Error(`no glyph for "${ch}"`);
      glyph.forEach((row, y) => [...row].forEach((c, dx) => c === 'X' && cells.push({ x: x + dx, y, fill: segment.fill })));
      x += glyph[0]!.length;
      const last = si === segments.length - 1 && ci === segment.text.length - 1;
      if (!last) x += font.gap;
    });
  });
  return { cells, width: x };
}

/** The brand: thick pixel letters, RIG in lime and .FAN in ink, drawn as one SVG. */
export function Wordmark({ height = 28, segments }: { height?: number; segments?: WordmarkSegment[] }) {
  const segs = segments ?? [
    { text: 'RIG', fill: 'var(--lime)' },
    { text: '.FAN', fill: 'var(--ink)' },
  ];
  const { cells, width } = layout(segs);
  return (
    <svg
      viewBox={`0 0 ${width} ${font.height}`}
      height={height}
      width={(height * width) / font.height}
      shapeRendering="crispEdges"
      role="img"
      aria-label={segs.map((s) => s.text).join('')}
    >
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={1} height={1} fill={c.fill} />
      ))}
    </svg>
  );
}
