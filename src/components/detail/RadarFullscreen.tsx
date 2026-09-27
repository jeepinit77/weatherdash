import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LocateFixed, Minimize2, Minus, Pause, Play, Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { RadarMap } from '../tiles/RadarMap';
import { TILE, mercator, type RadarFrame } from '../../lib/radar';
import { formatInZone } from '../../lib/format';
import { useWallDisplay } from '../../lib/wallDisplay';

/** Esri's base map goes deeper than this, but the rain is only enlarged past zoom 7 and turns to blocks. */
const MIN_ZOOM = 3;
const MAX_ZOOM = 10;
/** A wheel notch is about 100; a trackpad sends many small deltas that add up to the same. */
const WHEEL_STEP = 100;
/** How far a pinch must open or close before it counts as one zoom step. */
const PINCH_STEP = 1.6;
const ARROW_PAN = 120;
const RADAR_SPEEDS = [0.5, 1, 2] as const;

interface Camera {
  view: [number, number];
  zoom: number;
}

interface RadarFullscreenProps {
  lat: number;
  lon: number;
  timezone: string | null;
  host: string | null;
  frames: RadarFrame[];
  failed: boolean;
  index: number;
  setIndex: (i: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  startZoom: number;
  onClose: () => void;
}

const world = (zoom: number) => TILE * 2 ** zoom;
/** Round the world east and west; stop at the top and bottom edges. */
const settle = ([x, y]: [number, number]): [number, number] => [((x % 1) + 1) % 1, Math.min(1, Math.max(0, y))];

/**
 * The radar across the whole screen, to be moved about freely: drag to pan,
 * wheel, pinch, double-click or the buttons to zoom, arrow keys and +/− from
 * the keyboard, and the loop's own controls along the bottom.
 */
export const RadarFullscreen: React.FC<RadarFullscreenProps> = ({
  lat, lon, timezone, host, frames, failed, index, setIndex, playing, setPlaying, speed, setSpeed, startZoom, onClose,
}) => {
  const home = mercator(lat, lon);
  const [cam, setCam] = useState<Camera>({ view: home, zoom: startZoom });
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const wall = useWallDisplay();

  const pan = (dx: number, dy: number) =>
    setCam(c => ({ ...c, view: settle([c.view[0] - dx / world(c.zoom), c.view[1] - dy / world(c.zoom)]) }));

  /** Zoom by `step`, keeping whatever is under the point (x, y) from the map's centre where it is. */
  const zoomAt = (step: number, x = 0, y = 0) =>
    setCam(c => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom + step));
      if (zoom === c.zoom) return c;
      const px = c.view[0] + x / world(c.zoom);
      const py = c.view[1] + y / world(c.zoom);
      return { zoom, view: settle([px - x / world(zoom), py - y / world(zoom)]) };
    });

  const fromCentre = (clientX: number, clientY: number): [number, number] => {
    const r = box.current?.getBoundingClientRect();
    return r ? [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] : [0, 0];
  };

  // The browser's own full screen too, unless the dashboard already holds it (or is standing in for it).
  useEffect(() => {
    if (wall || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      // Esc in real full screen is the browser's, and never reaches the page: leaving it means leaving this.
      else if (entered) onClose();
    };
    document.addEventListener('fullscreenchange', onChange);
    void document.documentElement.requestFullscreen().catch(() => {});
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React's wheel handler is passive, and this one must stop the page zooming or scrolling behind.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let owed = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      owed += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(owed) < WHEEL_STEP) return;
      const [x, y] = fromCentre(e.clientX, e.clientY);
      zoomAt(owed < 0 ? 1 : -1, x, y);
      owed = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // zoomAt and fromCentre only use refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = pointers.current.size === 2 ? spread() : null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      pan(e.clientX - last.x, e.clientY - last.y);
    } else if (pointers.current.size === 2 && pinch.current) {
      const now = spread();
      const ratio = now / pinch.current;
      if (ratio > PINCH_STEP || ratio < 1 / PINCH_STEP) {
        const [a, b] = [...pointers.current.values()];
        const [x, y] = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(ratio > 1 ? 1 : -1, x, y);
        pinch.current = now;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = pointers.current.size === 2 ? spread() : null;
  };

  const step = (by: number) => {
    if (frames.length === 0) return;
    setPlaying(false);
    setIndex((index + by + frames.length) % frames.length);
  };

  // On the window, since the dialog's panel holds the focus when it opens. Arrows and space are left to a focused control.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const dialogs = document.querySelectorAll('[data-modal-panel]');
    if (!box.current || box.current.closest('[data-modal-panel]') !== dialogs[dialogs.length - 1]) return;
    const onControl = e.target instanceof HTMLElement && e.target.closest('button, input');
    switch (e.key) {
      case 'ArrowLeft': if (onControl) return; pan(ARROW_PAN, 0); break;
      case 'ArrowRight': if (onControl) return; pan(-ARROW_PAN, 0); break;
      case 'ArrowUp': if (onControl) return; pan(0, ARROW_PAN); break;
      case 'ArrowDown': if (onControl) return; pan(0, -ARROW_PAN); break;
      case ' ': if (onControl) return; setPlaying(!playing); break;
      case '+': case '=': zoomAt(1); break;
      case '-': case '_': zoomAt(-1); break;
      case ',': step(-1); break;
      case '.': step(1); break;
      default: return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const clock = (unix: number) => formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' });
  const button = 'p-2.5 rounded-lg border border-line bg-fill-soft text-ink-2 hover:bg-fill hover:text-ink transition disabled:opacity-30 disabled:pointer-events-none';
  const floating = 'p-2.5 rounded-lg bg-black/55 backdrop-blur text-white hover:bg-black/75 transition disabled:opacity-30 disabled:pointer-events-none';
  const centred = cam.view[0] === home[0] && cam.view[1] === home[1];

  return (
    <Modal onClose={onClose} label="Radar, full screen" fill className="flex flex-col bg-well">
      <div className="relative flex-1 min-h-0">
        <div
          ref={box}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={e => zoomAt(e.shiftKey ? -1 : 1, ...fromCentre(e.clientX, e.clientY))}
          className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing select-none"
        >
          <RadarMap
            lat={lat}
            lon={lon}
            zoom={cam.zoom}
            view={cam.view}
            host={host}
            frames={frames}
            index={index}
            failed={failed}
            timezone={timezone}
            large
            links
            className="h-full"
          />
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <button type="button" onClick={onClose} aria-label="Leave full screen" title="Leave full screen" className={floating}>
            <Minimize2 className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => zoomAt(1)} disabled={cam.zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in" className={`${floating} mt-2`}>
            <Plus className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => zoomAt(-1)} disabled={cam.zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out" className={floating}>
            <Minus className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => setCam({ view: home, zoom: startZoom })} disabled={centred && cam.zoom === startZoom} aria-label="Back to the station" title="Back to the station" className={`${floating} mt-2`}>
            <LocateFixed className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-t border-line">
        <button type="button" onClick={() => step(-1)} disabled={frames.length < 2} aria-label="Previous frame" title="Previous frame" className={`${button} hidden sm:block`}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} className={button}>
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <button type="button" onClick={() => step(1)} disabled={frames.length < 2} aria-label="Next frame" title="Next frame" className={`${button} hidden sm:block`}>
          <ChevronRight className="w-5 h-5" />
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={Math.max(0, index)}
          onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }}
          aria-label="Radar frame"
          className="flex-1 min-w-0 accent-[var(--accent)]"
          disabled={frames.length < 2}
        />
        <span className="w-20 sm:w-24 text-base font-semibold text-ink-2 tabular-nums text-right">{frames[index] ? clock(frames[index].time) : '—'}</span>
        <button
          type="button"
          onClick={() => setSpeed(RADAR_SPEEDS[(RADAR_SPEEDS.indexOf(speed as (typeof RADAR_SPEEDS)[number]) + 1) % RADAR_SPEEDS.length])}
          aria-label={`Loop speed ${speed}×`}
          title="Loop speed"
          className={`${button} w-14 text-sm font-bold tabular-nums`}
        >
          {speed}×
        </button>
      </div>
    </Modal>
  );
};
