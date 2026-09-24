import React, { useId } from 'react';
import { CloudRain } from 'lucide-react';
import { GaugeCanvas, GaugeFrame, GaugeRing } from './GaugeRing';
import { GAUGE_CENTRE, OUTER_R, dialUnits } from './gaugeGeometry';
import { TileHeader, TileStats } from './TileParts';
import { useThemeColors } from '../../lib/theme';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { Reading, StationStats } from '../../types/weather';

interface RainTileProps {
  reading: Reading;
  stats: StationStats;
}

const TOTAL_FULL_SCALE = 2;
const TOTAL_COLOR = 'var(--rain-total)';

const RING_R = OUTER_R;
/** Matches the inner ring's thickness on the wind and humidity tiles. */
const RING_STROKE = 13;

/** Radar-style reflectivity colours: green (light) through yellow and orange to red and magenta (extreme). */
const RATE_COLOR_STOPS: [number, string][] = [
  [0.1, 'var(--rate-1)'],
  [0.3, 'var(--rate-2)'],
  [0.6, 'var(--rate-3)'],
  [1.0, 'var(--rate-4)'],
  [Infinity, 'var(--rate-5)'],
];

/** Rate above which the glow reads at full intensity. */
const RATE_GLOW_SCALE = 1;

/** Read rather than named: this one is a number, not a colour. */
const GLOW_TOKENS = { strength: '--rate-glow' } as const;

function rateColor(rate: number): string {
  return RATE_COLOR_STOPS.find(([max]) => rate <= max)![1];
}

export const RainTile: React.FC<RainTileProps> = ({ reading, stats }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const glowId = useId();
  const rate = reading.hourlyrainin;
  const hasRate = rate !== null && rate > 0;
  const glowColor = hasRate ? rateColor(rate) : 'transparent';
  // Themes damp the glow by their own amount; a wash that reads as weather on a
  // dark card reads as a stain on a pale one.
  const glowStrength = Number(useThemeColors(GLOW_TOKENS).strength) || 0;
  const glowOpacity = hasRate ? (0.25 + Math.min(1, rate / RATE_GLOW_SCALE) * 0.5) * glowStrength : 0;
  // Every amount on the card goes through the one formatter, so they share a precision.
  const amount = (inches: number | null | undefined) => {
    const text = units.formatRain(inches);
    return text === '—' ? text : `${text} ${units.rainUnit}`;
  };

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={CloudRain} label="Rain" />

      <GaugeFrame>
        <GaugeCanvas>
          {hasRate && (
            <defs>
              <radialGradient id={glowId}>
                <stop offset="0%" style={{ stopColor: glowColor }} stopOpacity={glowOpacity} />
                <stop offset="70%" style={{ stopColor: glowColor }} stopOpacity={glowOpacity * 0.4} />
                <stop offset="100%" style={{ stopColor: glowColor }} stopOpacity={0} />
              </radialGradient>
            </defs>
          )}
          {hasRate && (
            <circle cx={GAUGE_CENTRE} cy={GAUGE_CENTRE} r={RING_R - RING_STROKE / 2 - 2} fill={`url(#${glowId})`} className="transition-all duration-700" />
          )}
          <GaugeRing
            radius={RING_R}
            value={reading.dailyrainin}
            fullScale={TOTAL_FULL_SCALE}
            color={TOTAL_COLOR}
            strokeWidth={RING_STROKE}
          />
        </GaugeCanvas>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-black text-ink leading-none whitespace-nowrap" style={{ fontSize: dialUnits(units.rainUnit === 'in' ? 72 : 60) }}>
            {units.formatRain(reading.dailyrainin)}
            {units.rainUnit === 'in' ? (
              <span className="align-top" style={{ fontSize: dialUnits(30) }}>&quot;</span>
            ) : (
              <span className="font-bold text-ink-2" style={{ fontSize: dialUnits(24) }}> mm</span>
            )}
          </div>
        </div>
        <div className="absolute inset-x-0 text-center" style={{ top: `calc(50% - ${dialUnits(50)})` }}>
          <div className="font-semibold text-ink-2 uppercase tracking-[0.2em]" style={{ fontSize: dialUnits(wall ? 14 : 12) }}>Today</div>
        </div>
        {hasRate && (
          <>
            <div className="absolute inset-x-0 flex justify-center" style={{ top: `calc(50% + ${dialUnits(46)})` }}>
              <div className="border-t border-line-strong" style={{ width: dialUnits(64) }} />
            </div>
            <div className="absolute inset-x-0 text-center" style={{ top: `calc(50% + ${dialUnits(60)})` }}>
              <div className="font-semibold text-ink-2 leading-none" style={{ fontSize: dialUnits(25) }}>
                {units.formatRain(rate)} {units.rainUnit}/hr
              </div>
            </div>
          </>
        )}
      </GaugeFrame>

      <TileStats
        stats={[
          { label: 'Event', value: amount(reading.eventrainin) },
          { label: '7 Day', value: amount(stats.rain7d) },
          { label: 'Month', value: amount(reading.monthlyrainin) },
          { label: 'Year', value: amount(reading.yearlyrainin) },
        ]}
      />
    </div>
  );
};
