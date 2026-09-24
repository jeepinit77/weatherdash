import React from 'react';
import { Clock, Sun, Moon } from 'lucide-react';
import { TileHeader, TileStats } from '../tiles/TileParts';
import { clockParts, formatInZone } from '../../lib/format';
import { sunPhase } from '../../lib/sun';
import { useNow } from '../../lib/useNow';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { DailyForecast } from '../../types/weather';

interface TimeDateWidgetProps {
  /** Station timezone; the viewer's timezone is used when unknown. */
  timezone: string | null;
  /** The forecast days, which carry the sunrises and sunsets the bar runs between. */
  days: readonly DailyForecast[];
}

/** The clock's size where there is room: text-6xl, or text-8xl on the wall. */
const CLOCK_MAX = '3.75rem';
const CLOCK_MAX_WALL = '6rem';
/** Sized to the card's width where there is not. "12:59 PM CDT" runs about 3.6 times its font size. */
const CLOCK_FIT = '27cqw';

export const TimeDateWidget: React.FC<TimeDateWidgetProps> = ({ timezone, days }) => {
  const now = useNow();
  const wall = useWallDisplay();

  const { hourMinute, meridiem, zone } = clockParts(now, timezone);
  const weekday = formatInZone(now, timezone, { weekday: 'long' });
  const date = formatInZone(now, timezone, { month: 'long', day: 'numeric' });
  const time = (unix: number) => formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' });

  // Runs through the night as well as the day, so the bar keeps moving after
  // dusk and the sunrise on show is the one still to come.
  const phase = sunPhase(days, now.getTime() / 1000, timezone);

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Clock} label="Local Time" />

      {/* Shorter than a gauge tile's dial, so it centres itself when sharing a row with one. */}
      <div className="flex-1 w-full flex flex-col items-center justify-center" style={{ containerType: 'inline-size' }}>
        {/* The whole line scales with a narrow tile rather than spilling out of
            it; the meridiem and zone are sized off the time so they keep in step. */}
        <div
          className="flex items-baseline gap-[0.1em] whitespace-nowrap"
          style={{ fontSize: `min(${wall ? CLOCK_MAX_WALL : CLOCK_MAX}, ${CLOCK_FIT})` }}
        >
          <span className="font-black text-ink leading-none tabular-nums">{hourMinute}</span>
          {meridiem && <span className={`${wall ? 'text-[0.3125em]' : 'text-[0.4em]'} font-bold text-ink-2 leading-none`}>{meridiem}</span>}
          {zone && <span className={`${wall ? 'text-[0.21em]' : 'text-[0.233em]'} font-semibold text-ink-3 leading-none`}>{zone}</span>}
        </div>
        <div className={`mt-3 ${wall ? 'text-4xl' : 'text-2xl'} font-bold text-ink leading-tight`}>{weekday}</div>
        <div className={`${wall ? 'text-3xl' : 'text-xl'} font-semibold text-ink-2 leading-tight`}>{date}</div>

        {phase && (
          <>
            <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-well px-3 py-1 ${wall ? 'text-xl' : 'text-sm'} text-ink-2`}>
              {phase.isDay ? <Sun className="w-4 h-4 text-sun" /> : <Moon className="w-4 h-4 text-moon" />}
              {phase.isDay ? 'Daytime' : 'Nighttime'}
            </div>

            <div className="mt-5 w-full h-2 rounded-full overflow-hidden bg-well border border-line">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${phase.isDay ? 'daylight-bar' : 'night-bar'}`}
                style={{ width: `${phase.progress}%` }}
              />
            </div>

            <TileStats
              stats={[
                { label: phase.sunriseIsNextDay ? "Tomorrow's sunrise" : 'Sunrise', value: time(phase.sunrise) },
                { label: 'Sunset', value: time(phase.sunset) },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
};
