import { useEffect, useState, useSyncExternalStore } from 'react';
import { useVisiblePolling } from './useVisiblePolling';

/** RainViewer's frame list: free for personal use with credit, fetched by the browser directly. */
const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const FRAMES_REFRESH_MS = 5 * 60_000;
/** RainViewer's free tier serves up to zoom 7; below 4 a station's surroundings are lost. */
export const RADAR_ZOOMS = [4, 5, 6, 7] as const;
const DEFAULT_ZOOM = 7;
const FRAME_MS = 550;
/** The newest frame lingers so the present reads before the loop starts again. */
const HOLD_LAST_MS = 2500;
const ZOOM_KEY = 'weatherdash_radar_zoom';

export interface RadarFrame {
  time: number;
  path: string;
}

/** RainViewer's frame list for the last two hours, refreshed every few minutes. */
export function useRadarFrames() {
  const [host, setHost] = useState<string | null>(null);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [failed, setFailed] = useState(false);
  useVisiblePolling(() => {
    fetch(RAINVIEWER_INDEX)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { host?: string; radar?: { past?: RadarFrame[] } }) => {
        const past = (data.radar?.past ?? []).filter(f => typeof f.time === 'number' && typeof f.path === 'string');
        setHost(data.host ?? null);
        setFrames(past);
        setFailed(past.length === 0);
      })
      .catch(() => setFailed(true));
  }, FRAMES_REFRESH_MS);
  return { host, frames, failed };
}

/** Which frame is showing: it steps through them, holding on the newest, while `playing`. */
export function useRadarLoop(count: number, playing: boolean) {
  const [index, setIndex] = useState(-1);
  // A fresh list starts on its newest frame.
  const shown = index < 0 || index >= count ? count - 1 : index;
  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setTimeout(() => setIndex((shown + 1) % count), shown === count - 1 ? HOLD_LAST_MS : FRAME_MS);
    return () => clearTimeout(timer);
  }, [shown, count, playing]);
  return [shown, setIndex] as const;
}

const ZOOM_EVENT = 'weatherdash:radar-zoom';

function readZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    if ((RADAR_ZOOMS as readonly number[]).includes(z)) return z;
  } catch { /* storage unavailable */ }
  return DEFAULT_ZOOM;
}

function subscribeZoom(onChange: () => void) {
  window.addEventListener(ZOOM_EVENT, onChange);
  return () => window.removeEventListener(ZOOM_EVENT, onChange);
}

/** The viewer's zoom, remembered in this browser; changing it in the overlay changes the tile too. */
export function useRadarZoom() {
  const zoom = useSyncExternalStore(subscribeZoom, readZoom);
  const setZoom = (z: number) => {
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(ZOOM_EVENT));
  };
  return [zoom, setZoom] as const;
}
