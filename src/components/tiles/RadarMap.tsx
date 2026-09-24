import React, { useLayoutEffect, useRef, useState } from 'react';
import { formatInZone } from '../../lib/format';
import { THEMES, useTheme } from '../../lib/theme';
import type { RadarFrame } from '../../lib/radar';

/**
 * Radar frames come from RainViewer, free for personal use with credit, and
 * the base map and place names from Esri's gray canvas basemaps, likewise.
 * Both are fetched by the browser directly; nothing passes through our server.
 * (CARTO's basemaps, the usual choice, now demand an API key.)
 */
const ESRI_CANVAS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';
const TILE = 256;

/** Web Mercator: a coordinate as pixels across the whole world at zoom `z`. */
function worldPixel(lat: number, lon: number, z: number): [number, number] {
  const size = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

interface RadarMapProps {
  lat: number;
  lon: number;
  zoom: number;
  host: string | null;
  frames: RadarFrame[];
  index: number;
  failed: boolean;
  timezone: string | null;
  /** Larger type for the time, for the wall. */
  large?: boolean;
  /** Credits as links; off where a tap on the map means something else. */
  links?: boolean;
  className?: string;
}

/**
 * A fixed view centred on the station: the base map, every radar frame laid
 * over it (only the current one visible, so the loop never waits on a
 * download), place names above the rain so they stay readable through it,
 * the station's dot, the frame's time and a notch per frame.
 */
export const RadarMap: React.FC<RadarMapProps> = ({ lat, lon, zoom, host, frames, index, failed, timezone, large, links, className = '' }) => {
  const { theme } = useTheme();
  const dark = THEMES.find(t => t.id === theme)?.dark ?? true;
  const box = useRef<HTMLDivElement>(null);
  const [[w, h], setSize] = useState<[number, number]>([0, 0]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize([r.width, r.height]);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tiles: { key: string; x: number; y: number; left: number; top: number }[] = [];
  if (w > 0 && h > 0) {
    const [cx, cy] = worldPixel(lat, lon, zoom);
    const left = cx - w / 2;
    const top = cy - h / 2;
    const count = 2 ** zoom;
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
        tiles.push({ key: `${tx}/${ty}`, x: ((tx % count) + count) % count, y: ty, left: tx * TILE - left, top: ty * TILE - top });
      }
    }
  }

  const shade = dark ? 'Dark' : 'Light';
  const esri = (layer: 'Base' | 'Reference', x: number, y: number) => `${ESRI_CANVAS}/World_${shade}_Gray_${layer}/MapServer/tile/${zoom}/${y}/${x}`;
  const frame = frames[index];
  const newest = frames[frames.length - 1];
  const minutesAgo = frame && newest ? Math.round((newest.time - frame.time) / 60) : 0;
  const img = 'absolute w-64 h-64 max-w-none select-none pointer-events-none';
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div ref={box} className={`relative overflow-hidden bg-well ${className}`}>
      {tiles.map(t => <img key={`base-${t.key}`} src={esri('Base', t.x, t.y)} alt="" className={img} style={{ left: t.left, top: t.top }} />)}
      {host && frames.map((f, i) => (
        <div key={f.path} className="absolute inset-0 transition-opacity duration-300" style={{ opacity: i === index ? 0.85 : 0 }}>
          {tiles.map(t => (
            <img key={t.key} src={`${host}${f.path}/512/${zoom}/${t.x}/${t.y}/2/1_1.png`} alt="" className={img} style={{ left: t.left, top: t.top }} />
          ))}
        </div>
      ))}
      {tiles.map(t => <img key={`label-${t.key}`} src={esri('Reference', t.x, t.y)} alt="" className={img} style={{ left: t.left, top: t.top }} />)}

      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-accent border-2 border-white shadow-[0_0_0_4px_rgb(0_0_0/0.25)]" />

      {frame && (
        <div className={`absolute left-2 top-2 rounded-lg bg-black/55 backdrop-blur px-2 py-1 font-bold text-white tabular-nums ${large ? 'text-lg' : 'text-xs'}`}>
          {formatInZone(new Date(frame.time * 1000), timezone, { hour: 'numeric', minute: '2-digit' })}
          <span className="ml-1.5 font-semibold text-white/70">{minutesAgo === 0 ? 'latest' : `−${minutesAgo} min`}</span>
        </div>
      )}

      {frames.length > 1 && (
        <div className="absolute inset-x-2 bottom-5 flex gap-0.5" aria-hidden="true">
          {frames.map((f, i) => <span key={f.path} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-white/85' : 'bg-white/25'}`} />)}
        </div>
      )}

      <div className="absolute right-1 bottom-1 rounded bg-black/45 px-1 text-[9px] leading-tight text-white/85">
        {/* Without a radar host this is a plain map, which owes RainViewer nothing. */}
        {links ? (
          <>
            {host && <><a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer" className="underline" onClick={stop}>RainViewer</a>{' · '}</>}
            {'Esri, HERE, Garmin, '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={stop}>© OpenStreetMap</a>
          </>
        ) : `${host ? 'RainViewer · ' : ''}Esri, HERE, Garmin, © OpenStreetMap`}
      </div>

      {failed && (
        <div className="absolute inset-x-0 bottom-8 text-center text-xs font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">Radar frames are unavailable right now.</div>
      )}
    </div>
  );
};
