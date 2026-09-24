import React, { useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { styleFor, whenText } from './alertText';
import type { WeatherAlert } from '../../types/weather';

/** How fast the ticker travels, in pixels a second. Slow enough to read in passing. */
const TICKER_SPEED = 55;

/** "Wind Advisory until 7:00 PM" — the whole alert in one line, for a wall. */
function tickerText(alert: WeatherAlert, timezone: string | null, now: Date): string {
  const event = alert.event ?? 'Weather alert';
  const when = whenText(alert, timezone, now);
  return when === null ? event : `${event} ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}

interface TickerRunProps {
  alerts: WeatherAlert[];
  timezone: string | null;
  /** A travelling ticker needs a separator after the last item too, so the loop reads evenly. */
  trailing: boolean;
}

const TickerRun: React.FC<TickerRunProps> = ({ alerts, timezone, trailing }) => {
  const now = new Date();
  return (
    <>
      {alerts.map((alert, i) => (
        <React.Fragment key={alert.id}>
          <span className={`${styleFor(alert.severity).accent} whitespace-nowrap`}>
            {tickerText(alert, timezone, now)}
          </span>
          {(trailing || i < alerts.length - 1) && <span className="mx-6 text-ink-4">—</span>}
        </React.Fragment>
      ))}
    </>
  );
};

interface AlertsTickerProps {
  alerts: WeatherAlert[];
  timezone: string | null;
  onOpen: () => void;
  onDismissAll: () => void;
}

/**
 * Full screen shows the headlines only, in one bar the size of the clock, and
 * nothing ever expands. Nobody is standing at a wall dashboard to close a card
 * that has covered the weather, and the forecaster's small print cannot be read
 * from across a room anyway.
 *
 * Whoever does walk up reads it by pressing the bar itself, which opens the full
 * text. That has to be the bar, not the alerts count: the count only appears
 * once something has been dismissed, so without this there would be no way to
 * read a warning short of clearing it first.
 *
 * Headlines that do not fit travel instead of wrapping, so any number of alerts
 * costs the same one bar.
 */
export const AlertsTicker: React.FC<AlertsTickerProps> = ({ alerts, timezone, onOpen, onDismissAll }) => {
  const viewport = useRef<HTMLDivElement>(null);
  const run = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (!viewport.current || !run.current) return;
      // Always the width of one run: the second copy lives outside this element,
      // so measuring cannot feed back into the decision to show it.
      const width = run.current.scrollWidth;
      setSeconds(width > viewport.current.clientWidth ? width / TICKER_SPEED : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [alerts, timezone]);

  if (alerts.length === 0) return null;
  const travelling = seconds > 0;

  return (
    <div className="tile flex items-center gap-2 px-5 py-3" role="region" aria-label="Active weather alerts">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Read ${alerts.length} active ${alerts.length === 1 ? 'alert' : 'alerts'}`}
        className="flex-1 min-w-0 flex items-center gap-4 text-left rounded-lg hover:bg-fill-soft transition"
      >
      {/* The total stays put while the headlines travel past it, so the count
          is readable at any moment rather than only when it scrolls by. */}
      <div className={`shrink-0 flex items-center gap-1.5 sm:gap-2 pr-3 sm:pr-4 border-r border-line ${styleFor(alerts[0].severity).accent}`}>
        <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" />
        <span className="text-2xl sm:text-4xl md:text-5xl font-black leading-none tabular-nums">{alerts.length}</span>
      </div>
      <div
        ref={viewport}
        className={`flex-1 overflow-hidden flex ${travelling ? '' : 'justify-center'}`}
      >
        <div
          className="flex w-max items-center text-2xl sm:text-4xl md:text-5xl font-black leading-none tabular-nums"
          style={travelling ? { animation: `alerts-ticker ${seconds}s linear infinite` } : undefined}
        >
          <div ref={run} className="flex items-center shrink-0">
            <TickerRun alerts={alerts} timezone={timezone} trailing={travelling} />
          </div>
          {travelling && (
            <div className="flex items-center shrink-0" aria-hidden="true">
              <TickerRun alerts={alerts} timezone={timezone} trailing />
            </div>
          )}
        </div>
      </div>
      </button>
      <button
        type="button"
        onClick={onDismissAll}
        title="Dismiss these alerts"
        aria-label="Dismiss these alerts"
        className="shrink-0 p-1.5 rounded-md text-ink-4 hover:text-ink hover:bg-fill transition"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
};
