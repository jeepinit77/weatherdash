import type { PollutantId } from '../types/weather';

/** The EPA's US AQI bands, lowest first. */
export const AQI_BANDS = [
  { max: 50, label: 'Good', short: 'Good', color: 'var(--aqi-1)', advice: 'Air quality is satisfactory, and air pollution poses little or no risk.' },
  { max: 100, label: 'Moderate', short: 'Moderate', color: 'var(--aqi-2)', advice: 'Acceptable. Unusually sensitive people should consider limiting long or heavy exertion outdoors.' },
  { max: 150, label: 'Unhealthy for sensitive groups', short: 'Unhealthy for some', color: 'var(--aqi-3)', advice: 'People with heart or lung disease, older adults, children and teens should reduce long or heavy exertion outdoors.' },
  { max: 200, label: 'Unhealthy', short: 'Unhealthy', color: 'var(--aqi-4)', advice: 'Everyone should reduce long or heavy exertion outdoors; sensitive groups should avoid it.' },
  { max: 300, label: 'Very unhealthy', short: 'Very unhealthy', color: 'var(--aqi-5)', advice: 'Health alert: everyone should avoid long or heavy exertion outdoors.' },
  { max: 500, label: 'Hazardous', short: 'Hazardous', color: 'var(--aqi-6)', advice: 'Health warning of emergency conditions: everyone should avoid all outdoor exertion.' },
] as const;

export type AqiBand = (typeof AQI_BANDS)[number];

export function aqiBand(aqi: number): AqiBand {
  return AQI_BANDS.find(b => aqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/**
 * Where an AQI sits on a dial that gives each band an equal share, from 0 to 1.
 * The index runs to 500 but lives below 100 nearly all the time; a linear dial
 * would crowd every ordinary day into its first fifth.
 */
export function aqiDialFraction(aqi: number): number {
  const clamped = Math.max(0, Math.min(500, aqi));
  let low = 0;
  for (let i = 0; i < AQI_BANDS.length; i++) {
    const high = AQI_BANDS[i].max;
    if (clamped <= high) return (i + (clamped - low) / (high - low)) / AQI_BANDS.length;
    low = high;
  }
  return 1;
}

export const POLLUTANT_NAME: Record<PollutantId, string> = {
  pm2_5: 'Fine particles (PM2.5)',
  pm10: 'Coarse particles (PM10)',
  ozone: 'Ozone',
  no2: 'Nitrogen dioxide',
};

export const POLLUTANT_SHORT: Record<PollutantId, string> = {
  pm2_5: 'PM2.5',
  pm10: 'PM10',
  ozone: 'Ozone',
  no2: 'NO₂',
};
