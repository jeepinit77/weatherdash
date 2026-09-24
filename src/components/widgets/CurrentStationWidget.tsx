import React from 'react';
import { Thermometer } from 'lucide-react';
import { TileHeader, TileStats } from '../tiles/TileParts';
import { fmt, tempColor, windCardinal } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import { UV_TONE, uvCategory } from '../../lib/weather';
import type { Reading } from '../../types/weather';

interface CurrentStationWidgetProps {
  data: Reading;
}

/** Every outdoor sensor on one full-width card: the temperature large, the rest as stat columns. */
export const CurrentStationWidget: React.FC<CurrentStationWidgetProps> = ({ data }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  const speed = (mph: number | null) => fmt(units.speed(mph), 0, ` ${units.speedUnit}`);
  const rain = (inches: number | null) => {
    const text = units.formatRain(inches);
    return text === '—' ? text : `${text} ${units.rainUnit}`;
  };
  const uvBand = data.uv === null ? null : uvCategory(data.uv);

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Thermometer} label="All Sensors" />

      <div className="mt-1 flex flex-col items-center">
        <div className={`${wall ? 'text-9xl' : 'text-7xl'} font-black leading-none text-figure`} style={{ color: tempColor(data.tempf) }}>
          {fmt(units.temp(data.tempf), 0)}
          <span className={`align-top ${wall ? 'text-5xl' : 'text-3xl'}`}>{units.tempUnit}</span>
        </div>
        {data.feelsLike !== null && (
          <div className={`mt-3 inline-flex items-center rounded-full border border-line-strong bg-well px-3 py-1 ${wall ? 'text-xl' : 'text-sm'} text-ink-2`}>
            Feels like <span className="ml-1.5 font-semibold text-ink">{fmt(units.temp(data.feelsLike), 0, '°')}</span>
          </div>
        )}
      </div>

      <div className="mt-5 w-full flex flex-col lg:flex-row lg:justify-center gap-4 lg:gap-0 lg:divide-x lg:divide-fill-strong">
        <TileStats
          className="lg:w-auto lg:px-6"
          stats={[
            { label: 'Humidity', value: fmt(data.humidity, 0, '%') },
            { label: 'Dew Point', value: fmt(units.temp(data.dewPoint), 0, '°') },
            { label: 'Pressure', value: fmt(units.pressure(data.baromrelin), units.pressureDigits, ` ${units.pressureUnit}`) },
          ]}
        />
        <TileStats
          className="lg:w-auto lg:px-6"
          stats={[
            {
              label: 'Wind',
              value: data.winddir !== null && data.windspeedmph !== null
                ? `${windCardinal(data.winddir)} ${speed(data.windspeedmph)}`
                : speed(data.windspeedmph),
            },
            { label: 'Gust', value: speed(data.windgustmph) },
            { label: 'Rain Today', value: rain(data.dailyrainin) },
          ]}
        />
        <TileStats
          className="lg:w-auto lg:px-6"
          stats={[
            { label: 'Rain Rate', value: data.hourlyrainin === null ? '—' : `${units.formatRain(data.hourlyrainin)} ${units.rainUnit}/hr` },
            {
              label: 'UV Index',
              value: uvBand ? <span className={UV_TONE[uvBand]}>{fmt(data.uv, 0)}</span> : '—',
              title: uvBand ?? undefined,
            },
            { label: 'Solar', value: fmt(data.solarradiation, 0, ' W/m²') },
          ]}
        />
      </div>
    </div>
  );
};
