/**
 * Wording and styling shared by every way an alert is shown: the windowed
 * bars, the full-screen ticker, the count button and the reading panel.
 */
import { formatInZone } from '../../lib/format';
import type { WeatherAlert } from '../../types/weather';

export interface SeverityStyle {
  /** Colours the warning icon, the "what to do" heading and the ticker headline. */
  accent: string;
  /** Themed badge class; the background, border and text are set together in the stylesheet. */
  badge: string;
}

/**
 * Severity sets the temperature of the card: an Extreme warning should read
 * differently at a glance from a Small Craft Advisory.
 */
const SEVERITY_STYLES: Record<string, SeverityStyle> = {
  Extreme: { accent: 'text-danger-text', badge: 'badge-extreme' },
  Severe: { accent: 'text-severe', badge: 'badge-severe' },
  Moderate: { accent: 'text-warn-text', badge: 'badge-moderate' },
  Minor: { accent: 'text-cool', badge: 'badge-minor' },
};

const UNKNOWN_STYLE: SeverityStyle = {
  accent: 'text-ink-2',
  badge: 'badge-unknown',
};

/**
 * The stripe down the edge carries urgency, which severity does not imply:
 * roughly as many Severe alerts are Immediate as are still in the Future, and
 * those two want reading very differently. The stripe fades inward so a wide
 * band of colour does not fight the card's own gradient.
 *
 * Expected is the ordinary case by a wide margin, so it stays quiet and the
 * rare Immediate reads as the alarm it is. The word itself is on the card for
 * anyone who cannot use the colour.
 */
const URGENCY_STRIPES: Record<string, string> = {
  Immediate: 'stripe-immediate',
  Expected: 'stripe-expected',
  Future: 'stripe-future',
  Past: 'stripe-past',
};

const UNKNOWN_STRIPE = 'stripe-past';

export function stripeFor(urgency: string | null): string {
  return (urgency !== null && URGENCY_STRIPES[urgency]) || UNKNOWN_STRIPE;
}

/**
 * How long a card that opened itself stays open. Long enough to be read, short
 * enough that a dashboard nobody is standing at returns to the weather on its
 * own. A card the viewer opened is theirs and is never closed from under them.
 */
export const AUTO_COLLAPSE_MS = 20_000;

/** Past this far ahead a weekday name no longer picks out a single day. */
const WEEKDAY_HORIZON_MS = 6 * 24 * 60 * 60 * 1000;

export function styleFor(severity: string | null): SeverityStyle {
  return (severity !== null && SEVERITY_STYLES[severity]) || UNKNOWN_STYLE;
}

/**
 * Which alerts open unasked. Severity alone is a poor guide: a Severe river
 * flood warning can run for a week, while what earns the whole card is weather
 * already happening. So it is the immediate ones, plus anything Extreme.
 */
export function expandOnSight(alert: WeatherAlert): boolean {
  return alert.severity === 'Extreme' || alert.urgency === 'Immediate';
}

function parse(iso: string | null): Date | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time);
}

function sameDay(a: Date, b: Date, timezone: string | null): boolean {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
  return formatInZone(a, timezone, options) === formatInZone(b, timezone, options);
}

/** A time of day, named by weekday or by date when it is not today's. */
function timeText(date: Date, timezone: string | null, now: Date): string {
  const time = formatInZone(date, timezone, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(date, now, timezone)) return time;
  const day = date.getTime() - now.getTime() > WEEKDAY_HORIZON_MS
    ? formatInZone(date, timezone, { month: 'short', day: 'numeric' })
    : formatInZone(date, timezone, { weekday: 'short' });
  return `${day} ${time}`;
}

/**
 * When the alert applies, in the station's own timezone. One that has already
 * begun reads as running out rather than as having started in the past.
 */
export function whenText(alert: WeatherAlert, timezone: string | null, now: Date): string | null {
  const onset = parse(alert.onset);
  const expires = parse(alert.expires);
  const pending = onset !== null && onset > now;

  if (pending && expires) return `${timeText(onset, timezone, now)} until ${timeText(expires, timezone, now)}`;
  if (pending) return `From ${timeText(onset, timezone, now)}`;
  if (expires) return `Until ${timeText(expires, timezone, now)}`;
  return null;
}

/**
 * The weather service hard-wraps its prose at a fixed column, which reads badly
 * at any other width. Rejoin each wrapped line into its paragraph, keeping the
 * blank-line breaks and the "*" and "-" bullets the forecaster wrote.
 */
export function paragraphs(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let current = '';
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (line === '') continue;
      if (current !== '' && !/^[*-]\s/.test(line)) {
        current += ` ${line}`;
      } else {
        if (current !== '') out.push(current);
        current = line;
      }
    }
    if (current !== '') out.push(current);
  }
  return out;
}
