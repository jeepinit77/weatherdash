import React, { useMemo } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { PlotSeries } from './plotSeries';
import { formatInZone } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';
import type { HistoryPoint, HistoryRange } from '../../types/weather';

interface HistoryPlotProps {
  points: HistoryPoint[];
  series: PlotSeries[];
  range: HistoryRange;
  timezone: string | null;
}

const FRAME_TOKENS = { grid: '--chart-grid', axis: '--chart-axis', tipBg: '--chart-tip-bg', tipLine: '--chart-tip-line' } as const;

const isDaily = (range: HistoryRange) => range === '30d' || range === '1y';

/** A popup's chart: any mix of lines, areas and bars over one time axis. */
const HistoryPlot: React.FC<HistoryPlotProps> = ({ points, series, range, timezone }) => {
  const frame = useThemeColors(FRAME_TOKENS);
  // Recharts writes colours as SVG attributes, where var(--token) paints nothing.
  const colors = useThemeColors(Object.fromEntries(series.map((s, i) => [String(i), s.token])));
  const daily = isDaily(range);

  const rows = useMemo(
    () => points.map(p => {
      const row: Record<string, string | number | null> = { time: p.time };
      series.forEach((s, i) => {
        const raw = p[s.key];
        const value = typeof raw === 'number' ? raw : null;
        row[`s${i}`] = s.convert ? s.convert(value) : value;
      });
      return row;
    }),
    [points, series],
  );

  const when = (time: string, long: boolean) => {
    // Daily points are local dates; parse at noon so no timezone moves them a day.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(time) ? new Date(`${time}T12:00:00`) : new Date(time);
    if (daily) return formatInZone(date, null, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
    if (range === '7d') return formatInZone(date, timezone, long ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { weekday: 'short' });
    return formatInZone(date, timezone, long ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' });
  };

  const tooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border px-3 py-2 text-xs shadow-xl" style={{ background: frame.tipBg, borderColor: frame.tipLine }}>
        <div className="font-semibold text-ink-2 mb-1">{when(String(label), true)}</div>
        {payload.map(entry => {
          const s = series[Number(String(entry.dataKey).slice(1))];
          const v = entry.value;
          return (
            <div key={String(entry.dataKey)} className="flex items-center gap-2 text-ink">
              <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
              {s.label}: <span className="font-bold">{typeof v === 'number' ? `${v.toFixed(s.digits ?? 0)}${s.unit ?? ''}` : '—'}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const axis = { stroke: frame.axis, fontSize: 11, tickLine: false };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={frame.grid} />
        <XAxis dataKey="time" {...axis} tickFormatter={t => when(String(t), false)} minTickGap={28} />
        <YAxis {...axis} width={44} domain={['auto', 'auto']} />
        <Tooltip content={tooltip} />
        {series.map((s, i) => {
          const color = colors[String(i)];
          const key = `s${i}`;
          switch (s.style ?? 'line') {
            case 'bar':
              return <Bar key={key} dataKey={key} fill={color} radius={[4, 4, 0, 0]} />;
            case 'area':
              return <Area key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.15} />;
            case 'step':
              return <Area key={key} type="stepAfter" dataKey={key} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.2} />;
            case 'dashed':
              return <Line key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />;
            default:
              return <Line key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2.5} dot={false} />;
          }
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export default HistoryPlot;
