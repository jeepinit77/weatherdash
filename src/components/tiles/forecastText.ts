import { windCardinal } from '../../lib/format';
import type { Units } from '../../lib/units';
import { uvCategory, weatherLabel } from '../../lib/weather';
import type { DailyForecast } from '../../types/weather';

/** A gust isn't worth a separate mention unless it clears the sustained speed by this much. */
const NOTABLE_GUST_MARGIN_MPH = 5;

/** Below a hundredth of an inch there is no amount worth printing. */
const RAIN_AMOUNT_FLOOR_IN = 0.01;

/** True when the day's gusts are strong enough to be worth naming beside the wind. */
export function hasNotableGust(day: DailyForecast): day is DailyForecast & { windGustMax: number } {
  return day.windSpeedMax !== null && day.windGustMax !== null && day.windGustMax >= day.windSpeedMax + NOTABLE_GUST_MARGIN_MPH;
}

/**
 * Expected rainfall, in the same clipped form the rain gauge tile uses. A day
 * with nothing but a trace returns null: a column of 0.00" would crowd out the
 * chance of rain beside it while saying less than the blank does.
 */
export function rainAmount(inches: number | null, units: Units): string | null {
  if (inches === null || inches < RAIN_AMOUNT_FLOOR_IN) return null;
  return `${units.formatRain(inches)}${units.rainUnit === 'in' ? '"' : 'mm'}`;
}

/**
 * The rain expected over the days shown, in inches. Null unless every day has
 * an amount, since a total missing a day would understate the week.
 */
export function totalRain(days: DailyForecast[]): number | null {
  if (days.length === 0 || days.some(d => d.precipSum === null)) return null;
  return days.reduce((sum, d) => sum + (d.precipSum ?? 0), 0);
}

const whole = (value: number | null) => (value === null ? '—' : value.toFixed(0));

/**
 * The National Weather Service ships the forecaster's own wording, which reads
 * better than anything we can assemble; Open-Meteo sends only numbers, so for
 * that source we write the sentences ourselves, in the viewer's units.
 */
export function dayForecastText(day: DailyForecast, units: Units): string {
  if (day.detailText) return day.detailText;
  const label = weatherLabel(day.weatherCode);
  const sentences = [`${label} with a high near ${whole(units.temp(day.tempMax))}° and a low around ${whole(units.temp(day.tempMin))}°.`];
  if (day.popMax !== null && day.popMax > 0) {
    // Spelled out in full here rather than in the card's clipped form, since this
    // is a sentence someone reads rather than a number they glance at.
    const rain = day.precipSum !== null && day.precipSum >= RAIN_AMOUNT_FLOOR_IN ? units.rain(day.precipSum) : null;
    const amount = rain !== null ? `, around ${rain.toFixed(units.rainDigits)} ${units.rainUnit}` : '';
    sentences.push(`Chance of precipitation ${day.popMax}%${amount}.`);
  }
  if (day.windSpeedMax !== null) {
    const dir = day.windDirectionMax !== null ? `${windCardinal(day.windDirectionMax)} ` : '';
    const gust = hasNotableGust(day) ? `, gusting to ${whole(units.speed(day.windGustMax))} ${units.speedUnit}` : '';
    sentences.push(`Wind ${dir}${whole(units.speed(day.windSpeedMax))} ${units.speedUnit}${gust}.`);
  }
  if (day.uvIndexMax !== null) {
    sentences.push(`UV index ${day.uvIndexMax.toFixed(0)} (${uvCategory(day.uvIndexMax)}).`);
  }
  return sentences.join(' ');
}
