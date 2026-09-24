import React from 'react';
import { Radar } from 'lucide-react';
import { RadarMap } from './RadarMap';
import { TileHeader } from './TileParts';
import { useRadarFrames, useRadarLoop, useRadarZoom } from '../../lib/radar';
import { useWallDisplay } from '../../lib/wallDisplay';

interface RadarTileProps {
  lat: number | null;
  lon: number | null;
  timezone: string | null;
}

/**
 * The last two hours of radar around the station, looping on a fixed view:
 * on a wall there is nobody to pan it. A tap opens the larger overlay, which
 * has the controls.
 */
export const RadarTile: React.FC<RadarTileProps> = ({ lat, lon, timezone }) => {
  const wall = useWallDisplay();
  const { host, frames, failed } = useRadarFrames();
  const [index] = useRadarLoop(frames.length, true);
  const [zoom] = useRadarZoom();

  return (
    <div className="tile p-5 flex flex-col">
      <TileHeader icon={Radar} label="Radar" />
      {lat === null || lon === null ? (
        <div className="mt-3 flex-1 min-h-56 rounded-xl bg-well flex items-center justify-center p-4 text-center text-sm text-ink-3">
          The radar needs the station’s location.
        </div>
      ) : (
        <RadarMap
          lat={lat}
          lon={lon}
          zoom={zoom}
          host={host}
          frames={frames}
          index={index}
          failed={failed}
          timezone={timezone}
          large={wall}
          className="mt-3 flex-1 min-h-56 rounded-xl"
        />
      )}
    </div>
  );
};
