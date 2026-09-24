import React from 'react';
import { BookOpen } from 'lucide-react';
import { TileHeader } from './TileParts';
import { fmt } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { DayRecords, Reading, StationStats } from '../../types/weather';

interface AlmanacTileProps {
  reading: Reading;
  stats: StationStats;
  records: DayRecords | null;
}

/**
 * How today and this year compare with what is usual here: today's high and
 * low beside the normal and the record for the date, and the rain so far this
 * month and this year against what normally has fallen by now.
 */
export const AlmanacTile: React.FC<AlmanacTileProps> = ({ reading, stats, records }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const normal = records?.normal ?? null;
  const deg = (f: number | null | undefined) => fmt(units.temp(f), 0, '°');

  /** "+7°" in the warm colour, "−3°" in the cool one, against the normal. */
  const departure = (today: number | null, usual: number | undefined) => {
    if (today === null || usual === undefined) return null;
    const diff = units.tempDelta(today - usual) ?? 0;
    const rounded = Math.round(diff);
    if (rounded === 0) return <span className="text-ink-3">±0°</span>;
    return <span className={rounded > 0 ? 'text-severe' : 'text-cool'}>{rounded > 0 ? '+' : '−'}{Math.abs(rounded)}°</span>;
  };

  const head = `${wall ? 'text-xs' : 'text-[10px]'} font-bold uppercase tracking-[0.12em] text-ink-3`;
  const cell = `${wall ? 'text-xl' : 'text-lg'} font-black leading-none tabular-nums`;
  const note = `${wall ? 'text-sm' : 'text-[11px]'} font-semibold leading-none`;

  const rainRow = (label: string, actual: number | null, usual: number | undefined) => {
    const share = actual !== null && usual !== undefined && usual > 0 ? actual / usual : null;
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`${wall ? 'text-base' : 'text-xs'} text-ink-3 whitespace-nowrap`}>{label}</span>
          <span className={`${wall ? 'text-xl' : 'text-base'} font-black text-ink tabular-nums whitespace-nowrap`}>
            {units.formatRain(actual)}
            <span className={`${wall ? 'text-sm' : 'text-xs'} font-semibold text-ink-3`}>
              {' '}of {units.formatRain(usual)} {units.rainUnit}
            </span>
          </span>
        </div>
        <div className={`mt-1 relative ${wall ? 'h-3' : 'h-2'} rounded-full bg-well overflow-hidden`}>
          {share !== null && (
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.min(100, share * 100)}%`, background: 'var(--rain-total)' }}
            />
          )}
        </div>
        {share !== null && (
          <div className={`mt-1 text-right ${note} ${share >= 1 ? 'text-info-text' : 'text-ink-3'}`}>{Math.round(share * 100)}% of normal</div>
        )}
      </div>
    );
  };

  return (
    <div className="tile p-5 flex flex-col">
      <TileHeader icon={BookOpen} label="Almanac" />

      {!records ? (
        <div className={`flex-1 py-8 flex items-center justify-center ${wall ? 'text-xl' : 'text-sm'} text-ink-3`}>Loading the almanac…</div>
      ) : (
        <div className="mt-3 flex-1 flex flex-col justify-between gap-4">
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-baseline gap-x-2 gap-y-2.5">
            <span />
            <span className={`${head} text-right`}>Normal</span>
            <span className={`${head} text-right`}>Today</span>
            <span className={`${head} text-right`}>Record</span>

            <span className={`${wall ? 'text-lg' : 'text-xs'} font-semibold text-ink-2`}>High</span>
            <span className={`${cell} text-ink-2 text-right`}>{normal ? deg(normal.high) : '—'}</span>
            <span className="text-right">
              <span className={`${cell} text-ink block`}>{deg(stats.today.high.value)}</span>
              <span className={note}>{departure(stats.today.high.value, normal?.high)}</span>
            </span>
            <span className="text-right">
              <span className={`${cell} text-ink block`}>{records.recordHigh ? deg(records.recordHigh.value) : '—'}</span>
              <span className={`${note} text-ink-4`}>{records.recordHigh?.year}</span>
            </span>

            <span className={`${wall ? 'text-lg' : 'text-xs'} font-semibold text-ink-2`}>Low</span>
            <span className={`${cell} text-ink-2 text-right`}>{normal ? deg(normal.low) : '—'}</span>
            <span className="text-right">
              <span className={`${cell} text-cool block`}>{deg(stats.today.low.value)}</span>
              <span className={note}>{departure(stats.today.low.value, normal?.low)}</span>
            </span>
            <span className="text-right">
              <span className={`${cell} text-cool block`}>{records.recordLow ? deg(records.recordLow.value) : '—'}</span>
              <span className={`${note} text-ink-4`}>{records.recordLow?.year}</span>
            </span>
          </div>

          {normal && (
            <div className="space-y-3 pt-3 border-t border-line">
              <div className={head}>Rain</div>
              {rainRow('This month', reading.monthlyrainin, normal.rainMonth)}
              {rainRow('This year', reading.yearlyrainin, normal.rainYear)}
            </div>
          )}

          {!wall && (
            <div className="text-[10px] text-ink-4">
              {normal ? `Normals ${normal.period}, records since ${records.sinceYear}` : `Records since ${records.sinceYear}`} · ERA5 reanalysis
            </div>
          )}
        </div>
      )}
    </div>
  );
};
