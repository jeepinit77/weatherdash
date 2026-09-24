import React, { useState } from 'react';
import { CalendarRange, CloudOff } from 'lucide-react';
import { DayDetailModal } from './DayDetailModal';
import { rainAmount } from './forecastText';
import { RAIN_CHANCE_FLOOR, dayRange, scaleFraction, tempGradient, weekScale } from './forecastScale';
import { TileHeader } from './TileParts';
import { NowDot } from './WeekChart';
import { fmt, formatInZone } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import { upcomingDays, weatherIcon } from '../../lib/weather';
import type { ForecastData } from '../../types/weather';

interface WeekAheadTileProps {
  forecast: ForecastData | null;
  hasError: boolean;
  /** The station's temperature right now, in °F, marked on today's bar. */
  nowTemp: number | null;
}

/**
 * The week as a card that sits in a row of tiles: a line a day, each with its
 * low and high either side of a bar drawn on one scale shared by the week, so
 * the bars line up into the week's shape. Tap a day for the full forecast.
 */
export const WeekAheadTile: React.FC<WeekAheadTileProps> = ({ forecast, hasError, nowTemp }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  // Only which day is today hangs on this.
  const now = useNow(60_000);
  const [activeTime, setActiveTime] = useState<number | null>(null);

  if (!forecast) {
    return (
      <div className="tile p-5 flex flex-col items-center">
        <TileHeader icon={CalendarRange} label="Week Ahead" />
        <div className={`flex-1 py-8 flex items-center justify-center gap-2 text-center ${wall ? 'text-xl' : 'text-sm'} text-ink-3`}>
          {hasError ? <><CloudOff className="w-5 h-5 shrink-0" /> Forecast is unavailable right now.</> : 'Loading forecast…'}
        </div>
      </div>
    );
  }

  const tz = forecast.timezone;
  const days = upcomingDays(forecast.daily, tz, now).slice(0, 7);
  const scale = weekScale(days.map(d => d.day), nowTemp);
  const degrees = (f: number | null) => fmt(units.temp(f), 0, '°');
  const active = days.find(d => d.day.time === activeTime) ?? null;

  const figure = wall ? 'text-xl' : 'text-base';

  return (
    <div className="tile p-4 sm:p-5 flex flex-col">
      <TileHeader icon={CalendarRange} label="Week Ahead" />

      <div className="mt-3 flex-1 flex flex-col justify-between">
        {days.map(({ day, relative }) => {
          const isToday = relative === 'Today';
          const range = dayRange(day);
          const pop = day.popMax;
          const amount = rainAmount(day.precipSum, units);
          return (
            <button
              key={day.time}
              type="button"
              onClick={() => setActiveTime(day.time)}
              className={`grid items-center gap-x-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-fill-soft ${
                wall ? 'grid-cols-[3.25rem_2.25rem_2.5rem_1fr_2.5rem]' : 'grid-cols-[2.75rem_1.75rem_2rem_1fr_2rem]'
              }`}
            >
              <span className={`${wall ? 'text-lg' : 'text-sm'} font-bold truncate ${isToday ? 'text-accent-text' : 'text-ink-2'}`}>
                {isToday ? 'Today' : formatInZone(new Date(day.time * 1000), tz, { weekday: 'short' })}
              </span>

              {/* The rain chance and amount tuck under the icon, where they read as part of the day's sky. */}
              <span className="flex flex-col items-center">
                {weatherIcon(day.weatherCode, wall ? 'w-8 h-8' : 'w-6 h-6')}
                {pop !== null && pop >= RAIN_CHANCE_FLOOR && (
                  <span className={`${wall ? 'text-sm' : 'text-[11px]'} font-black leading-none text-info-text`}>{pop}%</span>
                )}
                {amount && (
                  <span className={`mt-0.5 ${wall ? 'text-sm' : 'text-[10px]'} font-bold leading-none whitespace-nowrap text-info-text/80`}>{amount}</span>
                )}
              </span>

              <span className={`${figure} font-bold text-cool text-right tabular-nums`}>{degrees(day.tempMin)}</span>

              <span className={`relative ${wall ? 'h-3' : 'h-2'} rounded-full bg-well`}>
                {scale && range && (() => {
                  const lo = scaleFraction(range.low, scale);
                  const hi = scaleFraction(range.high, scale);
                  return (
                    <span
                      className={`absolute inset-y-0 rounded-full ${wall ? 'min-w-3' : 'min-w-2'}`}
                      style={{ left: `${lo * 100}%`, right: `${(1 - hi) * 100}%`, background: tempGradient(range.low, range.high, 'to right') }}
                    />
                  );
                })()}
                {isToday && scale && nowTemp !== null && (
                  <NowDot
                    temp={nowTemp}
                    className={`top-1/2 ${wall ? 'w-5 h-5' : 'w-3.5 h-3.5'}`}
                    style={{ left: `${scaleFraction(nowTemp, scale) * 100}%`, transform: 'translate(-50%, -50%)' }}
                  />
                )}
              </span>

              <span className={`${figure} font-black text-ink tabular-nums`}>{degrees(day.tempMax)}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <DayDetailModal
          day={active.day}
          title={active.relative ?? formatInZone(new Date(active.day.time * 1000), tz, { weekday: 'long' })}
          forecast={forecast}
          onClose={() => setActiveTime(null)}
        />
      )}
    </div>
  );
};
