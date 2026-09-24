import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, MapPin, X } from 'lucide-react';
import { AUTO_COLLAPSE_MS, expandOnSight, paragraphs, stripeFor, styleFor, whenText } from './alertText';
import type { WeatherAlert } from '../../types/weather';

const Prose: React.FC<{ text: string }> = ({ text }) => (
  <>
    {paragraphs(text).map((line, i) => (
      <p key={i} className={`text-sm text-ink-2 leading-relaxed ${line.startsWith('-') ? 'pl-4' : ''}`}>
        {line.replace(/^[*-]\s/, '')}
      </p>
    ))}
  </>
);

interface AlertCardProps {
  alert: WeatherAlert;
  timezone: string | null;
  /** Omitted in the reading panel, where closing a bar would make no sense. */
  onDismiss?: () => void;
  /** Opened from the start, for the panel the viewer opened in order to read. */
  startExpanded?: boolean;
  /** Lets a card that opened itself fold away again, for an unattended dashboard. */
  autoCollapse?: boolean;
  /** 'bar' is the standalone card above the grid; 'listed' sits inside the panel. */
  variant?: 'bar' | 'listed';
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, timezone, onDismiss, startExpanded, autoCollapse, variant = 'bar' }) => {
  const style = styleFor(alert.severity);
  const [expanded, setExpanded] = useState(() => startExpanded || expandOnSight(alert));
  // Once the viewer has worked the card themselves, it stays how they left it.
  const [viewerDecides, setViewerDecides] = useState(false);

  useEffect(() => {
    if (!autoCollapse || viewerDecides || !expanded) return;
    const timer = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [autoCollapse, viewerDecides, expanded]);

  const when = whenText(alert, timezone, new Date());
  // The headline repeats the event and its times, so it is only worth showing
  // when the office wrote no description to show in its place.
  const body = alert.description ?? alert.headline;
  const hasDetail = body !== null || alert.instruction !== null;

  return (
    <div className={`overflow-hidden flex ${variant === 'bar' ? 'tile' : 'rounded-xl bg-well border border-line-soft'}`}>
      <div className={`w-3 shrink-0 ${stripeFor(alert.urgency)}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 p-4">
        <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => { setViewerDecides(true); setExpanded(!expanded); }}
          disabled={!hasDetail}
          aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-start gap-3 text-left disabled:cursor-default"
        >
          <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${style.accent}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
              <h3 className="text-base font-semibold text-ink">{alert.event ?? 'Weather alert'}</h3>
              {alert.severity && (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${style.badge}`}>
                  {alert.severity}
                </span>
              )}
              {alert.urgency && <span className="sr-only">Urgency: {alert.urgency}.</span>}
              {when && <span className="text-xs text-ink-3">{when}</span>}
            </div>
            {alert.areaDesc && (
              <p className="text-xs text-ink-3 mt-1 flex items-start gap-1.5">
                <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                <span className={expanded ? '' : 'line-clamp-1'}>{alert.areaDesc}</span>
              </p>
            )}
          </div>
          {hasDetail &&
            (expanded ? (
              <ChevronUp className="w-4 h-4 shrink-0 text-ink-3" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0 text-ink-3" />
            ))}
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss this alert"
            aria-label={`Dismiss the ${alert.event ?? 'weather'} alert`}
            className="shrink-0 p-1 rounded-md text-ink-4 hover:text-ink hover:bg-fill transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        </div>

        {expanded && hasDetail && (
          <div className="mt-3 pt-3 border-t border-line space-y-2">
            {body && <Prose text={body} />}
            {alert.instruction && (
              <div className="mt-3 pt-3 border-t border-line-soft space-y-2">
                <h4 className={`text-xs font-semibold uppercase tracking-wide ${style.accent}`}>What to do</h4>
                <Prose text={alert.instruction} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
