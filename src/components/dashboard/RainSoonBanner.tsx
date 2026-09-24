import React from 'react';
import { CloudRain, CloudSun, X } from 'lucide-react';
import { formatInZone } from '../../lib/format';
import { isWetStep, type RainOutlook } from '../../lib/rainOutlook';

interface RainSoonBannerProps {
  outlook: RainOutlook;
  timezone: string | null;
  nowUnix: number;
  /** Full-screen wall display: larger type, no dismiss button. */
  wall: boolean;
  /** Absent on the wall, where the banner simply lapses on its own. */
  onDismiss?: () => void;
}

/**
 * A slim heads-up above the dashboard: rain on its way, or about to stop. It
 * never covers anything and needs nobody to clear it; it goes when the change
 * it announces has happened or the outlook drops it.
 */
export const RainSoonBanner: React.FC<RainSoonBannerProps> = ({ outlook, timezone, nowUnix, wall, onDismiss }) => {
  const minutes = Math.max(0, Math.round((outlook.at - nowUnix) / 60 / 5) * 5);
  const clock = formatInZone(new Date(outlook.at * 1000), timezone, { hour: 'numeric', minute: '2-digit' });
  const soon = minutes <= 5;
  const headline = outlook.kind === 'start'
    ? (soon ? `${outlook.intensity} rain starting any minute` : `${outlook.intensity} rain likely from about ${clock}`)
    : (soon ? 'Rain should ease off any minute' : `Rain should ease off around ${clock}`);
  const most = Math.max(0.05, ...outlook.steps.map(s => s.precip ?? 0));
  const Icon = outlook.kind === 'start' ? CloudRain : CloudSun;

  return (
    <div
      role="status"
      className={`rounded-2xl border border-info-line bg-info-soft text-info-text flex items-center gap-3 sm:gap-4 ${wall ? 'px-6 py-4' : 'px-4 py-2.5'}`}
    >
      <Icon className={`${wall ? 'w-10 h-10' : 'w-6 h-6'} shrink-0`} />
      <div className="min-w-0 flex-1">
        <div className={`${wall ? 'text-3xl' : 'text-sm sm:text-base'} font-bold text-ink leading-tight`}>{headline}</div>
        {!soon && !wall && <div className="text-xs text-ink-3">in about {minutes} min · short-range forecast by Open-Meteo</div>}
      </div>

      {/* The next two hours, a bar for each quarter hour. */}
      <div className={`hidden sm:flex items-end gap-0.5 ${wall ? 'h-12' : 'h-8'}`} aria-hidden="true">
        {outlook.steps.map(s => (
          <span
            key={s.time}
            className="w-2.5 rounded-sm bg-info"
            style={{ height: `${Math.max(8, ((s.precip ?? 0) / most) * 100)}%`, opacity: isWetStep(s) ? 0.9 : 0.2 }}
            title={formatInZone(new Date(s.time * 1000), timezone, { hour: 'numeric', minute: '2-digit' })}
          />
        ))}
      </div>

      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-fill-soft shrink-0">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
