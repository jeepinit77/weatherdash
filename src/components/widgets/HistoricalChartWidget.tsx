import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, BarChart, Bar } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { TileHeader } from '../tiles/TileParts';
import { CONTROLS_ROW, KEY_ROW, KEY_ROW_WALL, PLOT_HEIGHT, PLOT_HEIGHT_WALL } from './historyChartLayout';
import { formatInZone } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';
import { useUnits, type Units } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { HistoryPoint, HistoryRange } from '../../types/weather';

interface HistoricalChartWidgetProps {
  /** Null while the current range is still loading. */
  data: HistoryPoint[] | null;
  /** The last request for this range failed. */
  hasError: boolean;
  range: HistoryRange;
  timezone: string | null;
  onRangeChange: (range: HistoryRange) => void;
}

type Metric = 'temp' | 'wind' | 'pressure' | 'rain' | 'solar';

const RANGES: { id: HistoryRange; label: string }[] = [
  { id: '24h', label: '24 Hours' },
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: '1y', label: '1 Year' },
];

const METRICS: { id: Metric; label: string }[] = [
  { id: 'temp', label: 'Temperature' },
  { id: 'wind', label: 'Wind' },
  { id: 'pressure', label: 'Pressure' },
  { id: 'rain', label: 'Rain' },
  { id: 'solar', label: 'Solar' },
];

/*
  Recharts writes its colours out as SVG presentation attributes, where a
  `var(--token)` would be taken literally and paint nothing. So this is one of
  the few places that asks for the tokens' current values instead of naming
  them.
*/
const CHART_TOKENS = {
  tempHigh: '--chart-temp-high',
  tempLow: '--chart-temp-low',
  dew: '--chart-dew',
  gust: '--chart-gust',
  wind: '--chart-wind',
  pressure: '--chart-pressure',
  rain: '--chart-rain',
  solar: '--chart-solar',
  grid: '--chart-grid',
  axis: '--chart-axis',
} as const;

/** A history point with every value converted to the viewer's units, and the original kept for the tooltip. */
interface Row {
  time: string;
  tempf: number | null;
  tempMin: number | null;
  tempMax: number | null;
  dewPoint: number | null;
  baromrelin: number | null;
  windspeedmph: number | null;
  windgustmph: number | null;
  rainin: number | null;
  solarradiation: number | null;
  raw: HistoryPoint;
}

function toRow(p: HistoryPoint, units: Units): Row {
  return {
    time: p.time,
    tempf: units.temp(p.tempf),
    tempMin: units.temp(p.tempMin),
    tempMax: units.temp(p.tempMax),
    dewPoint: units.temp(p.dewPoint),
    baromrelin: units.pressure(p.baromrelin),
    windspeedmph: units.speed(p.windspeedmph),
    windgustmph: units.speed(p.windgustmph),
    rainin: units.rain(p.rainin),
    solarradiation: p.solarradiation,
    raw: p,
  };
}

/** One series on the plot, as the key and the tooltip name it. */
interface SeriesKey {
  label: string;
  color: string;
  dashed?: boolean;
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && !Number.isNaN(v);

/** "58–71°", or the one end that was recorded, or null when neither was. */
function span(lo: number | null | undefined, hi: number | null | undefined, digits: number, suffix: string): string | null {
  if (isNum(lo) && isNum(hi)) return `${lo.toFixed(digits)}–${hi.toFixed(digits)}${suffix}`;
  if (isNum(lo)) return `${lo.toFixed(digits)}${suffix}`;
  if (isNum(hi)) return `${hi.toFixed(digits)}${suffix}`;
  return null;
}

/** The extra detail a daily summary carries, for the tooltip. Only what was recorded. */
function dailyExtras(p: HistoryPoint, units: Units): [string, string][] {
  const rows: [string, string | null][] = [
    ['Feels like', span(units.temp(p.feelsLikeMin), units.temp(p.feelsLikeMax), 0, '°')],
    ['Humidity', span(p.humidityMin, p.humidityMax, 0, '%')],
    ['Dew point', span(units.temp(p.dewPointMin), units.temp(p.dewPointMax), 0, '°')],
    ['Pressure', span(units.pressure(p.baromMin), units.pressure(p.baromMax), units.pressureDigits, ` ${units.pressureUnit}`)],
    ['Max rain rate', isNum(p.rainRateMax) ? `${units.formatRain(p.rainRateMax)} ${units.rainUnit}/hr` : null],
    ['Readings', isNum(p.readingCount) ? String(p.readingCount) : null],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

export const HistoricalChartWidget: React.FC<HistoricalChartWidgetProps> = ({ data, hasError, range, timezone, onRangeChange }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const [metric, setMetric] = useState<Metric>('temp');
  const isDaily = range === '30d' || range === '1y';
  const colors = useThemeColors(CHART_TOKENS);

  const rows = useMemo(() => (data ? data.map(p => toRow(p, units)) : null), [data, units]);

  const tickSize = wall ? 16 : 11;
  const axisProps = { stroke: colors.axis, fontSize: tickSize, tickLine: false };
  const yWidth = wall ? 80 : 60;
  const margin = { top: 10, right: 10, left: wall ? 0 : -10, bottom: 0 };

  // Daily points are already local dates; raw points are UTC timestamps shown in the station's timezone.
  const tickLabel = (time: string) => {
    if (isDaily) {
      const [y, m, d] = time.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    const opts: Intl.DateTimeFormatOptions = range === '24h' ? { hour: 'numeric' } : { weekday: 'short', hour: 'numeric' };
    return formatInZone(new Date(time), timezone, opts);
  };

  /** Digits each metric's figures are shown to in the tooltip. */
  const digits: Record<Metric, number> = {
    temp: 0,
    wind: 0,
    pressure: units.pressureDigits,
    rain: units.rainDigits,
    solar: 0,
  };

  const tooltipContent = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload as Row;
    const extras = isDaily ? dailyExtras(row.raw, units) : [];
    return (
      <div
        className={`rounded-xl border px-3 py-2 shadow-lg ${wall ? 'text-base' : 'text-xs'}`}
        style={{ background: 'var(--chart-tip-bg)', borderColor: 'var(--chart-tip-line)', color: 'var(--ink)' }}
      >
        <div className="font-bold mb-1">{tickLabel(String(label))}</div>
        {payload.map(entry => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-semibold tabular-nums">
              {typeof entry.value === 'number' && !Number.isNaN(entry.value) ? entry.value.toFixed(digits[metric]) : '—'}
            </span>
          </div>
        ))}
        {extras.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-line space-y-0.5 text-ink-2">
            {extras.map(([name, value]) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <span>{name}</span>
                <span className="font-semibold text-ink tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const xAxis = <XAxis dataKey="time" {...axisProps} tickFormatter={tickLabel} minTickGap={wall ? 40 : 24} />;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />;
  const tooltip = <Tooltip content={tooltipContent} />;

  const t = units.tempUnit;
  const s = units.speedUnit;
  const r = units.rainUnit;

  // The series each metric draws, which is also what its key lists.
  const series: Record<Metric, SeriesKey[]> = {
    temp: isDaily
      ? [{ label: `High (${t})`, color: colors.tempHigh }, { label: `Low (${t})`, color: colors.tempLow }]
      : [{ label: `Temperature (${t})`, color: colors.tempHigh }, { label: `Dew point (${t})`, color: colors.dew, dashed: true }],
    wind: [
      { label: isDaily ? `Max gust (${s})` : `Gust (${s})`, color: colors.gust },
      { label: isDaily ? `Average (${s})` : `Speed (${s})`, color: colors.wind },
    ],
    pressure: [{ label: `Pressure (${units.pressureUnit})`, color: colors.pressure }],
    rain: [{ label: isDaily ? `Rain (${r})` : `Rain since midnight (${r})`, color: colors.rain }],
    solar: [{ label: isDaily ? 'Peak solar (W/m²)' : 'Solar (W/m²)', color: colors.solar }],
  };
  const keys = series[metric];

  const chart = (rows: Row[]) => {
    switch (metric) {
      case 'temp':
        return (
          <LineChart data={rows} margin={margin}>
            {grid}{xAxis}
            <YAxis {...axisProps} width={yWidth} domain={['auto', 'auto']} unit="°" />
            {tooltip}
            {isDaily ? (
              <>
                <Line type="monotone" dataKey="tempMax" name={keys[0].label} stroke={keys[0].color} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tempMin" name={keys[1].label} stroke={keys[1].color} strokeWidth={2} dot={false} />
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="tempf" name={keys[0].label} stroke={keys[0].color} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="dewPoint" name={keys[1].label} stroke={keys[1].color} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </>
            )}
          </LineChart>
        );
      case 'wind':
        return (
          <AreaChart data={rows} margin={margin}>
            {grid}{xAxis}
            <YAxis {...axisProps} width={yWidth} />
            {tooltip}
            <Area type="monotone" dataKey="windgustmph" name={keys[0].label} stroke={keys[0].color} strokeWidth={2} fill="none" />
            <Area type="monotone" dataKey="windspeedmph" name={keys[1].label} stroke={keys[1].color} strokeWidth={2.5} fill={keys[1].color} fillOpacity={0.15} />
          </AreaChart>
        );
      case 'pressure':
        return (
          <LineChart data={rows} margin={margin}>
            {grid}{xAxis}
            <YAxis {...axisProps} width={yWidth} domain={['auto', 'auto']} />
            {tooltip}
            <Line type="monotone" dataKey="baromrelin" name={keys[0].label} stroke={keys[0].color} strokeWidth={2.5} dot={false} />
          </LineChart>
        );
      case 'rain':
        return isDaily ? (
          <BarChart data={rows} margin={margin}>
            {grid}{xAxis}
            <YAxis {...axisProps} width={yWidth} />
            {tooltip}
            <Bar dataKey="rainin" name={keys[0].label} fill={keys[0].color} radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <AreaChart data={rows} margin={margin}>
            {grid}{xAxis}
            <YAxis {...axisProps} width={yWidth} />
            {tooltip}
            <Area type="stepAfter" dataKey="rainin" name={keys[0].label} stroke={keys[0].color} strokeWidth={2} fill={keys[0].color} fillOpacity={0.2} />
          </AreaChart>
        );
      case 'solar':
        return (
          <AreaChart data={rows} margin={margin}>
            {grid}{xAxis}
            <YAxis {...axisProps} width={yWidth} />
            {tooltip}
            <Area type="monotone" dataKey="solarradiation" name={keys[0].label} stroke={keys[0].color} strokeWidth={2} fill={keys[0].color} fillOpacity={0.2} />
          </AreaChart>
        );
    }
  };

  const metricLabel = METRICS.find(m => m.id === metric)!.label;
  const rangeLabel = RANGES.find(x => x.id === range)!.label;
  const message = wall ? 'text-xl' : 'text-sm';

  let plot: React.ReactNode;
  if (rows && rows.length > 0) {
    plot = <ResponsiveContainer width="100%" height="100%">{chart(rows)}</ResponsiveContainer>;
  } else if (hasError) {
    plot = <div className={`h-full flex items-center justify-center ${message} text-ink-3`}>Couldn't load history. Retrying shortly.</div>;
  } else if (rows === null) {
    plot = (
      <div className={`h-full rounded-xl bg-well animate-pulse flex items-center justify-center ${message} text-ink-3`} aria-busy="true">
        Loading…
      </div>
    );
  } else {
    plot = <div className={`h-full flex items-center justify-center ${message} text-ink-3`}>No history recorded for this period yet.</div>;
  }

  const buttonGroup = 'flex flex-wrap bg-well rounded-lg p-1 border border-line-soft text-xs';
  const select = 'min-w-0 flex-1 rounded-lg border border-line-soft bg-well px-3 py-2 text-sm text-ink';

  return (
    <div className="tile p-5">
      {/* A wall display shows the chart as it stands; the header says what that is. */}
      <TileHeader icon={TrendingUp} label={wall ? `History · ${metricLabel} · ${rangeLabel}` : 'History'} />

      {!wall && (
        <div className={`mt-4 ${CONTROLS_ROW} flex items-center`}>
          {/* Phones get two pickers; there is no room for two rows of buttons. */}
          <div className="sm:hidden flex w-full gap-3">
            <select aria-label="Measurement" className={select} value={metric} onChange={e => setMetric(e.target.value as Metric)}>
              {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select aria-label="Time range" className={select} value={range} onChange={e => onRangeChange(e.target.value as HistoryRange)}>
              {RANGES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </div>

          <div className="hidden sm:flex w-full flex-wrap items-center justify-between gap-3">
            <div className={buttonGroup} role="group" aria-label="Measurement">
              {METRICS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={metric === m.id}
                  onClick={() => setMetric(m.id)}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${
                    metric === m.id ? 'bg-fill-strong text-ink shadow' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className={buttonGroup} role="group" aria-label="Time range">
              {RANGES.map(x => (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={range === x.id}
                  onClick={() => onRangeChange(x.id)}
                  className={`px-2.5 py-1.5 rounded-md font-medium transition ${
                    range === x.id ? 'bg-accent-strong text-accent-ink shadow' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`mt-4 ${wall ? `${KEY_ROW_WALL} text-base` : `${KEY_ROW} text-xs`} flex items-center justify-center gap-4 text-ink-2`}>
        {keys.map(k => (
          <span key={k.label} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="w-4 border-t-2"
              style={{ borderColor: k.color, borderTopStyle: k.dashed ? 'dashed' : 'solid' }}
              aria-hidden="true"
            />
            {k.label}
          </span>
        ))}
      </div>

      <div className={`mt-2 w-full ${wall ? PLOT_HEIGHT_WALL : PLOT_HEIGHT}`}>{plot}</div>
    </div>
  );
};
