import { getMoonIllumination, getMoonPosition, getMoonTimes } from 'suncalc';
import { formatInZone } from './format';

const DAY_S = 86400;
/** One day as a share of the lunar month, the window within which a quarter keeps its name. */
const NAMED_PHASE_WINDOW = 1 / 29.53;

export type PhaseKey = 'new' | 'first' | 'full' | 'last';

export const PHASE_TARGETS: { key: PhaseKey; at: number; label: string }[] = [
  { key: 'new', at: 0, label: 'New moon' },
  { key: 'first', at: 0.25, label: 'First quarter' },
  { key: 'full', at: 0.5, label: 'Full moon' },
  { key: 'last', at: 0.75, label: 'Last quarter' },
];

/** The phase's everyday name. `phase` runs 0 → 1 from new moon to new moon. */
export function phaseName(phase: number): string {
  const near = (target: number) => Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target)) < NAMED_PHASE_WINDOW;
  if (near(0)) return 'New moon';
  if (near(0.25)) return 'First quarter';
  if (near(0.5)) return 'Full moon';
  if (near(0.75)) return 'Last quarter';
  if (phase < 0.25) return 'Waxing crescent';
  if (phase < 0.5) return 'Waxing gibbous';
  if (phase < 0.75) return 'Waning gibbous';
  return 'Waning crescent';
}

const phaseAt = (unix: number) => getMoonIllumination(new Date(unix * 1000)).phase;

/** How far `phase` has to go forward to reach `target`, in the 0 → 1 cycle. */
const ahead = (phase: number, target: number) => (target - phase + 1) % 1;

/** The next moment the phase reaches `target`, after `fromUnix`, to within a minute. */
function nextPhase(target: number, fromUnix: number): number {
  const step = DAY_S / 4;
  let before = fromUnix;
  let gap = ahead(phaseAt(before), target);
  for (let i = 0; i < 31 * 4; i++) {
    const after = before + step;
    const gapAfter = ahead(phaseAt(after), target);
    // The gap shrinks steadily until the target passes, then jumps back near 1.
    if (gapAfter > gap) {
      let lo = before;
      let hi = after;
      while (hi - lo > 60) {
        const mid = (lo + hi) / 2;
        if (ahead(phaseAt(mid), target) > ahead(phaseAt(lo), target)) hi = mid;
        else lo = mid;
      }
      return Math.round(hi);
    }
    before = after;
    gap = gapAfter;
  }
  return fromUnix + 29.53 * DAY_S * target;
}

/** The next new moon, first quarter, full moon and last quarter, soonest first. */
export function upcomingPhases(fromUnix: number): { key: PhaseKey; label: string; time: number }[] {
  return PHASE_TARGETS
    .map(p => ({ key: p.key, label: p.label, time: nextPhase(p.at, fromUnix) }))
    .sort((a, b) => a.time - b.time);
}

/** Unix seconds of local midnight, today, in the station's timezone. */
function localMidnight(nowUnix: number, timezone: string | null): number {
  const [h, m, s] = formatInZone(new Date(nowUnix * 1000), timezone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .split(':')
    .map(Number);
  return nowUnix - (h * 3600 + m * 60 + s);
}

/**
 * The moon's rise and set during the station's local day. The library works in
 * UTC days, so the days either side are asked too and only the events that
 * fall inside the local day are kept. Either can be missing: about once a
 * month the moon does not rise, or does not set, on a given date.
 */
export function moonTimesToday(nowUnix: number, timezone: string | null, lat: number, lon: number): { rise: number | null; set: number | null } {
  const start = localMidnight(nowUnix, timezone);
  const end = start + DAY_S;
  const events = [start - DAY_S, start, end].map(t => getMoonTimes(new Date(t * 1000), lat, lon));
  const inDay = (d: Date | undefined) => (d && d.getTime() / 1000 >= start && d.getTime() / 1000 < end ? d.getTime() / 1000 : null);
  const first = (dates: (Date | undefined)[]) => dates.map(inDay).find(t => t !== null) ?? null;
  return { rise: first(events.map(e => e.rise)), set: first(events.map(e => e.set)) };
}

export function moonNow(nowUnix: number, lat: number | null, lon: number | null) {
  const date = new Date(nowUnix * 1000);
  const light = getMoonIllumination(date);
  const position = lat !== null && lon !== null ? getMoonPosition(date, lat, lon) : null;
  return { ...light, position };
}
