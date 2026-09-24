import { tempColor } from '../../lib/format';
import type { DailyForecast } from '../../types/weather';

/**
 * Below this chance of rain the compact forecasts leave the figure out. A
 * column of 1% and 2% is noise on a phone; the faint rain wash still shows
 * the smaller chances to anyone looking for them.
 */
export const RAIN_CHANCE_FLOOR = 10;

/** The coldest and warmest temperatures across a run of days, in °F, that every day's bar is drawn against. */
export interface TempScale {
  min: number;
  max: number;
}

/**
 * One scale for the whole week, so a bar's height and position compare
 * directly with its neighbours'. The station's current reading is included so
 * its marker never falls off the end. Null when no day carries a temperature.
 */
export function weekScale(days: readonly DailyForecast[], nowTemp: number | null): TempScale | null {
  const temps = days
    .flatMap(d => [d.tempMin, d.tempMax])
    .concat(nowTemp)
    .filter((t): t is number => t !== null);
  if (temps.length === 0) return null;
  return { min: Math.min(...temps), max: Math.max(...temps) };
}

/** Where a temperature sits on the scale, from 0 at the coldest to 1 at the warmest. */
export function scaleFraction(f: number, scale: TempScale): number {
  const span = scale.max - scale.min;
  return span > 0 ? (f - scale.min) / span : 0.5;
}

/**
 * A day's bar painted with the dashboard's own temperature ramp, sampled at
 * the actual temperatures it spans: a mild day is one colour, a day that runs
 * from a cold dawn to a hot afternoon crosses several. The ramp is theme
 * tokens, so the bars follow the theme like the temperature tile does.
 */
export function tempGradient(low: number, high: number, direction: 'to top' | 'to right'): string {
  const steps = 4;
  const stops = Array.from({ length: steps + 1 }, (_, i) => `${tempColor(low + ((high - low) * i) / steps)} ${(i / steps) * 100}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/**
 * The part of a day's range there is a figure for. The National Weather
 * Service drops today's high once the afternoon has passed, so a day can carry
 * a low alone; it is drawn as a single point rather than guessed at.
 */
export function dayRange(day: DailyForecast): { low: number; high: number } | null {
  const low = day.tempMin ?? day.tempMax;
  const high = day.tempMax ?? day.tempMin;
  return low === null || high === null ? null : { low, high };
}
