import React, { useCallback, useMemo, useState } from 'react';
import { UNITS_STORAGE_KEY, UnitsContext, readStoredUnits, unitsFor, type UnitSystem } from './units';

/** Supplies the viewer's chosen display units to everything below it. */
export const UnitsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [system, setSystemState] = useState<UnitSystem>(readStoredUnits);
  const setSystem = useCallback((next: UnitSystem) => {
    setSystemState(next);
    try { localStorage.setItem(UNITS_STORAGE_KEY, next); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => ({ units: unitsFor(system), setSystem }), [system, setSystem]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
};
