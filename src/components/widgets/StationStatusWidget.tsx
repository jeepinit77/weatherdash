import React from 'react';
import { Activity } from 'lucide-react';
import { TileHeader, TileStats } from '../tiles/TileParts';
import { STALE_AFTER_MINUTES, fmt, minutesSince, timeAgo } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useUnits } from '../../lib/units';
import { useWallDisplay } from '../../lib/wallDisplay';
import type { Reading, StationInfo } from '../../types/weather';

interface StationStatusWidgetProps {
  station: StationInfo;
  reading: Reading;
}

export const StationStatusWidget: React.FC<StationStatusWidgetProps> = ({ station, reading }) => {
  const units = useUnits();
  const wall = useWallDisplay();
  // Keeps "3 min ago" and the reporting state current between readings.
  useNow(30_000);

  const age = minutesSince(reading.date);
  const isStale = age === null || age > STALE_AFTER_MINUTES;
  const statusTone = isStale ? 'text-warn-text' : 'text-good-text';
  const status = isStale ? 'Offline' : 'Online';

  // A wall display gets one line it can read from across the room; the rest is for up close.
  if (wall) {
    return (
      <div className="tile px-6 py-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
        <Activity className={`w-8 h-8 shrink-0 ${statusTone}`} aria-hidden="true" />
        <span className={`text-3xl font-black ${statusTone}`}>{status}</span>
        <span className="text-2xl font-semibold text-ink-2">Last reading {timeAgo(reading.date)}</span>
      </div>
    );
  }

  // Ambient reports battout as 1 = OK, 0 = low
  const battery = reading.battout === null ? null : reading.battout >= 1 ? 'OK' : 'Low — replace';
  const batteryLow = reading.battout !== null && reading.battout < 1;
  const hasIndoor = reading.tempinf !== null || reading.humidityin !== null;

  return (
    <div className="tile p-5 flex flex-col items-center">
      <TileHeader icon={Activity} label="Station Status" />

      {/* A pill, not a headline, so it doesn't read as the tile's title. */}
      <span
        role="status"
        className={`mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-bold ${
          isStale ? 'bg-warn-soft text-warn-text border-warn-line' : 'bg-good-soft text-good-text border-good-line'
        }`}
      >
        <span className={`w-2 h-2 rounded-full bg-current ${isStale ? '' : 'animate-pulse motion-reduce:animate-none'}`} aria-hidden="true" />
        {status}
      </span>

      <TileStats
        className="mt-4"
        stats={[
          { label: 'Last reading', value: timeAgo(reading.date) },
          battery !== null && {
            label: 'Outdoor battery',
            value: <span className={batteryLow ? 'text-danger-text' : undefined}>{battery}</span>,
          },
          hasIndoor && {
            label: 'Indoor',
            value: `${fmt(units.temp(reading.tempinf), 0, '°')} · ${fmt(reading.humidityin, 0, '%')}`,
          },
          { label: 'Visibility', value: station.isPublic ? 'Public' : 'Unlisted' },
        ]}
      />
    </div>
  );
};
