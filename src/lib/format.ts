/** Readings older than this are shown as stale. The poller runs every 5 minutes. */
export const STALE_AFTER_MINUTES = 15;

export function fmt(value: number | null | undefined, digits = 0, suffix = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}${suffix}`;
}

/** Formats a date in the station's timezone, falling back to the viewer's if it is unknown. */
export function formatInZone(date: Date, timeZone: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString([], { ...options, timeZone: timeZone ?? undefined });
  } catch {
    return date.toLocaleString([], options);
  }
}

/** A clock face split up, so the hour and minute can be styled apart from the meridiem and zone. */
export function clockParts(date: Date, timeZone: string | null | undefined) {
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat([], { ...options, timeZone: timeZone ?? undefined }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat([], options).formatToParts(date);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return {
    hourMinute: `${value('hour')}:${value('minute')}`,
    /** Empty in locales that use a 24-hour clock. */
    meridiem: value('dayPeriod'),
    zone: value('timeZoneName'),
  };
}

export function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / 60000;
}

export function timeAgo(iso: string | null | undefined): string {
  const mins = minutesSince(iso);
  if (mins === null) return 'never';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} d ago`;
}

export function windCardinal(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}

/**
 * The CSS rotation that points lucide's Navigation arrow downwind for a wind
 * blowing from `deg`, the way the wind tile's vane points. The icon is drawn
 * heading northeast, so the turn starts 45° short of where it would for an
 * arrow drawn pointing north.
 */
export function windArrowRotation(deg: number): string {
  return `rotate(${deg + 180 - 45}deg)`;
}

export function stationPath(slug: string | null): string {
  return `${import.meta.env.BASE_URL}${slug ?? ''}`;
}

/**
 * Temperature colour scale: cold at one end, hot at the other, in nine steps.
 * Returns the theme token rather than a colour, so the ramp follows the theme —
 * neon on Midnight Glass, fired earth on Desert Terracotta. Usable anywhere a
 * CSS value is accepted, which means inline styles rather than SVG attributes.
 */
export function tempColor(f: number | null | undefined): string {
  if (f === null || f === undefined || Number.isNaN(f)) return 'var(--temp-none)';
  if (f <= 15) return 'var(--temp-1)';
  if (f <= 32) return 'var(--temp-2)';
  if (f <= 45) return 'var(--temp-3)';
  if (f <= 58) return 'var(--temp-4)';
  if (f <= 70) return 'var(--temp-5)';
  if (f <= 80) return 'var(--temp-6)';
  if (f <= 88) return 'var(--temp-7)';
  if (f <= 96) return 'var(--temp-8)';
  return 'var(--temp-9)';
}

export function clockAt(iso: string | null | undefined, timezone: string | null): string {
  if (!iso) return '—';
  return formatInZone(new Date(iso), timezone, { hour: 'numeric', minute: '2-digit' });
}
