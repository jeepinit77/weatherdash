import React from 'react';
import { CloudRain, Navigation, Sun, Sunrise, Sunset } from 'lucide-react';
import { DetailModal, DetailStat } from '../ui/DetailModal';
import { dayForecastText, hasNotableGust, rainAmount } from './forecastText';
import { fmt, formatInZone, windCardinal, windArrowRotation } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { FORECAST_SOURCE_NAME, forecastCredit, uvCategory, weatherIcon } from '../../lib/weather';
import type { DailyForecast, ForecastData } from '../../types/weather';

interface DayDetailModalProps {
  day: DailyForecast;
  title: string;
  forecast: ForecastData;
  onClose: () => void;
}

/** One forecast day in full: the headline conditions, the forecaster's wording and the hours. */
export const DayDetailModal: React.FC<DayDetailModalProps> = ({ day, title, forecast, onClose }) => {
  const units = useUnits();

  const degrees = (f: number | null) => fmt(units.temp(f), 0, '°');
  const hours = forecast.hourly.filter(h => h.time >= day.time && h.time < day.time + 86400);
  const gustNote = hasNotableGust(day) ? `gusts ${fmt(units.speed(day.windGustMax), 0)} ${units.speedUnit}` : null;
  const amount = rainAmount(day.precipSum, units);

  // Only conditions the forecast actually carries earn a slot; a missing one is left out
  // rather than shown as a blank or a guess.
  const stats: React.ReactNode[] = [];
  if (day.popMax !== null) {
    stats.push(
      <DetailStat
        key="rain"
        label="RAIN"
        tone="text-info-text"
        icon={<CloudRain className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />}
        value={`${day.popMax}%`}
        note={amount && (day.precipSource && day.precipSource !== forecast.source
          ? `${amount} expected, per ${FORECAST_SOURCE_NAME[day.precipSource]}`
          : `${amount} expected`)}
      />
    );
  }
  if (day.windSpeedMax !== null) {
    stats.push(
      <DetailStat
        key="wind"
        label="WIND"
        tone="text-ink"
        icon={
          <Navigation
            className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-ink-2"
            style={day.windDirectionMax !== null ? { transform: windArrowRotation(day.windDirectionMax) } : undefined}
          />
        }
        value={
          <span className="whitespace-nowrap">
            {day.windDirectionMax !== null && <span className="text-ink-2">{windCardinal(day.windDirectionMax)} </span>}
            {fmt(units.speed(day.windSpeedMax), 0)}
            <span className="text-base sm:text-lg font-bold text-ink-3"> {units.speedUnit}</span>
          </span>
        }
        note={gustNote}
      />
    );
  }
  if (day.uvIndexMax !== null) {
    stats.push(
      <DetailStat
        key="uv"
        label="UV INDEX"
        tone="text-warn-text"
        icon={<Sun className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />}
        value={fmt(day.uvIndexMax, 0)}
        note={uvCategory(day.uvIndexMax)}
      />
    );
  }
  // Sunrise and sunset share a slot so the whole row still fits on one line;
  // whichever one the forecast has leads, the other rides underneath.
  const clock = (unix: number) =>
    formatInZone(new Date(unix * 1000), forecast.timezone, { hour: 'numeric', minute: '2-digit' });
  if (day.sunrise !== null) {
    stats.push(
      <DetailStat
        key="sun"
        label="SUNRISE"
        tone="text-warn-text"
        icon={<Sunrise className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />}
        value={<span className="whitespace-nowrap">{clock(day.sunrise)}</span>}
        note={day.sunset !== null ? `sets ${clock(day.sunset)}` : null}
      />
    );
  } else if (day.sunset !== null) {
    stats.push(
      <DetailStat
        key="sun"
        label="SUNSET"
        tone="text-danger-text"
        icon={<Sunset className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />}
        value={<span className="whitespace-nowrap">{clock(day.sunset)}</span>}
      />
    );
  }

  return (
    <DetailModal
      title={title}
      subtitle={formatInZone(new Date(day.time * 1000), forecast.timezone, { month: 'long', day: 'numeric' })}
      onClose={onClose}
    >
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
        <div className="flex items-center gap-4 sm:gap-8 shrink-0">
          {weatherIcon(day.weatherCode, 'w-20 h-20 sm:w-24 sm:h-24')}
          <div className="flex items-baseline gap-3">
            <span className="text-6xl sm:text-7xl font-black text-ink leading-none">{degrees(day.tempMax)}</span>
            <span className="text-3xl sm:text-4xl font-bold text-cool leading-none">{degrees(day.tempMin)}</span>
          </div>
        </div>

        {stats.length > 0 && (
          <div className="flex flex-wrap items-start gap-x-6 sm:gap-x-7 gap-y-5 sm:border-l sm:border-line sm:pl-7">
            {stats}
          </div>
        )}
      </div>

      <p className="mt-5 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-3xl">{dayForecastText(day, units)}</p>
      <p className="mt-2 text-xs text-ink-4">Forecast by {forecastCredit(forecast)}</p>

      {hours.length > 0 && (
        <div className="mt-8">
          <div className="text-xs font-bold text-ink-3 tracking-[0.2em] mb-3">HOURLY</div>
          <div className="flex gap-4 overflow-x-auto overscroll-contain pb-2">
            {hours.map(hour => (
              <div key={hour.time} className="flex flex-col items-center gap-1.5 shrink-0 min-w-[4.5rem]">
                <div className="text-sm font-semibold text-ink-3">
                  {formatInZone(new Date(hour.time * 1000), forecast.timezone, { hour: 'numeric' })}
                </div>
                {weatherIcon(hour.weatherCode, 'w-8 h-8')}
                <div className="text-lg font-bold text-ink">{degrees(hour.temp)}</div>
                {hour.pop !== null && hour.pop > 0 && (
                  <div className="text-xs font-bold text-info-text">{hour.pop}%</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </DetailModal>
  );
};
