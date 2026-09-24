import React from 'react';
import { AlertCard } from './AlertCard';
import type { WeatherAlert } from '../../types/weather';

/**
 * The narrowest an alert bar may be squeezed before its event name stops
 * reading. Columns are packed to this rather than to breakpoints, so the row
 * fits as many as the screen can genuinely hold: fixed breakpoints kept the
 * bars far wider than they needed to be, and left room going spare.
 *
 * auto-fit collapses the tracks it does not use, so a lone alert still spreads
 * to the full width and two still split it in half.
 */
const ALERT_MIN_WIDTH_PX = 260;

interface AlertsBannerProps {
  /** Only the alerts still on show: the caller decides what has been closed. */
  alerts: WeatherAlert[];
  timezone: string | null;
  onDismiss: (id: string) => void;
}

/**
 * National Weather Service alerts, above the widget grid rather than inside it.
 * A warning is not something the viewer should have had to switch on ahead of
 * time, so this is deliberately not a widget and cannot be toggled off. It
 * renders nothing at all when nothing is in effect.
 *
 * A viewer who has read an alert can close its bar. That only hides the bar:
 * the alert still counts in the header, which is how it is brought back.
 */
export const AlertsBanner: React.FC<AlertsBannerProps> = ({ alerts, timezone, onDismiss }) => {
  if (alerts.length === 0) return null;

  return (
    // items-start so a card someone has opened grows on its own, rather than
    // stretching its neighbours into tall empty boxes.
    <div
      className="grid items-start gap-3"
      // min() keeps a single column from overflowing a screen narrower than the floor.
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${ALERT_MIN_WIDTH_PX}px, 100%), 1fr))` }}
      role="region"
      aria-label="Active weather alerts"
    >
      {alerts.map(alert => (
        <AlertCard key={alert.id} alert={alert} timezone={timezone} autoCollapse onDismiss={() => onDismiss(alert.id)} />
      ))}
    </div>
  );
};
