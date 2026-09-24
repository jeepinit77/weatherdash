import React from 'react';
import { X } from 'lucide-react';
import { AlertCard } from './AlertCard';
import { POPUP_TIMEOUT_OPTIONS } from '../../lib/popupTimeout';
import { Modal } from '../ui/Modal';
import type { WeatherAlert } from '../../types/weather';

interface AlertsModalProps {
  alerts: WeatherAlert[];
  timezone: string | null;
  onClose: () => void;
  /**
   * Close by itself after this long without input. Set on the wall dashboard,
   * where nobody is standing by to close the panel and the weather behind it
   * must come back on its own.
   */
  idleCloseMs?: number;
}

/**
 * Every alert in effect, open for reading. This is where a dismissed warning
 * stays reachable: closing its bar clears it off the dashboard, it does not
 * throw the alert away.
 */
export const AlertsModal: React.FC<AlertsModalProps> = ({ alerts, timezone, onClose, idleCloseMs }) => {
  const noun = alerts.length === 1 ? 'alert' : 'alerts';

  return (
    <Modal onClose={onClose} labelledBy="alerts-modal-title" idleCloseMs={idleCloseMs} className="tile w-full max-w-3xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 id="alerts-modal-title" className="text-xl font-bold text-ink">
          {alerts.length} active weather {noun}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 p-2 rounded-lg bg-fill-soft border border-line text-ink-2 hover:bg-fill transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {idleCloseMs !== undefined && (
        <p className="text-xs text-ink-3 -mt-2 mb-3">
          Closes by itself after {POPUP_TIMEOUT_OPTIONS.find(o => o.seconds * 1000 === idleCloseMs)?.label ?? `${Math.round(idleCloseMs / 1000)}s`} without input.
        </p>
      )}
      <div className="space-y-3">
        {alerts.map(alert => (
          <AlertCard key={alert.id} alert={alert} timezone={timezone} startExpanded variant="listed" />
        ))}
      </div>
    </Modal>
  );
};
