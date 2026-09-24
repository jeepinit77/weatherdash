import React from 'react';
import { DIAL_MAX_WIDTH, DIAL_MAX_WIDTH_WALL, GAUGE_CENTRE, GAUGE_SIZE } from './gaugeGeometry';
import { useWallDisplay } from '../../lib/wallDisplay';

/**
 * The square frame a gauge is drawn in. It fills the card's width up to the
 * dial's natural size, so it never overflows a narrow phone, and everything laid
 * over it can be sized with `dialUnits`.
 */
export const GaugeFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wall = useWallDisplay();
  return (
    <div
      className="relative -mt-1 w-full aspect-square"
      style={{ maxWidth: wall ? DIAL_MAX_WIDTH_WALL : DIAL_MAX_WIDTH, containerType: 'inline-size' }}
    >
      {children}
    </div>
  );
};

/** An SVG layer covering the whole frame, in dial drawing units. */
export const GaugeCanvas: React.FC<{ className?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({
  className = '',
  style,
  children,
}) => (
  <svg viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`} className={`absolute inset-0 w-full h-full ${className}`} style={style}>
    {children}
  </svg>
);

const DEFAULT_STROKE = 6;

interface GaugeRingProps {
  radius: number;
  value: number | null;
  /** Value that fills the whole ring. */
  fullScale: number;
  /** Any CSS colour, including a theme token such as `var(--wind-gust)`. */
  color: string;
  strokeWidth?: number;
  /** Compass-style bearing (0 = top, clockwise) at which to always leave a gap, e.g. for a pointer. */
  gapCenterDeg?: number;
  gapWidthDeg?: number;
  /** When set (with rangeEnd), fills the ring only between these two values instead of from zero. `value` is ignored. */
  rangeStart?: number | null;
  rangeEnd?: number | null;
  /** Draws a short radial tick mark at each end of a range arc. */
  showRangeTicks?: boolean;
}

function polar(centre: number, bearingDeg: number, radius: number): [number, number] {
  const radians = ((bearingDeg - 90) * Math.PI) / 180;
  return [centre + radius * Math.cos(radians), centre + radius * Math.sin(radians)];
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Splits the arc [0, endDeg] into segments that avoid a gap of `gapWidth` degrees
 * centred on `gapCenter`, so a pointer resting on the ring always has a clear margin.
 */
function arcSegments(endDeg: number, gapCenter: number, gapWidth: number): [number, number][] {
  const end = Math.min(endDeg, 359.9);
  if (end <= 0) return [];
  if (gapWidth <= 0) return [[0, end]];

  const half = gapWidth / 2;
  const gapStart = normalizeDeg(gapCenter - half);
  const gapEndRaw = gapStart + gapWidth;
  const gapPieces: [number, number][] = gapEndRaw <= 360 ? [[gapStart, gapEndRaw]] : [[gapStart, 360], [0, gapEndRaw - 360]];

  let segments: [number, number][] = [[0, end]];
  for (const [gs, ge] of gapPieces) {
    const next: [number, number][] = [];
    for (const [s, e] of segments) {
      if (ge <= s || gs >= e) {
        next.push([s, e]);
      } else {
        if (gs > s) next.push([s, gs]);
        if (ge < e) next.push([ge, e]);
      }
    }
    segments = next;
  }
  return segments.filter(([s, e]) => e - s > 0.5);
}

function arcPath(centre: number, startDeg: number, endDeg: number, radius: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [x1, y1] = polar(centre, startDeg, radius);
  const [x2, y2] = polar(centre, endDeg, radius);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** One ring of a tile's dial: a shaded track plus a coloured arc for the value. Angles start at the top, clockwise. */
export const GaugeRing: React.FC<GaugeRingProps> = ({
  radius,
  value,
  fullScale,
  color,
  strokeWidth = DEFAULT_STROKE,
  gapCenterDeg = 0,
  gapWidthDeg = 0,
  rangeStart = null,
  rangeEnd = null,
  showRangeTicks = false,
}) => {
  const hasRange = rangeStart !== null && rangeEnd !== null;
  const fraction = Math.min(1, Math.max(0, (value ?? 0) / fullScale));
  const endDeg = fraction * 360;
  const rangeStartDeg = hasRange ? Math.min(359.9, Math.max(0, (rangeStart! / fullScale) * 360)) : 0;
  const rangeEndDeg = hasRange ? Math.min(360, Math.max(0, (rangeEnd! / fullScale) * 360)) : 0;
  // Colours arrive as theme tokens, e.g. `var(--wind-speed)`, so every one of
  // them is set through `style`: an SVG presentation attribute would take the
  // text literally and paint nothing.
  const arcStyle = { stroke: color };
  const centre = GAUGE_CENTRE;

  const tick = (deg: number, key: string) => {
    const [x1, y1] = polar(centre, deg, radius - strokeWidth / 2 - 3);
    const [x2, y2] = polar(centre, deg, radius + strokeWidth / 2 + 3);
    return (
      <line
        key={key}
        x1={x1.toFixed(2)}
        y1={y1.toFixed(2)}
        x2={x2.toFixed(2)}
        y2={y2.toFixed(2)}
        style={{ stroke: 'var(--ring-tick)' }}
        strokeWidth={2}
        strokeLinecap="round"
      />
    );
  };

  // When there's a gap, cut the track itself (not just the value arc) so the tile's
  // background shows through behind a pointer, instead of leaving the track colour visible.
  const trackStart = gapWidthDeg > 0 ? gapCenterDeg + gapWidthDeg / 2 : 0;
  const trackEnd = gapWidthDeg > 0 ? trackStart + (360 - gapWidthDeg) : 360;
  const drawTrackCircle = (r: number, stroke: string, sw: number) =>
    gapWidthDeg > 0 ? (
      <path d={arcPath(centre, trackStart, trackEnd, r)} fill="none" style={{ stroke }} strokeWidth={sw} />
    ) : (
      <circle cx={centre} cy={centre} r={r} fill="none" style={{ stroke }} strokeWidth={sw} />
    );

  return (
    <>
      {/* Grooved, recessed-looking track for the unused portion of the ring. */}
      {drawTrackCircle(radius, 'var(--ring-track)', strokeWidth)}
      {drawTrackCircle(radius - strokeWidth / 2 + 0.75, 'var(--ring-groove)', 1.5)}
      {drawTrackCircle(radius + strokeWidth / 2 - 0.75, 'var(--ring-lip)', 1.5)}
      {hasRange
        ? rangeEndDeg > rangeStartDeg && (
            <path
              d={arcPath(centre, rangeStartDeg, rangeEndDeg, radius)}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="butt"
              className="transition-all duration-700"
              style={arcStyle}
            />
          )
        : fraction > 0 &&
          arcSegments(endDeg, gapCenterDeg, gapWidthDeg).map(([s, e], i) => (
            <path
              key={i}
              d={arcPath(centre, s, e, radius)}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className="transition-all duration-700"
              style={arcStyle}
            />
          ))}
      {hasRange && showRangeTicks && rangeEndDeg > rangeStartDeg && (
        <>
          {tick(rangeStartDeg, 'tick-start')}
          {tick(rangeEndDeg, 'tick-end')}
        </>
      )}
    </>
  );
};
