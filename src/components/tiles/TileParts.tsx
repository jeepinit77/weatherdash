import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { useWallDisplay } from '../../lib/wallDisplay';

/**
 * The pieces every dashboard card is built from, so they read as one set: a
 * header with a muted icon on the left and an all-caps label on the right, and
 * a footer of centred stat columns split by thin rules.
 *
 * On a wall display each piece grows to stay legible across a room.
 */

export const TileHeader: React.FC<{
  /** Null keeps the icon's space, so the label does not jump when an icon comes and goes. */
  icon: LucideIcon | null;
  label: string;
}> = ({ icon: Icon, label }) => {
  const wall = useWallDisplay();
  const iconSize = wall ? 'w-8 h-8' : 'w-6 h-6';
  return (
    <div className="w-full flex items-start justify-between gap-3">
      {Icon ? <Icon className={`${iconSize} text-ink-2 shrink-0`} aria-hidden="true" /> : <span className={iconSize} />}
      <div className={`${wall ? 'text-base' : 'text-xs'} font-bold text-ink-3 tracking-[0.2em] uppercase text-right`}>
        {label}
      </div>
    </div>
  );
};

export interface TileStat {
  label: string;
  value: React.ReactNode;
  /** A hover explanation, for a caption that has to stay short. */
  title?: string;
}

/** Centred stat columns, each a muted caption over a bold value, with rules between them. */
export const TileStats: React.FC<{
  /** Falsy entries are skipped, so a column can be left out inline. */
  stats: (TileStat | null | false)[];
  className?: string;
}> = ({ stats, className = 'mt-3' }) => {
  const wall = useWallDisplay();
  const shown = stats.filter((s): s is TileStat => Boolean(s));
  if (shown.length === 0) return null;
  return (
    <div className={`w-full flex flex-wrap items-center justify-center text-center gap-y-3 ${wall ? 'gap-x-6' : 'gap-x-4'} ${className}`}>
      {shown.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <div className="self-stretch w-px bg-fill-strong" />}
          <div className="min-w-0" title={stat.title}>
            <div className={`${wall ? 'text-base' : 'text-xs'} text-ink-3`}>{stat.label}</div>
            <div className={`${wall ? 'text-3xl' : 'text-xl'} font-bold text-ink leading-tight`}>{stat.value}</div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};
