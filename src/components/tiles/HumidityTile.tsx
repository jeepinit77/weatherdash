import React from 'react';
import { Droplets } from 'lucide-react';
import { GaugeCanvas, GaugeFrame, GaugeRing } from './GaugeRing';
import { INNER_R, OUTER_R, dialUnits } from './gaugeGeometry';
import { TileHeader, TileStats } from './TileParts';
import { fmt } from '../../lib/format';
import { useUnits } from '../../lib/units';
import type { Reading, StationStats } from '../../types/weather';

interface HumidityTileProps {
  reading: Reading;
  stats: StationStats;
}

/** Inner ring = current humidity (filled from zero). Outer ring = today's range, filled only low-to-high. */
const FULL_SCALE = 100;

const CURRENT_COLOR = 'var(--humid-now)';
const RANGE_COLOR = 'var(--humid-range)';

const OUTER_STROKE = 11;
const INNER_STROKE = 15;

export const HumidityTile: React.FC<HumidityTileProps> = ({ reading, stats }) => {
  const units = useUnits();
  const humidity = reading.humidity;
  const high = stats.today.humidityHigh;
  const low = stats.today.humidityLow;

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Droplets} label="Humidity" />

      <GaugeFrame>
        <GaugeCanvas>
          <GaugeRing
            radius={OUTER_R}
            value={null}
            fullScale={FULL_SCALE}
            color={RANGE_COLOR}
            strokeWidth={OUTER_STROKE}
            rangeStart={low}
            rangeEnd={high}
            showRangeTicks
          />
          <GaugeRing
            radius={INNER_R}
            value={humidity}
            fullScale={FULL_SCALE}
            color={CURRENT_COLOR}
            strokeWidth={INNER_STROKE}
          />
        </GaugeCanvas>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-black text-ink leading-none" style={{ fontSize: dialUnits(72) }}>
            {fmt(humidity, 0)}
            <span className="align-top" style={{ fontSize: dialUnits(30) }}>%</span>
          </div>
        </div>
      </GaugeFrame>

      <TileStats
        stats={[
          { label: 'High', value: fmt(high, 0, '%') },
          { label: 'Low', value: fmt(low, 0, '%') },
          { label: 'Dew Point', value: fmt(units.temp(reading.dewPoint), 0, '°') },
        ]}
      />
    </div>
  );
};
