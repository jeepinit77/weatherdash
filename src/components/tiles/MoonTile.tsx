import React from 'react';
import { Moon, MoonStar } from 'lucide-react';
import { MoonPhoto } from './MoonPhoto';
import { TileHeader, TileStats } from './TileParts';
import { formatInZone } from '../../lib/format';
import { moonNow, moonTimesToday, phaseName, upcomingPhases } from '../../lib/moon';
import { useNow } from '../../lib/useNow';
import { useWallDisplay } from '../../lib/wallDisplay';

interface MoonTileProps {
  timezone: string | null;
  /** Rounded station coordinates; without them there are no rise and set times. */
  lat: number | null;
  lon: number | null;
}

export const MoonTile: React.FC<MoonTileProps> = ({ timezone, lat, lon }) => {
  const wall = useWallDisplay();
  const now = useNow(60_000);
  const nowUnix = now.getTime() / 1000;
  const moon = moonNow(nowUnix, lat, lon);
  const times = lat !== null && lon !== null ? moonTimesToday(nowUnix, timezone, lat, lon) : null;
  const next = upcomingPhases(nowUnix).find(p => p.key === 'full' || p.key === 'new')!;
  const clock = (unix: number | null) => (unix === null ? '—' : formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' }));
  const days = Math.round((next.time - nowUnix) / 86400);
  const nextWhen = days <= 0 ? 'Tonight' : days === 1 ? 'Tomorrow' : formatInZone(new Date(next.time * 1000), timezone, { month: 'short', day: 'numeric' });

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={MoonStar} label="Moon" />

      <div className="flex-1 w-full flex flex-col items-center justify-center py-2">
        <MoonPhoto southern={(lat ?? 0) < 0} className={`${wall ? 'w-44 h-44' : 'w-32 h-32'} shadow-[0_0_24px_rgba(251,248,238,0.12)]`} />
        <div className={`mt-3 ${wall ? 'text-3xl' : 'text-xl'} font-bold text-ink leading-tight text-center`}>{phaseName(moon.phase)}</div>
        <div className={`${wall ? 'text-lg' : 'text-sm'} text-ink-3`}>{Math.round(moon.fraction * 100)}% lit</div>
      </div>

      <TileStats
        stats={[
          times && { label: 'Rises', value: clock(times.rise) },
          times && { label: 'Sets', value: clock(times.set) },
          { label: next.key === 'full' ? 'Full moon' : 'New moon', value: nextWhen },
        ]}
      />
      {!times && !wall && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-ink-4"><Moon className="w-3 h-3" /> Rise and set need the station’s location.</div>
      )}
    </div>
  );
};
