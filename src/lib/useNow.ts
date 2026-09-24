import { useMemo, useSyncExternalStore } from 'react';

/**
 * One ticking clock per step size, shared by every component that asks for it,
 * so a dashboard with three clocks on it runs one timer rather than three and
 * they all turn over on the same instant.
 *
 * Each tick is aligned to a whole multiple of the step (the top of the second,
 * the top of the minute), so a clock never shows a stale second for most of a
 * second after it changed.
 */
interface Ticker {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

const tickers = new Map<number, Ticker>();

function createTicker(stepMs: number): Ticker {
  let now = Date.now();
  let timer: number | undefined;
  const listeners = new Set<() => void>();

  const schedule = () => {
    timer = window.setTimeout(() => {
      now = Date.now();
      listeners.forEach(listener => listener());
      schedule();
    }, stepMs - (Date.now() % stepMs));
  };

  return {
    subscribe: listener => {
      listeners.add(listener);
      if (timer === undefined) {
        // Idle until now, so the stored time may be long out of date.
        now = Date.now();
        schedule();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => now,
  };
}

/**
 * The current time, re-rendering the caller once per `stepMs` (a second by
 * default). Pass a longer step for things that only change by the minute, such
 * as "3 min ago" or which forecast day is today.
 */
export function useNow(stepMs = 1000): Date {
  let ticker = tickers.get(stepMs);
  if (!ticker) {
    ticker = createTicker(stepMs);
    tickers.set(stepMs, ticker);
  }
  const now = useSyncExternalStore(ticker.subscribe, ticker.getSnapshot);
  return useMemo(() => new Date(now), [now]);
}
