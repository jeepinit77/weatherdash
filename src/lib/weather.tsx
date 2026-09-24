import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import type { DailyForecast, ForecastData, ForecastSource } from '../types/weather';

/** WMO weather interpretation codes, as returned by Open-Meteo. */
export function weatherIcon(code: number | null, className: string) {
  if (code === null) return <Cloud className={`${className} text-ink-4`} />;
  if (code === 0) return <Sun className={`${className} text-sun`} />;
  if (code <= 2) return <CloudSun className={`${className} text-cool`} />;
  if (code === 3) return <Cloud className={`${className} text-ink-2`} />;
  if (code === 45 || code === 48) return <CloudFog className={`${className} text-ink-2`} />;
  if (code <= 57) return <CloudDrizzle className={`${className} text-info-text`} />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow className={`${className} text-snow`} />;
  if (code >= 95) return <CloudLightning className={`${className} text-warn-text`} />;
  if (code >= 61) return <CloudRain className={`${className} text-info-text`} />;
  return <Cloud className={`${className} text-ink-2`} />;
}

export function weatherLabel(code: number | null): string {
  if (code === null) return '—';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Thunderstorm';
  if (code >= 61) return 'Rain';
  return 'Cloudy';
}

/** Who to credit for a forecast. */
export const FORECAST_SOURCE_NAME: Record<ForecastSource, string> = {
  'nws': 'US National Weather Service',
  'open-meteo': 'Open-Meteo',
};

/** "US National Weather Service", plus Open-Meteo when it filled anything in. */
export function forecastCredit(forecast: ForecastData): string {
  const main = FORECAST_SOURCE_NAME[forecast.source];
  return forecast.supplemented.length > 0 ? `${main}, with gaps filled by Open-Meteo` : main;
}

export type UvCategory = 'low' | 'moderate' | 'high' | 'very high' | 'extreme';

/** EPA/WHO UV index bands. */
export function uvCategory(uv: number): UvCategory {
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very high';
  return 'extreme';
}

/** The text colour for each UV band, from the theme's role colours. */
export const UV_TONE: Record<UvCategory, string> = {
  'low': 'text-good-text',
  'moderate': 'text-warn-text',
  'high': 'text-severe',
  'very high': 'text-danger-text',
  'extreme': 'text-alt-text',
};

/** A calendar date in the given timezone as YYYY-MM-DD, which sorts and compares as text. */
function dateKey(date: Date, timeZone: string | null): string {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: timeZone ?? undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', options).format(date);
  }
}

function nextDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export interface UpcomingDay {
  day: DailyForecast;
  /** Set for the two days that read better by name than by weekday. */
  relative: 'Today' | 'Tomorrow' | null;
}

/**
 * The forecast days from today on, each told apart from today by its own date
 * in the forecast's timezone rather than by its place in the list: a forecast
 * fetched just before midnight still starts with a day that has since become
 * yesterday, and that day is dropped rather than called "Today".
 */
export function upcomingDays(days: readonly DailyForecast[], timezone: string | null, now: Date): UpcomingDay[] {
  const today = dateKey(now, timezone);
  const tomorrow = nextDateKey(today);
  return days
    .map(day => ({ day, key: dateKey(new Date(day.time * 1000), timezone) }))
    .filter(({ key }) => key >= today)
    .map(({ day, key }) => ({ day, relative: key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : null }));
}
