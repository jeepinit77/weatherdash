import React from 'react';
import { Moon, Sun, Trophy, CalendarDays } from 'lucide-react';
import { TileHeader } from './TileParts';
import { clockAt, fmt, tempColor } from '../../lib/format';
import { sunPhase } from '../../lib/sun';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { DailyForecast, DayRecords, Extreme, RecordStat, StationStats, Reading } from '../../types/weather';

interface TemperatureTileProps {
  reading: Reading;
  stats: StationStats;
  timezone: string | null;
  /** The forecast days, used only for their sun times, to tell day from night. */
  days: readonly DailyForecast[];
  records: DayRecords | null;
}

const RANGE_LOW_COLOR = 'var(--range-low)';
const RANGE_HIGH_COLOR = 'var(--range-high)';

/** A caption above a bold value, with an optional small muted note trailing the value (a year, a time). */
const StatLine: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => {
  const wall = useWallDisplay();
  return (
    <div>
      <div className={`${wall ? 'text-base' : 'text-xs'} text-ink-3`}>{label}</div>
      <div className={`${wall ? 'text-2xl' : 'text-sm'} font-bold text-ink leading-snug`}>
        {value}
        {/* Kept whole, so on a narrow tile "at 11:28 AM" drops to its own line rather than splitting. */}
        {note && <span className={`ml-1.5 inline-block whitespace-nowrap ${wall ? 'text-base' : 'text-[11px]'} font-normal text-ink-4`}>{note}</span>}
      </div>
    </div>
  );
};

export const TemperatureTile: React.FC<TemperatureTileProps> = ({ reading, stats, timezone, days, records }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const degrees = (f: number | null | undefined) => fmt(units.temp(f), 0, '°');

  // Use the reading's own timestamp so the icon matches the data being shown.
  const takenAt = Date.parse(reading.date) / 1000;
  const isDay = Number.isNaN(takenAt) ? null : (sunPhase(days, takenAt, timezone)?.isDay ?? null);

  // The colour scale and the range bar work in °F; only the figures on show are converted.
  const now = reading.tempf;
  const low = stats.today.low.value;
  const high = stats.today.high.value;
  const hasRange = low !== null && high !== null && high > low;
  const nowPct = hasRange && now !== null ? Math.min(100, Math.max(0, ((now - low) / (high - low)) * 100)) : null;

  const recordLine = (label: string, stat: RecordStat | null | undefined) => (
    <StatLine label={label} value={stat ? degrees(stat.value) : '—'} note={stat ? `in ${stat.year}` : undefined} />
  );
  // Only a time that was actually recorded is worth a note; "at —" says nothing.
  const yesterdayLine = (label: string, extreme: Extreme) => (
    <StatLine label={label} value={degrees(extreme.value)} note={extreme.at ? `at ${clockAt(extreme.at, timezone)}` : undefined} />
  );

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={isDay === null ? null : isDay ? Sun : Moon} label="Temperature" />

      <div className="mt-1 flex flex-col items-center">
        <div
          className={`${wall ? 'text-9xl' : 'text-7xl'} font-black leading-none text-figure`}
          style={{ color: tempColor(now) }}
        >
          {fmt(units.temp(now), 0)}
          <span className={`align-top ${wall ? 'text-5xl' : 'text-3xl'}`}>°</span>
        </div>
        {reading.feelsLike !== null && (
          <div className={`mt-3 inline-flex items-center rounded-full border border-line-strong bg-well px-3 py-1 ${wall ? 'text-xl' : 'text-sm'} text-ink-2`}>
            Feels like <span className="ml-1.5 font-semibold text-ink">{degrees(reading.feelsLike)}</span>
          </div>
        )}
      </div>

      <div className="mt-6 w-full">
        <div className="flex items-end justify-between text-center">
          <div className="text-left">
            <div className={`${wall ? 'text-base' : 'text-xs'} text-ink-3`}>Low</div>
            <div className={`${wall ? 'text-3xl' : 'text-lg'} font-bold text-ink leading-tight`}>{degrees(low)}</div>
          </div>
          <div className="text-right">
            <div className={`${wall ? 'text-base' : 'text-xs'} text-ink-3`}>High</div>
            <div className={`${wall ? 'text-3xl' : 'text-lg'} font-bold text-ink leading-tight`}>{degrees(high)}</div>
          </div>
        </div>
        <div className="temp-range-bar relative mt-2 h-1.5 rounded-full">
          <div
            className="absolute left-0 top-1/2 w-3 h-3 rounded-full border-2 border-marker"
            style={{ background: RANGE_LOW_COLOR, transform: 'translate(-50%, -50%)' }}
          />
          {nowPct !== null && (
            <div
              className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-marker"
              style={{
                left: `${nowPct}%`,
                background: tempColor(now),
                transform: 'translate(-50%, -50%)',
                boxShadow: 'var(--marker-shadow)',
              }}
            />
          )}
          <div
            className="absolute right-0 top-1/2 w-3 h-3 rounded-full border-2 border-marker"
            style={{ background: RANGE_HIGH_COLOR, transform: 'translate(50%, -50%)' }}
          />
        </div>
      </div>

      <div className="mt-4 pt-4 w-full border-t border-line grid grid-cols-2 gap-4">
        <div>
          <div className={`flex items-center gap-1.5 ${wall ? 'text-sm' : 'text-[11px]'} font-bold text-ink-3 tracking-[0.15em] mb-2`}>
            <Trophy className={wall ? 'w-4 h-4' : 'w-3.5 h-3.5'} /> RECORDS
          </div>
          <div className="space-y-1.5">
            {recordLine('Record High', records?.recordHigh)}
            {recordLine('Record Low', records?.recordLow)}
          </div>
        </div>
        <div className="pl-4 border-l border-line-strong">
          <div className={`flex items-center gap-1.5 ${wall ? 'text-sm' : 'text-[11px]'} font-bold text-ink-3 tracking-[0.15em] mb-2`}>
            <CalendarDays className={wall ? 'w-4 h-4' : 'w-3.5 h-3.5'} /> YESTERDAY
          </div>
          <div className="space-y-1.5">
            {yesterdayLine('High', stats.yesterday.high)}
            {yesterdayLine('Low', stats.yesterday.low)}
          </div>
        </div>
      </div>
    </div>
  );
};
