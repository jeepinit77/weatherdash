import React, { Suspense, lazy, useContext, useEffect, useState } from 'react';
import type { PlotSeries } from './plotSeries';
import { DetailSection } from '../ui/DetailModal';
import { StationContext } from '../../lib/stationContext';
import { api } from '../../services/api';
import type { HistoryPoint, HistoryRange } from '../../types/weather';

// Recharts is the heaviest thing on the page; a popup only pays for it once opened.
const HistoryPlot = lazy(() => import('./HistoryPlot'));

const RANGE_LABEL: Record<HistoryRange, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '1y': '1 year' };

interface DetailHistoryProps {
  /** What to draw; a function where the daily ranges draw different fields from the raw ones. */
  series: PlotSeries[] | ((range: HistoryRange) => PlotSeries[]);
  /** The ranges on offer, first shown first. */
  ranges?: HistoryRange[];
}

/** A popup's chart of the station's own recent readings, fetched when the popup opens. */
export const DetailHistory: React.FC<DetailHistoryProps> = ({ series: seriesFor, ranges = ['24h', '7d'] }) => {
  const { slug, timezone } = useContext(StationContext);
  const [range, setRange] = useState<HistoryRange>(ranges[0]);
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const series = typeof seriesFor === 'function' ? seriesFor(range) : seriesFor;

  useEffect(() => {
    let live = true;
    api.history(slug, range)
      .then(p => { if (live) setPoints(p); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slug, range]);

  const message = (text: string, busy = false) => (
    <div className={`h-full rounded-xl flex items-center justify-center text-sm text-ink-3 ${busy ? 'bg-well animate-pulse' : ''}`}>{text}</div>
  );

  return (
    <DetailSection title={`Last ${RANGE_LABEL[range]}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {series.map(s => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span
                className="w-4 border-t-2"
                style={{ borderColor: `var(${s.token})`, borderTopStyle: s.style === 'dashed' ? 'dashed' : 'solid' }}
                aria-hidden="true"
              />
              {s.label}
            </span>
          ))}
        </div>
        {ranges.length > 1 && (
          <div className="flex bg-well rounded-lg p-1 border border-line-soft text-xs" role="group" aria-label="Time range">
            {ranges.map(r => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => {
                  if (r === range) return;
                  setRange(r);
                  setPoints(null);
                  setFailed(false);
                }}
                className={`px-2.5 py-1 rounded-md font-medium transition ${range === r ? 'bg-accent-strong text-accent-ink shadow' : 'text-ink-3 hover:text-ink'}`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="h-[clamp(9rem,26vh,16rem)]">
        {failed
          ? message("Couldn't load history.")
          : points === null
            ? message('Loading…', true)
            : points.length === 0
              ? message('No history recorded for this period yet.')
              : (
                <Suspense fallback={message('Loading…', true)}>
                  <HistoryPlot points={points} series={series} range={range} timezone={timezone} />
                </Suspense>
              )}
      </div>
    </DetailSection>
  );
};
