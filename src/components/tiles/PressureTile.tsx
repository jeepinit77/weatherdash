import React from 'react';
import { ArrowRight, Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { TileHeader, TileStats } from './TileParts';
import { fmt } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { Reading, StationStats } from '../../types/weather';

interface PressureTileProps {
  reading: Reading;
  stats: StationStats;
}

/** A three-hour change smaller than this, in inHg, is read as steady. */
const STEADY_BELOW_INHG = 0.02;

/** The reading's size where there is room: text-6xl, or text-8xl on the wall. */
const FIGURE_MAX = '3.75rem';
const FIGURE_MAX_WALL = '6rem';
/** Sized to the card's width where there is not. "29.90 inHg" runs about 3.1 times its font size. */
const FIGURE_FIT = '30cqw';

type Trend = 'Rising' | 'Falling' | 'Steady';

const TREND_ICON: Record<Trend, typeof TrendingUp> = {
  Rising: TrendingUp,
  Falling: TrendingDown,
  Steady: ArrowRight,
};

function trendOf(change: number): Trend {
  if (Math.abs(change) < STEADY_BELOW_INHG) return 'Steady';
  return change > 0 ? 'Rising' : 'Falling';
}

/** Barometric pressure: relative pressure large, with which way it has moved over the last three hours. */
export const PressureTile: React.FC<PressureTileProps> = ({ reading, stats }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const change = stats.baromTrend3h;
  const trend = change === null ? null : trendOf(change);
  const TrendIcon = trend ? TREND_ICON[trend] : null;

  // A change is small beside the reading, so hectopascals get a decimal place here.
  const changeDigits = units.pressureUnit === 'hPa' ? 1 : 2;
  const converted = units.pressure(change);
  const changeText = converted === null
    ? '—'
    : `${converted > 0 ? '+' : converted < 0 ? '−' : '±'}${Math.abs(converted).toFixed(changeDigits)} ${units.pressureUnit}`;

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Gauge} label="Pressure" />

      <div className="flex-1 w-full flex flex-col items-center justify-center py-4" style={{ containerType: 'inline-size' }}>
        {/* "29.90 inHg" is wide for its size, so the figure shrinks with a narrow
            tile rather than spilling out of it, and the unit shrinks with it. */}
        <div
          className="font-black text-ink leading-none tabular-nums whitespace-nowrap"
          style={{ fontSize: `min(${wall ? FIGURE_MAX_WALL : FIGURE_MAX}, ${FIGURE_FIT})` }}
        >
          {fmt(units.pressure(reading.baromrelin), units.pressureDigits)}
          {reading.baromrelin !== null && (
            <span className={`ml-[0.1em] ${wall ? 'text-[0.3125em]' : 'text-[0.4em]'} font-bold text-ink-2`}>{units.pressureUnit}</span>
          )}
        </div>
        {trend && TrendIcon && (
          <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-well px-3 py-1 ${wall ? 'text-xl' : 'text-sm'} text-ink-2`}>
            <TrendIcon className={wall ? 'w-6 h-6' : 'w-4 h-4'} aria-hidden="true" />
            <span className="font-semibold text-ink">{trend}</span>
          </div>
        )}
      </div>

      <TileStats
        stats={[
          {
            label: 'Absolute',
            value: fmt(units.pressure(reading.baromabsin), units.pressureDigits),
            title: 'Station pressure, not corrected to sea level',
          },
          { label: '3h change', value: changeText },
        ]}
      />
    </div>
  );
};
