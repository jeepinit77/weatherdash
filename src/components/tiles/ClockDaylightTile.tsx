import React, { useLayoutEffect, useRef, useState } from 'react';
import { Sunrise, Sunset } from 'lucide-react';
import { clockParts, formatInZone } from '../../lib/format';
import { sunPhase } from '../../lib/sun';
import { useNow } from '../../lib/useNow';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { DailyForecast } from '../../types/weather';

interface ClockDaylightTileProps {
  /** Station timezone; the viewer's is used when unknown. */
  timezone: string | null;
  /** The forecast days, which carry the sunrises and sunsets the bar runs between. */
  days: readonly DailyForecast[];
}

/** Wide screens lay the bar out as one row, so each slot needs its place in that order. */
const Divider: React.FC<{ order: string }> = ({ order }) => (
  <div className={`hidden sm:block self-stretch w-px bg-fill-strong ${order}`} />
);

const SunTime: React.FC<{
  icon: React.ReactNode;
  label: string;
  /** A qualifier set beside the time, such as the sunrise being tomorrow's. */
  note?: string;
  className: string;
}> = ({ icon, label, note, className }) => {
  const wall = useWallDisplay();
  return (
    <div className={`flex items-center gap-1.5 ${wall ? 'text-2xl' : 'text-sm sm:text-base'} ${className}`}>
      {icon}
      <span className="font-semibold text-ink">{label}</span>
      {note && <span className={`${wall ? 'text-base' : 'text-xs'} font-semibold uppercase tracking-wide text-ink-3`}>{note}</span>}
    </div>
  );
};

/**
 * The date, written out in full where there is room for it and shortened to
 * "Sep 20" where there is not. Measured rather than switched at a breakpoint:
 * whether it fits depends on the length of the month's name as much as on the
 * width of the bar, and a wrapped date would push the row out of line.
 */
const FittedDate: React.FC<{ long: string; short: string; className: string }> = ({ long, short, className }) => {
  const slot = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const el = slot.current;
    const full = probe.current;
    if (!el || !full) return;
    // The probe always holds the long form, so what is measured never depends on
    // what was last chosen and the two cannot oscillate.
    const measure = () => setFits(full.getBoundingClientRect().width <= el.getBoundingClientRect().width + 0.5);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [long]);

  return (
    <div ref={slot} className={`relative min-w-0 ${className}`}>
      <span className="whitespace-nowrap">{fits ? long : short}</span>
      <span ref={probe} aria-hidden="true" className="invisible absolute left-0 top-0 whitespace-nowrap">{long}</span>
    </div>
  );
};

/**
 * Slim full-width bar: sunrise, day, time, date and sunset across one row, with
 * progress through the current stretch of daylight or darkness docked along the
 * bottom edge. The sunrise and sunset keep their places either way — a fixed
 * layout is easier to read at a glance across a room than one that reorders
 * itself at dusk.
 */
export const ClockDaylightTile: React.FC<ClockDaylightTileProps> = ({ timezone, days }) => {
  const now = useNow();
  const wall = useWallDisplay();

  const { hourMinute, meridiem, zone } = clockParts(now, timezone);
  const weekday = formatInZone(now, timezone, { weekday: 'long' });
  const dateLong = formatInZone(now, timezone, { month: 'long', day: 'numeric' });
  const dateShort = formatInZone(now, timezone, { month: 'short', day: 'numeric' });
  const time = (unix: number) => formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' });

  const phase = sunPhase(days, now.getTime() / 1000, timezone);

  return (
    <div className={`tile relative overflow-hidden px-5 ${wall ? 'pt-4 pb-5' : 'pt-3 pb-3'} flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-0`}>
      <div className={`sm:flex-1 sm:order-3 text-center ${wall ? 'text-4xl' : 'text-xl sm:text-2xl'} font-bold text-ink leading-none`}>{weekday}</div>

      {phase && <Divider order="sm:order-2" />}
      <Divider order="sm:order-4" />

      <div className="sm:flex-1 sm:order-5 flex items-baseline justify-center gap-1.5">
        <span className={`${wall ? 'text-7xl' : 'text-4xl sm:text-5xl'} font-black text-ink leading-none tabular-nums`}>{hourMinute}</span>
        {meridiem && <span className={`${wall ? 'text-3xl' : 'text-lg sm:text-xl'} font-bold text-ink-2 leading-none`}>{meridiem}</span>}
        {/* Station time, which a viewer somewhere else needs told. */}
        {zone && <span className={`${wall ? 'text-xl' : 'text-xs sm:text-sm'} font-semibold text-ink-3 leading-none`}>{zone}</span>}
      </div>

      <Divider order="sm:order-6" />
      {phase && <Divider order="sm:order-8" />}

      <FittedDate
        long={dateLong}
        short={dateShort}
        className={`sm:flex-1 sm:order-7 text-center ${wall ? 'text-4xl' : 'text-xl sm:text-2xl'} font-bold text-ink leading-none`}
      />

      {/* A left/right pair sitting just above the progress bar on narrow screens. On wide ones
          `contents` drops the two times straight into the row, where `order` sends them to the ends. */}
      {phase && (
        <div className="w-full flex items-center justify-between sm:contents">
          <SunTime
            icon={<Sunrise className={`${wall ? 'w-7 h-7' : 'w-4 h-4'} text-sunrise shrink-0`} />}
            label={time(phase.sunrise)}
            note={phase.sunriseIsNextDay ? 'Tomorrow' : undefined}
            className="sm:flex-1 sm:order-1 sm:justify-center sm:self-end"
          />
          <SunTime
            icon={<Sunset className={`${wall ? 'w-7 h-7' : 'w-4 h-4'} text-sunset shrink-0`} />}
            label={time(phase.sunset)}
            className="sm:flex-1 sm:order-9 sm:justify-center sm:self-end"
          />
        </div>
      )}

      {phase && (
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-well">
          <div
            className={`h-full transition-all duration-1000 ${phase.isDay ? 'daylight-bar' : 'night-bar'}`}
            style={{ width: `${phase.progress}%` }}
          />
        </div>
      )}
    </div>
  );
};
