import { formatInZone } from './format';
import type { DailyForecast } from '../types/weather';

const DAY_SECONDS = 86400;

/** A forecast day once both of its sun times are known. */
interface SunDay {
  sunrise: number;
  sunset: number;
}

/** Where the day or night currently stands, and the two times to put on a tile. */
export interface SunPhase {
  /** True between sunrise and sunset. */
  isDay: boolean;
  /** How far the current stretch of daylight or darkness has run, 0-100. */
  progress: number;
  /** The sunrise to show: today's while the sun is up, the coming one once it has set. */
  sunrise: number;
  /** The sunset to show. */
  sunset: number;
  /** Set when the sunrise above falls on a later date than now, so it can be labelled. */
  sunriseIsNextDay: boolean;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const through = (now: number, start: number, end: number) => clamp(((now - start) / (end - start)) * 100);

const sameDate = (a: number, b: number, timezone: string | null) => {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
  return formatInZone(new Date(a * 1000), timezone, options) === formatInZone(new Date(b * 1000), timezone, options);
};

/**
 * Reads the run of forecast days as one continuous cycle of daylight and
 * darkness, so a tile can fill a bar through the night as well as through the
 * day and name the sunrise that is actually coming rather than the one that has
 * already been and gone.
 *
 * Returns null when no day carries a usable pair of sun times.
 */
export function sunPhase(days: readonly DailyForecast[], nowUnix: number, timezone: string | null): SunPhase | null {
  const sun: SunDay[] = [];
  for (const day of days) {
    if (day.sunrise !== null && day.sunset !== null && day.sunset > day.sunrise) {
      sun.push({ sunrise: day.sunrise, sunset: day.sunset });
    }
  }
  if (sun.length === 0) return null;

  const phase = (isDay: boolean, progress: number, sunrise: number, sunset: number): SunPhase => ({
    isDay,
    progress,
    sunrise,
    sunset,
    sunriseIsNextDay: !isDay && !sameDate(nowUnix, sunrise, timezone),
  });

  // Daylight: between a sunrise and the sunset that closes it.
  const daylight = sun.find(d => nowUnix >= d.sunrise && nowUnix <= d.sunset);
  if (daylight) {
    return phase(true, through(nowUnix, daylight.sunrise, daylight.sunset), daylight.sunrise, daylight.sunset);
  }

  // Night, with both ends in hand: from a sunset to the next day's sunrise.
  for (let i = 0; i < sun.length - 1; i++) {
    if (nowUnix > sun[i].sunset && nowUnix < sun[i + 1].sunrise) {
      return phase(false, through(nowUnix, sun[i].sunset, sun[i + 1].sunrise), sun[i + 1].sunrise, sun[i].sunset);
    }
  }

  // The small hours, before the first sunrise the forecast covers. The sunset
  // that began this night fell the day before the forecast starts, so the
  // night is measured from the first day's sunset taken back twenty-four
  // hours. Sun times shift by a minute or two a day, and this only ever places
  // the fill — both times on show are the forecast's own.
  const first = sun[0];
  if (nowUnix < first.sunrise) {
    return phase(false, through(nowUnix, first.sunset - DAY_SECONDS, first.sunrise), first.sunrise, first.sunset);
  }

  // Past the last sunset the forecast reaches, which means it has gone stale.
  const last = sun[sun.length - 1];
  return phase(false, 100, last.sunrise, last.sunset);
}
