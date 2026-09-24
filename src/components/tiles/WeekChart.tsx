import React from 'react';
import { Navigation } from 'lucide-react';
import { rainAmount } from './forecastText';
import { RAIN_CHANCE_FLOOR, dayRange, scaleFraction, tempGradient, weekScale } from './forecastScale';
import { fmt, tempColor, windArrowRotation } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { weatherIcon } from '../../lib/weather';
import type { DailyForecast } from '../../types/weather';

export interface WeekChartDay {
  day: DailyForecast;
  /** Short enough for a seventh of a phone: "Today", then "Fri", "Sat"… */
  label: string;
  isToday: boolean;
}

interface WeekChartProps {
  days: WeekChartDay[];
  /** The station's own temperature right now, in °F, marked on today's bar. */
  nowTemp: number | null;
  /** Tapping a day opens its detail. Without it the columns are not buttons. */
  onSelect?: (time: number) => void;
}

/** The station's current reading on today's bar: its own colour, ringed so it stands off the bar. */
export const NowDot: React.FC<{ temp: number; className: string; style: React.CSSProperties }> = ({ temp, className, style }) => (
  <span
    aria-hidden="true"
    className={`absolute rounded-full border-[2.5px] border-ink shadow-[0_0_0_2px_rgb(0_0_0/0.35)] ${className}`}
    style={{ background: tempColor(temp), ...style }}
  />
);

/**
 * The week as a chart, for a screen too narrow for seven cards abreast. Each
 * day is a slim column whose low-to-high bar floats on one scale shared by the
 * whole week, with the figures riding the ends of the bar, so the week's shape
 * — a warm spell, the drop behind a front — reads before any number does.
 * The rain chance fills each column from the bottom as it does on the wide
 * cards, the expected amount sits under the chance, and the station's own reading sits on today's bar.
 */
export const WeekChart: React.FC<WeekChartProps> = ({ days, nowTemp, onSelect }) => {
  const units = useUnits();
  const scale = weekScale(days.map(d => d.day), nowTemp);
  const degrees = (f: number | null) => fmt(units.temp(f), 0, '°');
  const today = days.find(d => d.isToday);
  const showNow = nowTemp !== null && today !== undefined && scale !== null;

  return (
    <div>
      <div className="flex gap-1 sm:gap-2">
        {days.map(({ day, label, isToday }) => {
          const range = dayRange(day);
          const Column = onSelect ? 'button' : 'div';
          const pop = day.popMax;
          return (
            <Column
              key={day.time}
              {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(day.time) } : {})}
              className={`relative flex-1 min-w-0 overflow-hidden rounded-xl border px-0.5 pt-2 pb-2.5 flex flex-col items-center ${
                isToday ? 'bg-accent-soft border-accent-line' : 'bg-fill-soft border-line-soft'
              } ${onSelect ? 'transition-colors hover:bg-fill hover:border-line-strong' : ''}`}
            >
              {pop !== null && pop > 0 && (
                <span aria-hidden="true" className="rain-level pointer-events-none absolute inset-x-0 bottom-0" style={{ height: `${pop}%` }} />
              )}

              <span className={`relative text-[13px] sm:text-sm font-bold leading-none ${isToday ? 'text-accent-text' : 'text-ink-2'}`}>
                {label}
              </span>
              <span className="relative mt-2">{weatherIcon(day.weatherCode, 'w-7 h-7 sm:w-8 sm:h-8')}</span>
              <span className="relative mt-1 h-4 text-xs sm:text-sm font-black leading-4 text-info-text">
                {pop !== null && pop >= RAIN_CHANCE_FLOOR ? `${pop}%` : ''}
              </span>
              <span className="relative h-4 text-[11px] sm:text-xs font-bold leading-4 text-info-text/80 tabular-nums">
                {rainAmount(day.precipSum, units) ?? ''}
              </span>

              {/* The bar's track. Its padding leaves room for the figures at the week's extremes. */}
              <div className="relative w-full h-44 sm:h-52 py-6">
                <div className="relative h-full">
                  {scale && range && (() => {
                    const lo = scaleFraction(range.low, scale);
                    const hi = scaleFraction(range.high, scale);
                    return (
                      <>
                        <span
                          className="absolute left-1/2 -translate-x-1/2 w-2 sm:w-2.5 min-h-2 rounded-full"
                          style={{
                            bottom: `${lo * 100}%`,
                            top: `${(1 - hi) * 100}%`,
                            background: tempGradient(range.low, range.high, 'to top'),
                          }}
                        />
                        {day.tempMax !== null && (
                          <span
                            className="absolute inset-x-0 text-center text-base sm:text-lg font-black leading-none text-ink"
                            style={{ bottom: `calc(${hi * 100}% + 0.4rem)` }}
                          >
                            {degrees(day.tempMax)}
                          </span>
                        )}
                        {day.tempMin !== null && (
                          <span
                            className="absolute inset-x-0 text-center text-sm sm:text-base font-bold leading-none text-cool"
                            style={{ top: `calc(${(1 - lo) * 100}% + 0.4rem)` }}
                          >
                            {degrees(day.tempMin)}
                          </span>
                        )}
                      </>
                    );
                  })()}
                  {isToday && showNow && (
                    <NowDot
                      temp={nowTemp}
                      className="left-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4"
                      style={{ bottom: `${scaleFraction(nowTemp, scale) * 100}%`, transform: 'translate(-50%, 50%)' }}
                    />
                  )}
                </div>
              </div>

              <span className="relative mt-1 flex flex-col items-center gap-0.5">
                {day.windSpeedMax !== null ? (
                  <>
                    <Navigation
                      className="w-3.5 h-3.5 text-ink-2"
                      style={day.windDirectionMax !== null ? { transform: windArrowRotation(day.windDirectionMax) } : undefined}
                    />
                    <span className="text-sm font-bold leading-none text-ink">{fmt(units.speed(day.windSpeedMax), 0)}</span>
                  </>
                ) : (
                  <span className="text-sm font-bold leading-none text-ink-4">—</span>
                )}
              </span>
            </Column>
          );
        })}
      </div>

      <div className="mt-2.5 px-1 flex items-center justify-between gap-3 text-xs text-ink-3">
        {showNow ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full border-2 border-ink" style={{ background: tempColor(nowTemp) }} />
            Now at the station <span className="font-bold text-ink">{degrees(nowTemp)}</span>
          </span>
        ) : <span />}
        <span>Wind in {units.speedUnit}</span>
      </div>
    </div>
  );
};
