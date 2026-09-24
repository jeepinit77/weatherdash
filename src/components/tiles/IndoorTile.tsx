import React from 'react';
import { House } from 'lucide-react';
import { TileHeader, TileStats } from './TileParts';
import { fmt, tempColor } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { Reading } from '../../types/weather';

/** The console's own sensors: the temperature large, with humidity and comfort under it. */
export const IndoorTile: React.FC<{ reading: Reading }> = ({ reading }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const degrees = (f: number | null) => fmt(units.temp(f), 0, '°');

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={House} label="Indoors" />

      <div className="flex-1 flex flex-col items-center justify-center py-2">
        <div className={`${wall ? 'text-9xl' : 'text-7xl'} font-black leading-none text-figure`} style={{ color: tempColor(reading.tempinf) }}>
          {fmt(units.temp(reading.tempinf), 0)}
          <span className={`align-top ${wall ? 'text-5xl' : 'text-3xl'}`}>°</span>
        </div>
        {reading.feelsLikein !== null && (
          <div className={`mt-3 inline-flex items-center rounded-full border border-line-strong bg-well px-3 py-1 ${wall ? 'text-xl' : 'text-sm'} text-ink-2`}>
            Feels like <span className="ml-1.5 font-semibold text-ink">{degrees(reading.feelsLikein)}</span>
          </div>
        )}
      </div>

      <TileStats
        stats={[
          { label: 'Humidity', value: fmt(reading.humidityin, 0, '%') },
          { label: 'Dew Point', value: degrees(reading.dewPointin) },
        ]}
      />
    </div>
  );
};
