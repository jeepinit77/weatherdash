import React from 'react';
import { CloudOff, Leaf } from 'lucide-react';
import { GaugeFrame } from './GaugeRing';
import { dialUnits } from './gaugeGeometry';
import { TileHeader, TileStats } from './TileParts';
import { AQI_BANDS, POLLUTANT_SHORT, aqiBand, aqiDialFraction } from '../../lib/aqi';
import { fmt } from '../../lib/format';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { AirQuality } from '../../types/weather';

/** The dial's sweep, open at the bottom like a speedometer, starting at the lower left. */
const SWEEP_DEG = 270;
const START_DEG = 225;
/** Ring thickness and where its outer edge sits, in dial units (the dial is 260 across). */
const RING_WIDTH = 16;
const RING_INSET = 12;

/** Each band's colour, placed mid-band so the ring blends from one to the next. */
const STOPS = AQI_BANDS.map((band, i) => ({ color: band.color, at: ((i + 0.5) / AQI_BANDS.length) * SWEEP_DEG }));

function conic(untilDeg: number): string {
  const stops: string[] = [`${STOPS[0].color} 0deg`];
  for (let i = 0; i < STOPS.length; i++) {
    const stop = STOPS[i];
    if (stop.at <= untilDeg) {
      stops.push(`${stop.color} ${stop.at}deg`);
      continue;
    }
    // The colour where the value falls, mixed between the stops either side of it.
    const prev = STOPS[i - 1];
    const from = prev ? prev.at : 0;
    const share = Math.round(((untilDeg - from) / (stop.at - from)) * 100);
    const mixed = prev ? `color-mix(in srgb, ${stop.color} ${share}%, ${prev.color})` : stop.color;
    stops.push(`${mixed} ${untilDeg}deg`);
    break;
  }
  if (untilDeg >= STOPS[STOPS.length - 1].at) stops.push(`${STOPS[STOPS.length - 1].color} ${untilDeg}deg`);
  stops.push(`transparent ${untilDeg}deg`);
  return `conic-gradient(from ${START_DEG}deg, ${stops.join(', ')})`;
}

const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${dialUnits(RING_WIDTH)}), #000 calc(100% - ${dialUnits(RING_WIDTH)} + 1px))`;

const Ring: React.FC<{ untilDeg: number; opacity?: number }> = ({ untilDeg, opacity = 1 }) => (
  <div
    aria-hidden="true"
    className="absolute rounded-full transition-all duration-700"
    style={{ inset: dialUnits(RING_INSET), background: conic(untilDeg), mask: ringMask, WebkitMask: ringMask, opacity }}
  />
);

/**
 * The US AQI on a ring painted in the EPA's band colours, bright up to the
 * current value and faint beyond it, so how far up the scale the air sits
 * reads before the number does.
 */
export const AqiTile: React.FC<{ air: AirQuality | null; hasError: boolean }> = ({ air, hasError }) => {
  const wall = useWallDisplay();
  const aqi = air?.aqi ?? null;

  if (aqi === null) {
    return (
      <div className="tile p-5 flex flex-col items-center">
        <TileHeader icon={Leaf} label="Air Quality" />
        <div className={`flex-1 py-8 flex items-center justify-center gap-2 text-center ${wall ? 'text-xl' : 'text-sm'} text-ink-3`}>
          {hasError || air ? <><CloudOff className="w-5 h-5 shrink-0" /> Air quality is unavailable right now.</> : 'Loading air quality…'}
        </div>
      </div>
    );
  }

  const band = aqiBand(aqi);
  const valueDeg = aqiDialFraction(aqi) * SWEEP_DEG;
  // Centre line of the ring, as a share of the frame, for the marker.
  const radius = 50 - ((RING_INSET + RING_WIDTH / 2) / 260) * 100;
  const bearing = ((START_DEG + valueDeg) * Math.PI) / 180;
  const main = air!.pollutants.filter(p => p.aqi !== null).sort((a, b) => b.aqi! - a.aqi!)[0];
  const pm25 = air!.pollutants.find(p => p.id === 'pm2_5');

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Leaf} label="Air Quality" />

      <GaugeFrame>
        <Ring untilDeg={SWEEP_DEG} opacity={0.18} />
        <Ring untilDeg={valueDeg} />
        <span
          aria-hidden="true"
          className="absolute rounded-full border-[3px] border-ink transition-all duration-700"
          style={{
            width: dialUnits(RING_WIDTH + 8),
            height: dialUnits(RING_WIDTH + 8),
            left: `${50 + radius * Math.sin(bearing)}%`,
            top: `${50 - radius * Math.cos(bearing)}%`,
            transform: 'translate(-50%, -50%)',
            background: band.color,
            boxShadow: 'var(--marker-shadow)',
          }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-semibold text-ink-2 uppercase tracking-[0.2em]" style={{ fontSize: dialUnits(wall ? 14 : 12) }}>US AQI</div>
          <div className="font-black text-ink leading-none" style={{ fontSize: dialUnits(76) }}>{fmt(aqi, 0)}</div>
          <div className="mt-1 font-bold text-center leading-tight" style={{ fontSize: dialUnits(17), color: band.color }}>{band.short}</div>
        </div>
      </GaugeFrame>

      <TileStats
        stats={[
          main ? { label: 'Main pollutant', value: POLLUTANT_SHORT[main.id] } : null,
          pm25 && pm25.concentration !== null ? { label: 'PM2.5', value: `${fmt(pm25.concentration, 0)} µg/m³` } : null,
        ]}
      />
    </div>
  );
};
