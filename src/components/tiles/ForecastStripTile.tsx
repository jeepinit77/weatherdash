import React, { useState } from 'react';
import { CalendarDays, CloudOff, CloudRain, Navigation } from 'lucide-react';
import { DayDetailModal } from './DayDetailModal';
import { rainAmount, totalRain } from './forecastText';
import { TileHeader } from './TileParts';
import { WeekChart } from './WeekChart';
import { fmt, formatInZone, windCardinal, windArrowRotation } from '../../lib/format';
import { WIDE_FORECAST_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { useNow } from '../../lib/useNow';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import { upcomingDays, weatherIcon } from '../../lib/weather';
import type { ForecastData } from '../../types/weather';

interface ForecastStripTileProps {
  forecast: ForecastData | null;
  hasError: boolean;
  /** The station's temperature right now, in °F, marked on today's bar where the week is drawn as a chart. */
  nowTemp: number | null;
}

/*
 * The cards only appear from lg up, seven abreast, and at lg each is narrow
 * enough that "WNW 14" crowds itself at the larger size; from xl there is room
 * for it. A wall display runs full width, so there they stay large throughout.
 */
const LEAD_TEXT = 'text-base xl:text-lg';
const TRAIL_TEXT = 'text-sm xl:text-base';
const LEAD_TEXT_WALL = 'text-2xl';
const TRAIL_TEXT_WALL = 'text-lg';

export const ForecastStripTile: React.FC<ForecastStripTileProps> = ({ forecast, hasError, nowTemp }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  // Seven cards abreast need a wide screen; anything narrower gets the week as a chart
  // rather than the cards stacked two or four to a row, which ran past a phone's screen.
  const wide = useMediaQuery(WIDE_FORECAST_QUERY);
  // Only which day is today hangs on this, so a minute's resolution is plenty.
  const now = useNow(60_000);
  const [activeTime, setActiveTime] = useState<number | null>(null);

  if (!forecast) {
    return (
      <div className={`tile p-6 flex items-center justify-center gap-2 ${wall ? 'text-xl' : 'text-sm'} text-ink-3`}>
        {hasError ? <><CloudOff className="w-5 h-5" /> Forecast is unavailable right now.</> : 'Loading forecast…'}
      </div>
    );
  }

  const timezone = forecast.timezone;
  const days = upcomingDays(forecast.daily, timezone, now)
    .slice(0, 7)
    .map(({ day, relative }) => ({
      day,
      relative,
      label: relative ?? formatInZone(new Date(day.time * 1000), timezone, { weekday: 'long' }),
    }));
  const active = days.find(d => d.day.time === activeTime) ?? null;
  const weekRain = rainAmount(totalRain(days.map(d => d.day)), units);
  const lead = wall ? LEAD_TEXT_WALL : LEAD_TEXT;
  const trail = wall ? TRAIL_TEXT_WALL : TRAIL_TEXT;
  const statIcon = wall ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <div className="tile p-4">
      <div className="px-2 pb-3">
        <TileHeader icon={CalendarDays} label="7-Day Forecast" />
        {weekRain && (
          <div className={`mt-1 flex items-center justify-end gap-1.5 ${wall ? 'text-2xl' : 'text-sm'} text-info-text`}>
            <CloudRain className={statIcon} aria-hidden="true" />
            <span className="font-black">{weekRain}</span>
            <span className="font-bold text-info-text/80">over 7 days</span>
          </div>
        )}
      </div>

      {!wide ? (
        <WeekChart
          days={days.map(({ day, relative }) => ({
            day,
            isToday: relative === 'Today',
            label: relative === 'Today' ? 'Today' : formatInZone(new Date(day.time * 1000), timezone, { weekday: 'short' }),
          }))}
          nowTemp={nowTemp}
          onSelect={setActiveTime}
        />
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {days.map(({ day, label }) => {
            const hasWind = day.windSpeedMax !== null;
            const amount = rainAmount(day.precipSum, units);

            return (
              <button
                key={day.time}
                type="button"
                onClick={() => setActiveTime(day.time)}
                className="relative overflow-hidden rounded-xl bg-fill-soft border border-line-soft px-2 pt-2.5 pb-3 flex flex-col items-center transition-colors hover:bg-fill hover:border-line-strong"
              >
                {/*
                  Chance of rain as a level filling the card from the bottom, so the week's
                  wet days stand out from across the room without anyone reading the numbers.
                  Kept faint, with the reading carried by the bright line at the top of the
                  fill rather than by the wash itself, which would otherwise fight the text.
                  The gradient itself is `--rain-fill`, so each theme mixes its own.
                */}
                {day.popMax !== null && day.popMax > 0 && (
                  <span
                    aria-hidden="true"
                    className="rain-level pointer-events-none absolute inset-x-0 bottom-0"
                    style={{ height: `${day.popMax}%` }}
                  />
                )}

                <div className={`relative ${wall ? 'text-xl' : 'text-base'} font-bold text-ink-2`}>{label}</div>
                <div className="relative my-2">{weatherIcon(day.weatherCode, wall ? 'w-16 h-16' : 'w-14 h-14')}</div>

                <div className="relative flex items-baseline gap-2">
                  <span className={`${wall ? 'text-5xl' : 'text-4xl'} font-black text-ink leading-none`}>
                    {fmt(units.temp(day.tempMax), 0, '°')}
                  </span>
                  <span className={`${wall ? 'text-3xl' : 'text-2xl'} font-bold text-cool leading-none`}>
                    {fmt(units.temp(day.tempMin), 0, '°')}
                  </span>
                </div>

                {/*
                  Rain on one line, wind on the next, each running the full width of the
                  card. The side-by-side split this replaces was what kept these numbers
                  small: half a card is not enough room for "WNW 14" at a size anyone can
                  read from across the room. Two lines cost no more height than the rain
                  figures already took, and buy several steps of type size.

                  Each line leads with its figure — chance of rain, wind speed — and
                  trails the qualifier belonging to it, so the left edge of all seven
                  cards is a column of numbers to scan straight down the week. The rule
                  above separates them from the day's temperatures, which are read as a
                  headline rather than scanned.
                */}
                <div className="relative mt-2 w-full space-y-1 border-t border-line-strong px-0.5 pt-2">
                  <div className="flex items-center justify-between gap-1.5 text-info-text">
                    <span className="flex items-center gap-1 min-w-0">
                      <CloudRain className={`${statIcon} shrink-0`} />
                      <span className={`${lead} font-black leading-none`}>
                        {day.popMax === null ? '—' : `${day.popMax}%`}
                      </span>
                    </span>
                    {amount && (
                      <span className={`${trail} font-bold leading-none text-info-text/80`}>{amount}</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    {hasWind ? (
                      <>
                        <span className="flex items-center gap-1 min-w-0">
                          <Navigation
                            className={`${statIcon} text-ink-2 shrink-0`}
                            style={day.windDirectionMax !== null ? { transform: windArrowRotation(day.windDirectionMax) } : undefined}
                          />
                          <span className={`${lead} font-black leading-none text-ink`}>
                            {fmt(units.speed(day.windSpeedMax), 0)}
                          </span>
                        </span>
                        {day.windDirectionMax !== null && (
                          <span className={`${trail} font-bold leading-none text-ink-2 truncate`}>
                            {windCardinal(day.windDirectionMax)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={`${lead} font-black leading-none text-ink-4`}>—</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <DayDetailModal
          day={active.day}
          title={active.label}
          forecast={forecast}
          onClose={() => setActiveTime(null)}
        />
      )}
    </div>
  );
};
