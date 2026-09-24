import type { NowcastStep } from '../types/weather';

/** Below this much in a 15-minute step (about 0.02"/hr) a step counts as dry. */
const WET_STEP_IN = 0.005;
/** How far ahead the banner looks for a change worth announcing. */
const LOOKAHEAD_S = 2 * 3600;
/** Rain has to hold off this many steps in a row before it counts as stopping. */
const DRY_RUN_STEPS = 2;

export interface RainOutlook {
  kind: 'start' | 'stop';
  /** Unix seconds of the change, never earlier than now. */
  at: number;
  /** The forecast step the change falls in, which stays put while `at` counts down: what a dismissal remembers. */
  step: number;
  /** For a start, how hard it is expected to come down. */
  intensity: 'Light' | 'Moderate' | 'Heavy';
  /** The next two hours, for the bar strip. */
  steps: NowcastStep[];
}

export const isWetStep = (s: NowcastStep) => (s.precip ?? 0) >= WET_STEP_IN;

function intensityOf(inchesPer15: number): RainOutlook['intensity'] {
  const perHour = inchesPer15 * 4;
  return perHour < 0.1 ? 'Light' : perHour < 0.3 ? 'Moderate' : 'Heavy';
}

/**
 * What the next two hours hold that is worth a banner: rain arriving while the
 * station is dry, or rain letting up while it is recording some. Null when
 * nothing changes, which is most of the time.
 */
export function rainOutlook(steps: NowcastStep[], rainingNow: boolean, nowUnix: number): RainOutlook | null {
  // A step still under way counts as the present.
  const ahead = steps.filter(s => s.time + 900 > nowUnix && s.time < nowUnix + LOOKAHEAD_S);
  const strip = steps.filter(s => s.time + 900 > nowUnix).slice(0, 8);
  if (ahead.length === 0) return null;

  if (!rainingNow) {
    const first = ahead.findIndex(isWetStep);
    if (first === -1) return null;
    const peak = Math.max(...ahead.slice(first, first + 4).map(s => s.precip ?? 0));
    return { kind: 'start', at: Math.max(ahead[first].time, nowUnix), step: ahead[first].time, intensity: intensityOf(peak), steps: strip };
  }

  const dry = ahead.findIndex((_, i) => i + DRY_RUN_STEPS <= ahead.length && ahead.slice(i, i + DRY_RUN_STEPS).every(s => !isWetStep(s)));
  if (dry === -1) return null;
  return { kind: 'stop', at: Math.max(ahead[dry].time, nowUnix), step: ahead[dry].time, intensity: 'Light', steps: strip };
}
