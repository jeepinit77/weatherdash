import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { fmt, formatInZone } from '../../lib/format';
import { useUnits, type UnitSystem } from '../../lib/units';
import type { DayRecords, Reading, StationStats } from '../../types/weather';

interface AlmanacDetailProps {
  reading: Reading;
  stats: StationStats;
  records: DayRecords | null;
  timezone: string | null;
}

/** Where a figure comes from: the station's own gauge and thermometer, or the reanalysis for the area. */
type Source = 'station' | 'area';

const SourceDot: React.FC<{ source: Source }> = ({ source }) => (
  <span
    aria-hidden
    className={`inline-block w-2 h-2 rounded-full shrink-0 ${source === 'station' ? 'bg-info' : 'border-2 border-ink-3'}`}
  />
);

/** The small all-caps label over a figure, marked with where the figure comes from. */
const Label: React.FC<{ source?: Source; children: React.ReactNode }> = ({ source, children }) => (
  <div className="flex items-center gap-2 text-[0.7rem] sm:text-xs font-bold text-ink-3 tracking-[0.18em] uppercase whitespace-nowrap">
    {source && <SourceDot source={source} />}
    {children}
  </div>
);

/** A section heading with a rule running out to the right. */
const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-4 mt-5 mb-3">
    <h3 className="text-sm sm:text-base font-black text-ink-2 tracking-[0.22em] uppercase whitespace-nowrap">{children}</h3>
    <span className="flex-1 h-px bg-line" />
  </div>
);

/** A calendar date, YYYY-MM-DD, as "Sep 17". It is already local to the station, so no zone applies. */
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Whole days from one YYYY-MM-DD to another. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Where this browser keeps the thresholds its viewer last picked for the day counts. */
const THRESHOLD_STORAGE_KEY = 'weatherdash_almanac_thresholds';
/** The thresholds to start from, and how far one press moves them, in each system's own degrees. */
const THRESHOLD_DEFAULTS: Record<UnitSystem, { above: number; below: number; step: number; freezing: number }> = {
  us: { above: 90, below: 32, step: 5, freezing: 32 },
  metric: { above: 32, below: 0, step: 2, freezing: 0 },
};

const storedThreshold = (key: string): number | null => {
  try {
    const value = (JSON.parse(localStorage.getItem(THRESHOLD_STORAGE_KEY) ?? '{}') as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

const storeThreshold = (key: string, value: number) => {
  try {
    const all = JSON.parse(localStorage.getItem(THRESHOLD_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(THRESHOLD_STORAGE_KEY, JSON.stringify({ ...all, [key]: value }));
  } catch { /* storage unavailable */ }
};

const stepButton = 'p-1.5 rounded-lg border border-line bg-fill-soft text-ink-2 hover:bg-fill transition-colors';

/**
 * How many days this year the high went above, or the low below, a temperature
 * the viewer sets with the buttons beside it.
 */
const DaysBeyond: React.FC<{ kind: 'above' | 'below'; temps: number[]; since: string }> = ({ kind, temps, since }) => {
  const units = useUnits();
  const defaults = THRESHOLD_DEFAULTS[units.system];
  const key = `${kind}-${units.system}`;
  const [threshold, setThreshold] = useState(() => storedThreshold(key) ?? defaults[kind]);
  // Each press lands on the next round number, with freezing as a stop of its own:
  // 30°, 32°, 35° rather than 27°, 32°, 37°.
  const change = (direction: 1 | -1) => {
    const { step, freezing } = defaults;
    let next = direction > 0 ? Math.floor(threshold / step) * step + step : Math.ceil(threshold / step) * step - step;
    if ((threshold - freezing) * (next - freezing) < 0) next = freezing;
    setThreshold(next);
    storeThreshold(key, next);
  };
  const count = temps.filter(f => {
    const t = units.temp(f) ?? 0;
    return kind === 'above' ? t > threshold : t < threshold;
  }).length;
  return (
    <div className="rounded-xl bg-fill-soft border border-line px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <Label source="station">Days {kind}</Label>
        <div className="flex items-center gap-1.5">
          <button type="button" className={stepButton} onClick={() => change(-1)} aria-label="Lower" title="Lower">
            <Minus className="w-4 h-4" />
          </button>
          <span className={`min-w-[3.25rem] text-center text-lg font-black tabular-nums ${kind === 'above' ? 'text-severe' : 'text-cool'}`}>{threshold}°</span>
          <button type="button" className={stepButton} onClick={() => change(1)} aria-label="Higher" title="Higher">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-baseline gap-2.5">
        <span className="text-3xl font-black leading-none tabular-nums text-ink">{count}</span>
        <span className="text-sm text-ink-3">{kind === 'above' ? 'highs' : 'lows'} since {shortDate(since)}</span>
      </div>
    </div>
  );
};

const daysAgo = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

/** The almanac at length: today against normal and history, the station's rain against the usual, and how long since it last rained. */
export const AlmanacDetail: React.FC<AlmanacDetailProps> = ({ reading, stats, records, timezone }) => {
  const units = useUnits();
  const deg = (f: number | null | undefined) => fmt(units.temp(f), 0, '°');
  const amount = (inches: number | null | undefined) => {
    const text = units.formatRain(inches);
    return text === '—' ? text : `${text} ${units.rainUnit}`;
  };

  if (!records) return <p className="mt-6 text-ink-3">The almanac has not loaded yet.</p>;

  const normal = records.normal ?? null;
  const almanac = stats.almanac ?? null;
  const now = new Date();
  // The station's today as YYYY-MM-DD, which en-CA writes in that order.
  const todayIso = (() => {
    try {
      return now.toLocaleDateString('en-CA', { timeZone: timezone ?? undefined });
    } catch {
      return now.toLocaleDateString('en-CA');
    }
  })();
  const monthName = formatInZone(now, timezone, { month: 'long' });
  const yearName = formatInZone(now, timezone, { year: 'numeric' });
  const throughToday = formatInZone(now, timezone, { month: 'short', day: 'numeric' });

  /** A row of today's high or low: so far, the normal, how far off it, and the most extreme on record. */
  const tempRow = (
    kind: 'High' | 'Low',
    today: number | null,
    usual: number | undefined,
    record: { value: number; year: number } | null,
    tone: string,
  ) => {
    const diff = today === null || usual === undefined ? null : Math.round(units.tempDelta(today - usual) ?? 0);
    const diffTone = diff === null || diff === 0 ? 'text-ink-2' : diff > 0 ? 'text-severe' : 'text-cool';
    return (
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto_1.1fr_1.1fr] items-center gap-x-6 gap-y-3 py-4 first:pt-0">
        <div>
          <Label source="station">{kind} so far</Label>
          <div className={`mt-1.5 text-5xl sm:text-6xl font-black leading-none tabular-nums ${tone}`}>{deg(today)}</div>
        </div>
        <div>
          <Label source="area">Normal {kind.toLowerCase()}</Label>
          <div className="mt-1.5 text-4xl sm:text-5xl font-black leading-none tabular-nums text-ink-2">{normal ? deg(usual) : '—'}</div>
        </div>
        <span className="hidden sm:block w-px self-stretch bg-line" />
        <div>
          <div className={`text-4xl sm:text-5xl font-black leading-none tabular-nums ${diffTone}`}>
            {diff === null ? '—' : diff === 0 ? '±0°' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}°`}
          </div>
          <div className="mt-1.5 text-sm sm:text-base font-semibold text-ink-2">
            {diff === null ? 'against normal' : diff === 0 ? 'right at normal' : `${diff > 0 ? 'above' : 'below'} normal`}
          </div>
        </div>
        <div>
          <Label source="area">Historical {kind.toLowerCase()}</Label>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span className={`text-3xl sm:text-4xl font-black leading-none tabular-nums ${tone}`}>{record ? deg(record.value) : '—'}</span>
            {record && <span className="text-lg sm:text-xl font-semibold text-ink-3 tabular-nums">· {record.year}</span>}
          </div>
        </div>
      </div>
    );
  };

  /** Rain so far against what has usually fallen by today, as a bar with the usual marked on it. */
  const rainRow = (label: string, actual: number | null, usual: number, wholeYear?: number | null) => {
    const gap = actual === null ? null : actual - usual;
    const scale = Math.max(actual ?? 0, usual, 0.01) * 1.1;
    const gapText = gap === null ? null
      : Math.abs(gap) < 0.01 ? 'Right at typical'
      : `${amount(Math.abs(gap))} ${gap > 0 ? 'above' : 'below'} typical`;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(10rem,14rem)_1fr] items-center gap-x-8 gap-y-2 py-4 first:pt-0">
        <div>
          <Label source="station">{label}</Label>
          <div className="mt-1.5 text-5xl sm:text-6xl font-black leading-none tabular-nums text-info-text">{amount(actual)}</div>
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm sm:text-base text-ink-2">
            <SourceDot source="area" />
            <span>Typical through {throughToday} · <span className="font-black text-ink">{amount(usual)}</span></span>
          </div>
          <div className="relative mt-3 h-3.5 rounded-full bg-well">
            {actual !== null && (
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.max(1.5, (actual / scale) * 100)}%`, background: 'var(--rain-total)' }}
              />
            )}
            <div
              aria-hidden
              className="absolute -top-1.5 -bottom-1.5 w-[3px] -ml-[1.5px] rounded-full bg-ink"
              style={{ left: `${(usual / scale) * 100}%` }}
            />
          </div>
          {gapText && (
            <div className={`mt-2.5 text-base sm:text-lg font-bold ${gap !== null && gap < -0.005 ? 'text-warn-text' : 'text-info-text'}`}>{gapText}</div>
          )}
          {wholeYear != null && <div className="mt-1 text-sm sm:text-base text-ink-3">Typical full year · {amount(wholeYear)}</div>}
        </div>
      </div>
    );
  };

  const lastRain = almanac?.lastRain ?? null;
  const dry = almanac?.dryStretch ?? null;
  const yearTemps = almanac?.yearTemps ?? null;

  return (
    <>
      <Heading>Temperature today</Heading>
      <div className="divide-y divide-line">
        {tempRow('High', stats.today.high.value, normal?.high, records.recordHigh, 'text-ink')}
        {tempRow('Low', stats.today.low.value, normal?.low, records.recordLow, 'text-cool')}
      </div>

      <Heading>Rainfall</Heading>
      {almanac && (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(10rem,14rem)_1fr] items-center gap-x-8 gap-y-2 rounded-2xl bg-info-soft border border-info-line px-5 py-3.5 mb-1">
          <div>
            <Label source="station">Last rain</Label>
            <div className="mt-1.5 text-5xl sm:text-6xl font-black leading-none tabular-nums text-info-text">
              {lastRain ? amount(lastRain.amount) : '—'}
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-ink leading-tight">
              {lastRain ? daysAgo(daysBetween(lastRain.date, todayIso)).replace(/^./, c => c.toUpperCase()) : `None of ${amount(0.1)} or more`}
            </div>
            <div className="mt-1 text-sm sm:text-base text-ink-2">
              {lastRain && shortDate(lastRain.date)}
              {lastRain && almanac.lightRainSince !== null && ` · ${amount(almanac.lightRainSince)} of light rain since`}
            </div>
          </div>
        </div>
      )}
      {normal ? (
        <div className="divide-y divide-line">
          {rainRow(monthName, reading.monthlyrainin, normal.rainMonth)}
          {rainRow(yearName, reading.yearlyrainin, normal.rainYear, normal.rainAnnual)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 py-4">
          <div><Label source="station">{monthName}</Label><div className="mt-1.5 text-4xl font-black text-info-text">{amount(reading.monthlyrainin)}</div></div>
          <div><Label source="station">{yearName}</Label><div className="mt-1.5 text-4xl font-black text-info-text">{amount(reading.yearlyrainin)}</div></div>
        </div>
      )}

      {(dry || yearTemps) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {dry && (
            <div className="rounded-xl bg-fill-soft border border-line px-4 py-3">
              <Label source="station">Longest dry stretch</Label>
              {/* As tall as the stepper row beside it, so the three counts line up. */}
              <div className="mt-[1.1rem] flex items-baseline gap-2.5">
                <span className="text-3xl font-black leading-none tabular-nums text-ink">{dry.days} {dry.days === 1 ? 'day' : 'days'}</span>
                <span className="text-sm text-ink-3">
                  {dry.ongoing ? `since ${shortDate(dry.start)}, and counting` : `${shortDate(dry.start)} – ${shortDate(dry.end)}`}
                </span>
              </div>
            </div>
          )}
          {yearTemps && <DaysBeyond kind="above" temps={yearTemps.highs} since={yearTemps.since} />}
          {yearTemps && <DaysBeyond kind="below" temps={yearTemps.lows} since={yearTemps.since} />}
        </div>
      )}

      <div className="mt-5 pt-3 border-t border-line flex flex-wrap gap-x-6 gap-y-2 text-xs sm:text-sm text-ink-3">
        <span className="flex items-center gap-2"><SourceDot source="station" /> Station measurements</span>
        <span className="flex items-center gap-2">
          <SourceDot source="area" />
          Area estimates: normals {normal?.period ?? '1991–2020'}, history since {records.sinceYear} (ERA5 reanalysis)
        </span>
      </div>
    </>
  );
};
