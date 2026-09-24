import React, { useState } from 'react';
import { Minus, Pause, Play, Plus } from 'lucide-react';
import { RadarMap } from '../tiles/RadarMap';
import { RADAR_ZOOMS, useRadarFrames, useRadarLoop, useRadarZoom } from '../../lib/radar';
import { formatInZone } from '../../lib/format';

interface RadarDetailProps {
  lat: number | null;
  lon: number | null;
  timezone: string | null;
}

/** The radar large, with the loop's controls: play or hold, step through the frames, zoom. */
export const RadarDetail: React.FC<RadarDetailProps> = ({ lat, lon, timezone }) => {
  const { host, frames, failed } = useRadarFrames();
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useRadarLoop(frames.length, playing);
  const [zoom, setZoom] = useRadarZoom();
  const zoomAt = RADAR_ZOOMS.indexOf(zoom as (typeof RADAR_ZOOMS)[number]);
  const clock = (unix: number) => formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' });
  const button = 'p-2 rounded-lg border border-line bg-fill-soft text-ink-2 hover:bg-fill hover:text-ink transition disabled:opacity-30 disabled:pointer-events-none';

  if (lat === null || lon === null) return <p className="mt-6 text-ink-3">The radar needs the station’s location.</p>;

  return (
    <>
      <RadarMap
        lat={lat}
        lon={lon}
        zoom={zoom}
        host={host}
        frames={frames}
        index={index}
        failed={failed}
        timezone={timezone}
        large
        links
        className="mt-4 h-[clamp(16rem,62vh,44rem)] rounded-xl"
      />

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} className={button}>
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={Math.max(0, index)}
          onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }}
          aria-label="Radar frame"
          className="flex-1 accent-[var(--accent)]"
          disabled={frames.length < 2}
        />
        <span className="w-24 text-sm text-ink-2 tabular-nums text-right">{frames[index] ? clock(frames[index].time) : '—'}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setZoom(RADAR_ZOOMS[zoomAt - 1])} disabled={zoomAt <= 0} aria-label="Zoom out" title="Zoom out" className={button}>
            <Minus className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => setZoom(RADAR_ZOOMS[zoomAt + 1])} disabled={zoomAt >= RADAR_ZOOMS.length - 1} aria-label="Zoom in" title="Zoom in" className={button}>
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
};
