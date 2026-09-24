import { createContext, useContext } from 'react';

/**
 * Display units. Stations report in US units (°F, mph, inches, inHg) and the
 * server stores them that way; conversion happens only at the point of display.
 *
 * Like the theme, the choice is a property of whoever is reading the screen,
 * not of the station, so it lives in this browser's local storage.
 */
export type UnitSystem = 'us' | 'metric';

export const UNITS_STORAGE_KEY = 'weatherdash_units';

export interface Units {
  system: UnitSystem;
  /** °F in, display temperature out. Null stays null. */
  temp: (f: number | null | undefined) => number | null;
  /** A temperature difference (not a reading), such as a change over time. */
  tempDelta: (f: number | null | undefined) => number | null;
  tempUnit: '°F' | '°C';
  /** mph in. */
  speed: (mph: number | null | undefined) => number | null;
  speedUnit: 'mph' | 'km/h';
  /** Inches in. */
  rain: (inches: number | null | undefined) => number | null;
  rainUnit: 'in' | 'mm';
  rainDigits: number;
  /** A rain amount as text in the chosen unit, without the unit. "—" when missing. */
  formatRain: (inches: number | null | undefined) => string;
  /** inHg in. */
  pressure: (inHg: number | null | undefined) => number | null;
  pressureUnit: 'inHg' | 'hPa';
  pressureDigits: number;
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && !Number.isNaN(v);

export function unitsFor(system: UnitSystem): Units {
  const metric = system === 'metric';
  const rain = (inches: number | null | undefined) => (isNum(inches) ? (metric ? inches * 25.4 : inches) : null);
  const rainDigits = metric ? 1 : 2;
  return {
    system,
    temp: f => (isNum(f) ? (metric ? ((f - 32) * 5) / 9 : f) : null),
    tempDelta: f => (isNum(f) ? (metric ? (f * 5) / 9 : f) : null),
    tempUnit: metric ? '°C' : '°F',
    speed: mph => (isNum(mph) ? (metric ? mph * 1.609344 : mph) : null),
    speedUnit: metric ? 'km/h' : 'mph',
    rain,
    rainUnit: metric ? 'mm' : 'in',
    rainDigits,
    formatRain: inches => {
      const value = rain(inches);
      if (value === null) return '—';
      const text = value.toFixed(rainDigits);
      // US amounts drop the leading zero, like the Ambient tiles: ".58"
      return !metric && text.startsWith('0.') ? text.slice(1) : text;
    },
    pressure: inHg => (isNum(inHg) ? (metric ? inHg * 33.8639 : inHg) : null),
    pressureUnit: metric ? 'hPa' : 'inHg',
    pressureDigits: metric ? 0 : 2,
  };
}

export function readStoredUnits(): UnitSystem {
  try {
    return localStorage.getItem(UNITS_STORAGE_KEY) === 'metric' ? 'metric' : 'us';
  } catch {
    return 'us';
  }
}

export interface UnitsContextValue {
  units: Units;
  setSystem: (system: UnitSystem) => void;
}

export const UnitsContext = createContext<UnitsContextValue>({ units: unitsFor('us'), setSystem: () => {} });

/** The viewer's display units and converters. */
export function useUnits(): Units {
  return useContext(UnitsContext).units;
}

/** The chosen system and a setter, for the picker. */
export function useUnitSystem(): UnitsContextValue {
  return useContext(UnitsContext);
}
