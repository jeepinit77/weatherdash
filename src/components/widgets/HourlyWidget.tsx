import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Clock3, CloudOff } from 'lucide-react';
import { TileHeader } from '../tiles/TileParts';
import { fmt, formatInZone, tempColor, windCardinal } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import { UV_TONE, forecastCredit, uvCategory, weatherIcon, weatherLabel } from '../../lib/weather';
import type { ForecastData, HourlyForecast } from '../../types/weather';

type SeriesId = 'temp' | 'feels' | 'dew' | 'rain' | 'precip' | 'humidity' | 'wind' | 'uv' | 'cloud';

const SERIES: { id: SeriesId; label: string; has: (h: HourlyForecast) => boolean }[] = [
  { id: 'temp', label: 'Temperature', has: h => h.temp !== null },
  { id: 'rain', label: 'Rain chance', has: h => h.pop !== null },
  { id: 'feels', label: 'Feels like', has: h => h.feelsLike !== null },
  { id: 'dew', label: 'Dew point', has: h => h.dewPoint !== null },
  { id: 'precip', label: 'Rain amount', has: h => h.precip !== null },
  { id: 'humidity', label: 'Humidity', has: h => h.humidity !== null },
  { id: 'wind', label: 'Wind', has: h => h.windSpeed !== null },
  { id: 'uv', label: 'UV index', has: h => h.uv !== null },
  { id: 'cloud', label: 'Cloud cover', has: h => h.cloudCover !== null },
];

const DEFAULT_SERIES: SeriesId[] = ['temp', 'rain'];
const STORAGE_KEY = 'weatherdash_hourly_series';

function readSeries(): SeriesId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) return saved.filter((id): id is SeriesId => SERIES.some(s => s.id === id));
  } catch { /* storage unavailable */ }
  return DEFAULT_SERIES;
}

const HOURS = 24;
/** Narrower than this per hour and a phone scrolls the chart sideways rather than crushing it. */
const MIN_HOUR_PX = 38;

/** A path through the points, smoothed, skipping gaps. */
function linePath(points: ([number, number] | null)[]): string {
  let d = '';
  let prev: [number, number] | null = null;
  for (const p of points) {
    if (!p) { prev = null; continue; }
    if (!prev) d += `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    else {
      const mx = (prev[0] + p[0]) / 2;
      d += ` C${mx.toFixed(1)},${prev[1].toFixed(1)} ${mx.toFixed(1)},${p[1].toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    }
    prev = p;
  }
  return d;
}

/**
 * The hours worth a figure on a lane: the peak, the trough, the ends, and
 * wherever the value has moved by at least `by` since the figure before it.
 * No two sit closer than `gap` hours, so a flat stretch reads as one number.
 */
function keyHours(values: (number | null)[], by: number, gap: number): Set<number> {
  const idx = values.flatMap((v, i) => (v === null ? [] : [i]));
  const chosen: number[] = [];
  if (idx.length === 0) return new Set();
  const val = (i: number) => values[i] as number;
  const clear = (i: number) => chosen.every(c => Math.abs(c - i) >= gap);
  let hi = idx[0];
  let lo = idx[0];
  for (const i of idx) {
    if (val(i) > val(hi)) hi = i;
    if (val(i) < val(lo)) lo = i;
  }
  chosen.push(hi);
  if (clear(lo) && val(lo) !== val(hi)) chosen.push(lo);
  for (const i of idx) {
    if (!clear(i)) continue;
    const left = chosen.filter(c => c < i);
    const before = left.length > 0 ? val(Math.max(...left)) : null;
    const right = chosen.filter(c => c > i);
    const after = right.length > 0 ? val(Math.min(...right)) : null;
    const isEnd = i === idx[0] || i === idx[idx.length - 1];
    const moved = before === null ? (after === null || Math.abs(val(i) - after) >= by || isEnd) : Math.abs(val(i) - before) >= by;
    if (moved) chosen.push(i);
  }
  return new Set(chosen);
}

/** The longest run of hours meeting a test, as [first, last], or null. */
function longestRun(hours: HourlyForecast[], test: (h: HourlyForecast) => boolean): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  hours.forEach((h, i) => {
    if (test(h)) {
      if (start < 0) start = i;
      if (!best || i - start > best[1] - best[0]) best = [start, i];
    } else start = -1;
  });
  return best;
}

interface HourlyWidgetProps {
  forecast: ForecastData | null;
  hasError: boolean;
}

/**
 * The next day hour by hour. A row of headline figures says what matters —
 * the high, the low, whether and when it rains, the wind and the sun — so
 * nobody has to hunt the chart for it. Below, lanes share one time axis over
 * bands of day and night, and each lane only prints a figure where the value
 * turns or moves; hovering an hour shows everything for it.
 */
export const HourlyWidget: React.FC<HourlyWidgetProps> = ({ forecast, hasError }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const now = useNow(60_000);
  const gradientId = useId();
  const [chosen, setChosen] = useState<SeriesId[]>(readSeries);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The chart's box only exists once there is a forecast to draw.
  const drawn = forecast !== null && forecast.hourly.length > 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [drawn]);

  const toggle = (id: SeriesId) => {
    const next = chosen.includes(id) ? chosen.filter(s => s !== id) : [...chosen, id];
    setChosen(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  if (!drawn) {
    return (
      <div className="tile p-5">
        <TileHeader icon={Clock3} label="Next 24 Hours" />
        <div className={`py-10 flex items-center justify-center gap-2 ${wall ? 'text-xl' : 'text-sm'} text-ink-3`}>
          {hasError || forecast ? <><CloudOff className="w-5 h-5" /> Hourly forecast is unavailable right now.</> : 'Loading forecast…'}
        </div>
      </div>
    );
  }

  const tz = forecast.timezone;
  const nowUnix = now.getTime() / 1000;
  const hours = forecast.hourly.filter(h => h.time + 3600 > nowUnix).slice(0, HOURS);
  const available = SERIES.filter(s => hours.some(s.has));
  const on = (id: SeriesId) => chosen.includes(id) && available.some(s => s.id === id);
  const clock = (unix: number) => formatInZone(new Date(unix * 1000), tz, { hour: 'numeric' });
  const hourName = (i: number) => (i === 0 ? 'Now' : clock(hours[i].time));
  const localHour = (unix: number) => Number(formatInZone(new Date(unix * 1000), tz, { hour: 'numeric', hourCycle: 'h23' }));
  const argBy = (pick: (h: HourlyForecast) => number | null, better: (a: number, b: number) => boolean) => {
    let best = -1;
    hours.forEach((h, i) => {
      const v = pick(h);
      if (v !== null && (best < 0 || better(v, pick(hours[best]) as number))) best = i;
    });
    return best;
  };

  // ── The headline figures ──────────────────────────────────────────────
  interface Glance { key: string; caption: string; value: React.ReactNode; sub: string; tone?: string; className?: string }
  const glances: Glance[] = [];
  const iHi = argBy(h => h.temp, (a, b) => a > b);
  const iLo = argBy(h => h.temp, (a, b) => a < b);
  const tempGlance = (key: string, caption: string, i: number): Glance => ({
    key, caption, value: fmt(units.temp(hours[i].temp), 0, '°'), sub: i === 0 ? 'now' : `at ${clock(hours[i].time)}`, tone: tempColor(hours[i].temp),
  });
  if (iHi >= 0 && iLo >= 0) {
    const pair = [tempGlance('hi', 'High', iHi), tempGlance('lo', 'Low', iLo)];
    glances.push(...(iHi <= iLo ? pair : pair.reverse()));
  }
  const iPop = argBy(h => h.pop, (a, b) => a > b);
  if (iPop >= 0) {
    const peak = hours[iPop].pop as number;
    const total = hours.reduce((sum, h) => sum + (h.precip ?? 0), 0);
    const amount = total >= 0.01 ? ` · ${units.formatRain(total)} ${units.rainUnit}` : '';
    if (peak < 10) glances.push({ key: 'rain', caption: 'Rain', value: 'Dry', sub: 'no rain expected' });
    else {
      const run = peak >= 30 ? longestRun(hours, h => (h.pop ?? 0) >= 30) : null;
      const sub = run && run[1] > run[0]
        ? `${hourName(run[0])}–${clock(hours[run[1]].time + 3600)}${amount}`
        : `at ${clock(hours[iPop].time)}${amount}`;
      glances.push({ key: 'rain', caption: peak >= 30 ? 'Rain likely' : 'Rain chance', value: `${peak.toFixed(0)}%`, sub, tone: 'var(--info-text)' });
    }
  }
  const iGust = argBy(h => h.windGust ?? h.windSpeed, (a, b) => a > b);
  if (iGust >= 0) {
    const g = hours[iGust];
    const top = (g.windGust ?? g.windSpeed) as number;
    const gusty = g.windGust !== null;
    glances.push(top < 3
      ? { key: 'wind', caption: 'Wind', value: 'Calm', sub: 'all day' }
      : { key: 'wind', caption: gusty ? 'Gusts to' : 'Wind to', value: `${fmt(units.speed(top), 0)} ${units.speedUnit}`, sub: iGust === 0 ? 'now' : `at ${clock(g.time)}` });
  }
  const iUv = argBy(h => h.uv, (a, b) => a > b);
  if (iUv >= 0 && (hours[iUv].uv as number) >= 1) {
    const uv = hours[iUv].uv as number;
    const run = uv >= 6 ? longestRun(hours, h => (h.uv ?? 0) >= 6) : null;
    glances.push({
      key: 'uv', caption: `UV ${uvCategory(uv)}`, value: uv.toFixed(0), className: UV_TONE[uvCategory(uv)],
      sub: run && run[1] > run[0] ? `${hourName(run[0])}–${clock(hours[run[1]].time + 3600)}` : iUv === 0 ? 'now' : `at ${clock(hours[iUv].time)}`,
    });
  }

  // ── Geometry. Everything below is in CSS pixels, so type stays its true size.
  const hourPx = width > 0 ? (wall ? width / hours.length : Math.max(MIN_HOUR_PX, width / hours.length)) : MIN_HOUR_PX;
  const chartWidth = hourPx * hours.length;
  const step = hourPx >= 46 ? 1 : hourPx >= 23 ? 2 : 3;
  const gap = Math.max(3, Math.ceil((wall ? 120 : 84) / hourPx));
  const x = (i: number) => i * hourPx + hourPx / 2;
  const xAt = (unix: number) => x(0) + ((unix - hours[0].time) / 3600) * hourPx;
  const labelled = (i: number) => i % step === 0;
  const text = wall ? 20 : 12;
  const figure = wall ? 22 : 13;
  const big = wall ? 30 : 18;
  const caption = wall ? 15 : 10;
  const laneGap = wall ? 14 : 10;

  let y = 0;
  const lanes: React.ReactNode[] = [];
  const laneCaption = (label: string, top: number, note?: string) => (
    <text x={4} y={top + caption} fontSize={caption} fontWeight={700} letterSpacing="0.12em" style={{ fill: 'var(--ink-3)' }}>
      {label.toUpperCase()}
      {note && <tspan dx={caption} fontWeight={500} letterSpacing="0" style={{ fill: 'var(--ink-4)' }}>{note}</tspan>}
    </text>
  );
  /** A lane with nothing to draw collapses to its caption and a word saying so. */
  const emptyLane = (key: SeriesId, label: string, note: string) => {
    lanes.push(<g key={key}>{laneCaption(label, y, note)}</g>);
    y += caption + laneGap + 4;
  };

  // Hour labels and the sky.
  const headH = wall ? 72 : 46;
  lanes.push(
    <g key="head">
      {hours.map((h, i) => labelled(i) && (
        <g key={h.time}>
          <text x={x(i)} y={text} fontSize={text} textAnchor="middle" fontWeight={600} style={{ fill: i === 0 ? 'var(--accent-text)' : 'var(--ink-3)' }}>
            {hourName(i)}
          </text>
          <foreignObject x={x(i) - (wall ? 18 : 11)} y={text + 6} width={wall ? 36 : 22} height={wall ? 36 : 22}>
            {weatherIcon(h.weatherCode, 'w-full h-full')}
          </foreignObject>
        </g>
      ))}
    </g>,
  );
  y += headH;

  // Temperature lane, with feels-like and dew point drawn on the same scale.
  const tempKeys = (['temp', 'feels', 'dew'] as const).filter(on);
  if (tempKeys.length > 0) {
    const laneH = wall ? 190 : 124;
    const top = y + big + 10;
    const plotH = laneH - big - 16;
    const values = hours.flatMap(h => tempKeys.map(k => (k === 'temp' ? h.temp : k === 'feels' ? h.feelsLike : h.dewPoint)))
      .filter((v): v is number => v !== null);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = Math.max(hi - lo, 6);
    const ty = (f: number) => top + plotH - ((f - lo) / span) * plotH;
    const series = (pick: (h: HourlyForecast) => number | null) => hours.map((h, i) => {
      const v = pick(h);
      return v === null ? null : [x(i), ty(v)] as [number, number];
    });
    const tempPts = series(h => h.temp);
    const firstPt = tempPts.find(p => p !== null);
    const lastPt = [...tempPts].reverse().find(p => p !== null);
    const marked = keyHours(hours.map(h => h.temp), 4, gap);
    lanes.push(
      <g key="temp">
        {!on('temp') && laneCaption('Temperature', y)}
        {on('dew') && <path d={linePath(series(h => h.dewPoint))} fill="none" strokeWidth={wall ? 3 : 2} strokeDasharray="5 5" style={{ stroke: 'var(--chart-dew)' }} />}
        {on('feels') && <path d={linePath(series(h => h.feelsLike))} fill="none" strokeWidth={wall ? 3 : 2} strokeDasharray="2 5" strokeLinecap="round" style={{ stroke: 'var(--ink-2)' }} />}
        {on('temp') && (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" x2={chartWidth} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                {hours.map((h, i) => <stop key={h.time} offset={x(i) / chartWidth} style={{ stopColor: tempColor(h.temp) }} />)}
              </linearGradient>
              <linearGradient id={`${gradientId}-fade`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0.3} />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <mask id={`${gradientId}-mask`}>
                <rect x={0} y={top} width={chartWidth} height={plotH + 6} fill={`url(#${gradientId}-fade)`} />
              </mask>
            </defs>
            {firstPt && lastPt && (
              <path d={`${linePath(tempPts)} L${lastPt[0]},${top + plotH + 6} L${firstPt[0]},${top + plotH + 6} Z`}
                fill={`url(#${gradientId})`} mask={`url(#${gradientId}-mask)`} />
            )}
            <path d={linePath(tempPts)} fill="none" stroke={`url(#${gradientId})`} strokeWidth={wall ? 5 : 3.5} strokeLinecap="round" />
            {hours.map((h, i) => {
              if (h.temp === null || !marked.has(i)) return null;
              const extreme = i === iHi || i === iLo;
              return (
                <g key={h.time}>
                  <circle cx={x(i)} cy={ty(h.temp)} r={extreme ? (wall ? 6 : 4) : (wall ? 4 : 2.5)} style={{ fill: tempColor(h.temp), stroke: 'var(--card)' }} strokeWidth={extreme ? 2 : 0} />
                  <text x={x(i)} y={ty(h.temp) - (extreme ? 10 : 8)} fontSize={extreme ? big : figure} fontWeight={extreme ? 800 : 600} textAnchor="middle"
                    style={{ fill: extreme ? tempColor(h.temp) : 'var(--ink-2)' }}>
                    {fmt(units.temp(h.temp), 0, '°')}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </g>,
    );
    y += laneH + laneGap;
  }

  /** A lane of bars, 0 to `max`, with a figure where the value turns or moves. */
  const barLane = (key: SeriesId, label: string, pick: (h: HourlyForecast) => number | null, max: number, by: number,
    style: (v: number) => { className?: string; fill?: string; opacity?: number }, show: (v: number) => string | null) => {
    const laneH = wall ? 80 : 52;
    const base = y + laneH - 4;
    const plotH = laneH - caption - figure - 8;
    const marked = keyHours(hours.map(pick), by, gap);
    lanes.push(
      <g key={key}>
        {laneCaption(label, y)}
        {hours.map((h, i) => {
          const v = pick(h);
          if (v === null) return null;
          const barH = Math.max(0, Math.min(1, v / max)) * plotH;
          const look = style(v);
          const label = marked.has(i) ? show(v) : null;
          return (
            <g key={h.time}>
              {barH > 0 && (
                <rect x={x(i) - hourPx * 0.36} y={base - barH} width={hourPx * 0.72} height={barH} rx={2}
                  className={look.className} fill={look.className ? 'currentColor' : undefined}
                  style={look.fill ? { fill: look.fill } : undefined} opacity={look.opacity ?? 1} />
              )}
              {label && (
                <text x={x(i)} y={base - barH - 4} fontSize={text} fontWeight={700} textAnchor="middle"
                  className={look.className} fill={look.className ? 'currentColor' : undefined} style={look.className ? undefined : { fill: 'var(--ink-2)' }}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </g>,
    );
    y += laneH + laneGap;
  };
  const most = (pick: (h: HourlyForecast) => number | null) => Math.max(0, ...hours.map(h => pick(h) ?? 0));

  if (on('rain')) {
    if (most(h => h.pop) < 10) emptyLane('rain', 'Rain chance', 'None expected');
    else barLane('rain', 'Rain chance', h => h.pop, 100, 15, v => ({ fill: 'var(--info)', opacity: 0.35 + (v / 100) * 0.6 }), v => (v >= 10 ? `${v.toFixed(0)}%` : null));
  }
  if (on('precip')) {
    const top = most(h => h.precip);
    if (top < 0.01) emptyLane('precip', 'Rain amount', 'None expected');
    else barLane('precip', 'Rain amount', h => h.precip, top, top / 3, () => ({ fill: 'var(--chart-rain)' }), v => (v >= 0.01 ? units.formatRain(v) : null));
  }
  if (on('uv')) {
    if (most(h => h.uv) < 1) emptyLane('uv', 'UV index', 'None');
    else barLane('uv', 'UV index', h => h.uv, 11, 2, v => ({ className: UV_TONE[uvCategory(v)] }), v => (v >= 1 ? v.toFixed(0) : null));
  }

  /** A lane with one line on its own scale, with a figure where the value turns or moves by `by`. */
  const lineLane = (key: SeriesId, label: string, pick: (h: HourlyForecast) => number | null, lo: number, hi: number, by: number, color: string,
    show: (v: number) => string, extra?: (i: number, py: number) => React.ReactNode, second?: (h: HourlyForecast) => number | null) => {
    const laneH = wall ? 96 : 62;
    const top = y + caption + figure + 6;
    const plotH = laneH - caption - figure - 12;
    const ly = (v: number) => top + plotH - ((v - lo) / Math.max(hi - lo, 1)) * plotH;
    const pts = (f: (h: HourlyForecast) => number | null) => hours.map((h, i) => {
      const v = f(h);
      return v === null ? null : [x(i), ly(v)] as [number, number];
    });
    const marked = keyHours(hours.map(pick), by, gap);
    lanes.push(
      <g key={key}>
        {laneCaption(label, y)}
        {second && <path d={linePath(pts(second))} fill="none" strokeWidth={wall ? 2.5 : 1.5} strokeDasharray="4 4" style={{ stroke: color }} opacity={0.7} />}
        <path d={linePath(pts(pick))} fill="none" strokeWidth={wall ? 3.5 : 2.5} style={{ stroke: color }} />
        {hours.map((h, i) => {
          const v = pick(h);
          if (v === null) return null;
          return (
            <g key={h.time}>
              {marked.has(i) && <text x={x(i)} y={ly(v) - 6} fontSize={text} fontWeight={700} textAnchor="middle" style={{ fill: 'var(--ink-2)' }}>{show(v)}</text>}
              {extra?.(i, ly(v))}
            </g>
          );
        })}
      </g>,
    );
    y += laneH + laneGap;
  };

  if (on('humidity')) {
    lineLane('humidity', 'Humidity', h => h.humidity, 0, 100, 12, 'var(--humid-now)', v => `${v.toFixed(0)}%`);
  }
  if (on('wind')) {
    const top = Math.max(10, most(h => Math.max(h.windSpeed ?? 0, h.windGust ?? 0)));
    const arrowEvery = Math.max(2, step * 2);
    lineLane('wind', 'Wind', h => h.windSpeed, 0, top, 4, 'var(--chart-wind)', v => fmt(units.speed(v), 0), (i, py) => {
      const dir = hours[i].windDirection;
      if (dir === null || i % arrowEvery !== 0) return null;
      const s = wall ? 9 : 6;
      // An arrow pointing downwind, sitting just under the line.
      return (
        <path d={`M0,${-s} L${s * 0.7},${s} L0,${s * 0.45} L${-s * 0.7},${s} Z`} transform={`translate(${x(i)},${py + s + 6}) rotate(${dir + 180})`}
          style={{ fill: 'var(--ink-3)' }} />
      );
    }, h => h.windGust);
  }
  if (on('cloud')) {
    // A ribbon of sky, darker the more cloud: overcast and clear read at a glance.
    const ribbon = wall ? 18 : 12;
    const laneH = caption + figure + ribbon + 12;
    const top = y + caption + figure + 8;
    const marked = keyHours(hours.map(h => h.cloudCover), 30, gap);
    lanes.push(
      <g key="cloud">
        {laneCaption('Cloud cover', y)}
        {hours.map((h, i) => h.cloudCover !== null && (
          <g key={h.time}>
            <rect x={i * hourPx} y={top} width={hourPx + 0.5} height={ribbon} style={{ fill: 'var(--ink-3)' }} opacity={0.06 + (h.cloudCover / 100) * 0.5} />
            {marked.has(i) && (
              <text x={x(i)} y={top - 4} fontSize={text} fontWeight={700} textAnchor="middle" style={{ fill: 'var(--ink-2)' }}>{h.cloudCover.toFixed(0)}%</text>
            )}
          </g>
        ))}
      </g>,
    );
    y += laneH + laneGap;
  }

  // Midnight: a rule down the chart with the new day's name.
  const midnights = hours.map((h, i) => (i > 0 && localHour(h.time) === 0 ? i : -1)).filter(i => i > 0);
  const totalH = y + caption + 6;

  // Night: shade whatever lies outside each day's sunrise to sunset.
  const days = forecast.daily.filter(d => d.sunrise !== null && d.sunset !== null)
    .map(d => [xAt(d.sunrise as number), xAt(d.sunset as number)] as [number, number])
    .filter(([rise, set]) => set > 0 && rise < chartWidth);
  const nights: [number, number][] = [];
  const sunMarks: { at: number; label: string }[] = [];
  if (forecast.daily.some(d => d.sunrise !== null)) {
    let cursor = 0;
    for (const [rise, set] of days) {
      if (rise > cursor) nights.push([cursor, Math.min(rise, chartWidth)]);
      cursor = Math.max(cursor, set);
    }
    if (cursor < chartWidth) nights.push([cursor, chartWidth]);
    for (const d of forecast.daily) {
      for (const [unix, word] of [[d.sunrise, 'Sunrise'], [d.sunset, 'Sunset']] as const) {
        if (unix === null) continue;
        const at = xAt(unix);
        if (at > 40 && at < chartWidth - 40) {
          sunMarks.push({ at, label: `${word} ${formatInZone(new Date(unix * 1000), tz, { hour: 'numeric', minute: '2-digit' })}` });
        }
      }
    }
  }

  // Hover: the whole column for one hour, and a card with every figure for it.
  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(hours.length - 1, Math.floor((e.clientX - r.left) / hourPx))));
  };
  const hh = hover !== null && hover < hours.length ? hours[hover] : null;
  const rows: [string, string][] = hh ? [
    ['Temperature', fmt(units.temp(hh.temp), 0, '°')],
    ['Feels like', fmt(units.temp(hh.feelsLike), 0, '°')],
    ['Dew point', fmt(units.temp(hh.dewPoint), 0, '°')],
    ['Rain chance', hh.pop === null ? '—' : `${hh.pop.toFixed(0)}%`],
    ['Rain amount', hh.precip === null ? '—' : hh.precip < 0.005 ? 'None' : `${units.formatRain(hh.precip)} ${units.rainUnit}`],
    ['Humidity', hh.humidity === null ? '—' : `${hh.humidity.toFixed(0)}%`],
    ['Wind', hh.windSpeed === null ? '—' : `${fmt(units.speed(hh.windSpeed), 0)}${hh.windGust !== null ? `, gusts ${fmt(units.speed(hh.windGust), 0)}` : ''} ${units.speedUnit}${hh.windDirection !== null ? ` ${windCardinal(hh.windDirection)}` : ''}`],
    ['UV index', hh.uv === null ? '—' : hh.uv.toFixed(0)],
    ['Cloud cover', hh.cloudCover === null ? '—' : `${hh.cloudCover.toFixed(0)}%`],
  ].filter((row): row is [string, string] => row[1] !== '—') : [];

  return (
    <div className="tile p-5">
      <TileHeader icon={Clock3} label="Next 24 Hours" />

      {glances.length > 0 && (
        <div className={`${wall ? 'mt-2 gap-x-12' : 'mt-1 gap-x-8'} flex flex-wrap gap-y-3`}>
          {glances.map(g => (
            <div key={g.key} className="min-w-0">
              <div className={`${wall ? 'text-base' : 'text-xs'} font-bold uppercase tracking-[0.12em] text-ink-3`}>{g.caption}</div>
              <div className={`${wall ? 'text-6xl' : 'text-3xl'} font-extrabold leading-tight ${g.className ?? (g.tone ? '' : 'text-ink')}`} style={g.tone ? { color: g.tone } : undefined}>
                {g.value}
              </div>
              <div className={`${wall ? 'text-xl' : 'text-sm'} text-ink-3`}>{g.sub}</div>
            </div>
          ))}
        </div>
      )}

      {!wall && available.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Show on chart">
          {available.map(s => (
            <button
              key={s.id}
              type="button"
              aria-pressed={on(s.id)}
              onClick={() => toggle(s.id)}
              className={`px-2.5 py-1 rounded-full border text-xs font-semibold transition ${
                on(s.id) ? 'bg-accent-soft border-accent-line text-accent-text' : 'border-line-soft text-ink-3 hover:text-ink hover:border-line'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div ref={box} className="mt-4 overflow-x-auto overscroll-x-contain pb-1">
        {width > 0 && (
          <div className="relative" style={{ width: chartWidth }}>
            <svg width={chartWidth} height={totalH} role="img" aria-label="Hourly forecast for the next 24 hours" className="block"
              onPointerMove={wall ? undefined : onPointer} onPointerDown={wall ? undefined : onPointer} onPointerLeave={() => setHover(null)}>
              {nights.map(([from, to]) => (
                <rect key={from} x={from} y={headH - 4} width={to - from} height={totalH - headH + 4} style={{ fill: 'var(--alt-soft)' }} opacity={0.7} />
              ))}
              {hover !== null && <rect x={hover * hourPx} y={0} width={hourPx} height={totalH} style={{ fill: 'var(--fill-strong)' }} />}
              {midnights.map(i => (
                <g key={i}>
                  <line x1={i * hourPx} x2={i * hourPx} y1={0} y2={totalH} strokeDasharray="3 4" style={{ stroke: 'var(--line-strong)' }} />
                  <text x={i * hourPx + 4} y={totalH - 4} fontSize={caption} fontWeight={700} style={{ fill: 'var(--ink-3)' }}>
                    {formatInZone(new Date(hours[i].time * 1000), tz, { weekday: 'short' }).toUpperCase()}
                  </text>
                </g>
              ))}
              {sunMarks.map(m => (
                <text key={m.label} x={m.at} y={totalH - 4} fontSize={caption} fontWeight={600} textAnchor="middle" style={{ fill: 'var(--ink-3)' }}>
                  {m.label}
                </text>
              ))}
              {lanes}
            </svg>
            {hh && rows.length > 0 && (
              <div
                className="absolute top-12 pointer-events-none rounded-lg border px-3 py-2 text-xs shadow-lg whitespace-nowrap"
                style={{
                  background: 'var(--chart-tip-bg)', borderColor: 'var(--chart-tip-line)',
                  ...(x(hover as number) > chartWidth - 220 ? { right: chartWidth - hover! * hourPx + 8 } : { left: (hover! + 1) * hourPx + 8 }),
                }}
              >
                <div className="font-bold text-ink mb-1">
                  {formatInZone(new Date(hh.time * 1000), tz, { weekday: 'short', hour: 'numeric' })}
                  {hh.weatherCode !== null && <span className="font-medium text-ink-3"> · {weatherLabel(hh.weatherCode)}</span>}
                </div>
                <table>
                  <tbody>
                    {rows.map(([label, value]) => (
                      <tr key={label}>
                        <td className="pr-4 text-ink-3">{label}</td>
                        <td className="text-right font-semibold text-ink tabular-nums">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {!wall && <p className="mt-2 text-xs text-ink-4">Forecast by {forecastCredit(forecast)}</p>}
    </div>
  );
};
