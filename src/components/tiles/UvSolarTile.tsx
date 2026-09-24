import React from 'react';
import { Sun } from 'lucide-react';
import { TileHeader, TileStats } from './TileParts';
import { fmt } from '../../lib/format';
import { useWallDisplay } from '../../lib/wallDisplay';
import { UV_TONE, uvCategory } from '../../lib/weather';
import type { Reading } from '../../types/weather';

interface UvSolarTileProps {
  reading: Reading;
}

/** The UV index large, with its band, and the solar radiation behind it. */
export const UvSolarTile: React.FC<UvSolarTileProps> = ({ reading }) => {
  const wall = useWallDisplay();
  const uv = reading.uv;
  const category = uv === null ? null : uvCategory(uv);

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Sun} label="UV & Solar" />

      <div className="flex-1 w-full flex flex-col items-center justify-center py-4">
        <div className={`${wall ? 'text-base' : 'text-xs'} font-semibold text-ink-2 uppercase tracking-[0.2em]`}>UV Index</div>
        <div className={`mt-1 ${wall ? 'text-9xl' : 'text-7xl'} font-black leading-none ${category ? UV_TONE[category] : 'text-ink'}`}>
          {fmt(uv, 0)}
        </div>
        {category && (
          <div className={`mt-3 ${wall ? 'text-2xl' : 'text-lg'} font-bold capitalize ${UV_TONE[category]}`}>{category}</div>
        )}
      </div>

      <TileStats
        stats={[
          {
            label: 'Solar Radiation',
            value: (
              <>
                {fmt(reading.solarradiation, 0)}
                {reading.solarradiation !== null && <span className="text-ink-3 font-semibold"> W/m²</span>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
};
