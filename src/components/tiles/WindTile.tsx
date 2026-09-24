import React from 'react';
import { Wind } from 'lucide-react';
import { GaugeCanvas, GaugeFrame, GaugeRing } from './GaugeRing';
import { GAUGE_CENTRE, INNER_R, OUTER_R, dialUnits } from './gaugeGeometry';
import { TileHeader, TileStats } from './TileParts';
import { fmt, windCardinal } from '../../lib/format';
import { useUnits } from '../../lib/units';
import type { Reading, StationStats } from '../../types/weather';

interface WindTileProps {
  reading: Reading;
  stats: StationStats;
}

/** Two distinct rings: inner = current speed, outer = gust, same scale. */
const FULL_SCALE = 40;

const CURRENT_COLOR = 'var(--wind-speed)';
const GUST_COLOR = 'var(--wind-gust)';

const OUTER_STROKE = 9;
const INNER_STROKE = 13;

/** Vane geometry: a chevron from a tip near the centre, out to two shoulders, with a notch between them. */
const VANE_TIP_R = INNER_R - 12;
const VANE_SHOULDER_R = OUTER_R + 25;
const VANE_SHOULDER_DEG = 4.5;
const VANE_NOTCH_R = OUTER_R + 15;

/** Clear margin, in pixels, to leave between the vane's edge and the cut ring/track on either side. */
const GAP_MARGIN_PX = 7;

function degreesForPx(px: number, radius: number): number {
  return (px / radius) * (180 / Math.PI);
}

/**
 * Where the straight tip-to-shoulder edge of the vane crosses a circle of the given radius,
 * expressed as a bearing offset (degrees) from the vane's own centreline.
 */
function vaneEdgeAngleAt(radius: number): number {
  const u1 = 0;
  const v1 = VANE_TIP_R;
  const shoulderRad = (VANE_SHOULDER_DEG * Math.PI) / 180;
  const u2 = VANE_SHOULDER_R * Math.sin(shoulderRad);
  const v2 = VANE_SHOULDER_R * Math.cos(shoulderRad);
  const du = u2 - u1;
  const dv = v2 - v1;
  const a = du * du + dv * dv;
  const b = 2 * (u1 * du + v1 * dv);
  const c = u1 * u1 + v1 * v1 - radius * radius;
  const disc = Math.max(0, b * b - 4 * a * c);
  const sqrtDisc = Math.sqrt(disc);
  const roots = [(-b + sqrtDisc) / (2 * a), (-b - sqrtDisc) / (2 * a)];
  const t = roots.find(r => r >= 0 && r <= 1) ?? 0;
  const u = u1 + t * du;
  const v = v1 + t * dv;
  return (Math.atan2(u, v) * 180) / Math.PI;
}

/** Total angular width of ring to cut out at a given radius, hugging the vane's actual edges plus GAP_MARGIN_PX. */
function gapDegAt(radius: number): number {
  return 2 * (vaneEdgeAngleAt(radius) + degreesForPx(GAP_MARGIN_PX, radius));
}

/** A point on the dial: bearing in compass degrees (0 = top, clockwise), distance from the centre. */
function polar(bearing: number, radius: number): string {
  const radians = ((bearing - 90) * Math.PI) / 180;
  return `${(GAUGE_CENTRE + radius * Math.cos(radians)).toFixed(2)} ${(GAUGE_CENTRE + radius * Math.sin(radians)).toFixed(2)}`;
}

/** A tall chevron spanning both rings, pointing in toward the centre, with a deep concave notch at its back. */
function vanePath(bearing: number): string {
  const tip = polar(bearing, VANE_TIP_R);
  const right = polar(bearing + VANE_SHOULDER_DEG, VANE_SHOULDER_R);
  const notch = polar(bearing, VANE_NOTCH_R);
  const left = polar(bearing - VANE_SHOULDER_DEG, VANE_SHOULDER_R);
  return `M ${tip} L ${right} L ${notch} L ${left} Z`;
}

export const WindTile: React.FC<WindTileProps> = ({ reading, stats }) => {
  const units = useUnits();
  const speed = reading.windspeedmph;
  const gust = reading.windgustmph;
  const dir = reading.winddir;
  const todayMax = stats.today.maxGust ?? reading.maxdailygust;
  const withUnit = (mph: number | null) => fmt(units.speed(mph), 0, ` ${units.speedUnit}`);

  const gapCenter = dir ?? 0;
  const outerGapDeg = dir === null ? 0 : gapDegAt(OUTER_R);
  const innerGapDeg = dir === null ? 0 : gapDegAt(INNER_R);

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Wind} label="Wind" />

      <GaugeFrame>
        <GaugeCanvas>
          <GaugeRing
            radius={OUTER_R}
            value={gust}
            fullScale={FULL_SCALE}
            color={GUST_COLOR}
            strokeWidth={OUTER_STROKE}
            gapCenterDeg={gapCenter}
            gapWidthDeg={outerGapDeg}
          />
          <GaugeRing
            radius={INNER_R}
            value={speed}
            fullScale={FULL_SCALE}
            color={CURRENT_COLOR}
            strokeWidth={INNER_STROKE}
            gapCenterDeg={gapCenter}
            gapWidthDeg={innerGapDeg}
          />
        </GaugeCanvas>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-black text-ink leading-none" style={{ fontSize: dialUnits(72) }}>{fmt(units.speed(speed), 0)}</div>
          <div className="font-semibold text-ink-2" style={{ fontSize: dialUnits(14), marginTop: dialUnits(-2) }}>{units.speedUnit}</div>
          <div className="border-t border-line-strong" style={{ width: dialUnits(64), margin: `${dialUnits(6)} 0` }} />
          <div className="text-ink-2" style={{ fontSize: dialUnits(14) }} title="15-minute gust">
            Gust <span className="font-bold text-ink">{withUnit(gust)}</span>
          </div>
        </div>

        {dir !== null && (
          <GaugeCanvas style={{ overflow: 'visible', filter: 'var(--vane-shadow)' }}>
            <defs>
              <linearGradient id="wind-vane" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: 'var(--vane-1)' }} />
                <stop offset="55%" style={{ stopColor: 'var(--vane-2)' }} />
                <stop offset="100%" style={{ stopColor: 'var(--vane-3)' }} />
              </linearGradient>
            </defs>
            <path
              d={vanePath(dir)}
              fill="url(#wind-vane)"
              style={{ stroke: 'var(--vane-edge)' }}
              strokeWidth="1"
              strokeLinejoin="round"
              className="transition-all duration-700"
            />
          </GaugeCanvas>
        )}
      </GaugeFrame>

      <TileStats
        stats={[
          { label: 'from', value: dir === null ? '—' : windCardinal(dir) },
          { label: '15-min avg', value: withUnit(stats.windAvg15), title: 'Mean wind speed over the last 15 minutes' },
          { label: "Today's Max", value: withUnit(todayMax) },
        ]}
      />
    </div>
  );
};
