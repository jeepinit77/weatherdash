import React from 'react';
import { TrendingUp } from 'lucide-react';
import { TileHeader } from '../tiles/TileParts';
import { CONTROLS_ROW, KEY_ROW, KEY_ROW_WALL, PLOT_HEIGHT, PLOT_HEIGHT_WALL } from './historyChartLayout';
import { useWallDisplay } from '../../lib/wallDisplay';

/** Stands in for the history chart, at its size, while the charting code downloads. */
export const HistoryChartSkeleton: React.FC = () => {
  const wall = useWallDisplay();
  return (
    <div className="tile p-5" aria-busy="true">
      <TileHeader icon={TrendingUp} label="History" />
      {!wall && <div className={`mt-4 ${CONTROLS_ROW}`} />}
      <div className={`mt-4 ${wall ? KEY_ROW_WALL : KEY_ROW}`} />
      <div className={`mt-2 ${wall ? PLOT_HEIGHT_WALL : PLOT_HEIGHT} rounded-xl bg-well animate-pulse`} />
    </div>
  );
};
