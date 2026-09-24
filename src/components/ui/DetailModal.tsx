import React, { useId, useState } from 'react';
import { Pin, PinOff, X } from 'lucide-react';
import { Modal } from './Modal';
import { usePopupTimeout } from '../../lib/popupTimeout';
import { useWallDisplay } from '../../lib/wallDisplay';

interface DetailModalProps {
  title: string;
  /** A line under the title, such as the date or where the figures come from. */
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * The popup a tile opens when tapped. It closes itself once nobody has touched
 * the screen for the viewer's chosen time. Outside full screen it can be pinned
 * open; a wall display has nobody to unpin it, so there it always closes.
 */
export const DetailModal: React.FC<DetailModalProps> = ({ title, subtitle, onClose, children }) => {
  const titleId = useId();
  const canPin = !useWallDisplay();
  const [pinned, setPinned] = useState(false);
  const seconds = usePopupTimeout();
  const holdOpen = canPin && pinned;

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      idleCloseMs={holdOpen ? undefined : seconds * 1000}
      // The tile surface, but as tall as its content rather than the tile's full height.
      className="tile !h-auto !max-h-[94vh] w-full max-w-5xl p-5 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-2xl sm:text-3xl font-black text-ink leading-tight">{title}</h2>
          {subtitle && <div className="text-sm text-ink-3 mt-1">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canPin && (
            <button
              type="button"
              onClick={() => setPinned(p => !p)}
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin (auto-close resumes)' : 'Pin (stay open)'}
              title={pinned ? 'Unpin (auto-close resumes)' : 'Pin (stay open)'}
              className={`p-2.5 rounded-lg border transition-colors ${
                pinned ? 'bg-warn-soft border-warn-line text-warn-text' : 'bg-fill-soft border-line text-ink-2 hover:bg-fill'
              }`}
            >
              {pinned ? <Pin className="w-5 h-5" /> : <PinOff className="w-5 h-5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="p-2.5 rounded-lg border border-line bg-fill-soft text-ink-2 hover:bg-fill transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      {children}
    </Modal>
  );
};

interface DetailStatProps {
  label: string;
  icon?: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
  note?: React.ReactNode;
}

/** One figure in a popup's headline row, sized to be read at a glance. */
export const DetailStat: React.FC<DetailStatProps> = ({ label, icon, value, tone = 'text-ink', note }) => (
  <div className="min-w-0">
    <div className="text-[0.65rem] font-bold text-ink-3 tracking-[0.2em] uppercase">{label}</div>
    <div className={`mt-1 flex items-center gap-2 text-2xl sm:text-[1.75rem] font-black leading-none ${tone}`}>
      {icon}
      {value}
    </div>
    {note && <div className="mt-1.5 text-xs font-semibold text-ink-3">{note}</div>}
  </div>
);

/** A wrapping row of DetailStats. */
export const DetailStats: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = 'mt-5' }) => (
  <div className={`grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-4 ${className}`}>{children}</div>
);

/** A small all-caps heading over a section of a popup. */
export const DetailSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-6">
    <div className="text-xs font-bold text-ink-3 tracking-[0.2em] uppercase mb-3">{title}</div>
    {children}
  </section>
);
