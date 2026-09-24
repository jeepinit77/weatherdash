import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { styleFor } from './alertText';
import type { WeatherAlert } from '../../types/weather';

interface AlertsCountButtonProps {
  alerts: WeatherAlert[];
  onClick: () => void;
  /** 'header' sits among the dashboard controls; 'floating' rides over full-screen content. */
  variant: 'header' | 'floating';
}

/**
 * How many alerts are in effect, counting the ones whose bars have been closed.
 * Opens them for reading; closing a bar is the viewer's decision and this never
 * undoes it. Coloured by the most serious alert of the set.
 */
export const AlertsCountButton: React.FC<AlertsCountButtonProps> = ({ alerts, onClick, variant }) => {
  if (alerts.length === 0) return null;

  // The API returns them most serious first, so the first one sets the tone.
  const style = styleFor(alerts[0].severity ?? null);
  const noun = alerts.length === 1 ? 'alert' : 'alerts';
  const label = `Read ${alerts.length} active ${noun}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${
        variant === 'floating'
          ? `backdrop-blur hover:brightness-110 ${style.badge}`
          : 'glass-button text-ink-2 hover:text-ink'
      }`}
    >
      <AlertTriangle className={`w-4 h-4 ${variant === 'floating' ? '' : style.accent}`} />
      <span className="font-bold">{alerts.length}</span>
      <span className={`hidden font-medium capitalize ${variant === 'floating' ? 'sm:inline' : 'xl:inline'}`}>{noun}</span>
    </button>
  );
};
