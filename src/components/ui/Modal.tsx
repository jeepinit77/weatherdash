import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../lib/useScrollLock';
import { useIdleClose } from '../../lib/useIdleClose';
import { useModalHistory } from '../../lib/useModalHistory';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** May return false to stay open, e.g. to ask about unsaved changes first. */
  onClose: () => void | boolean;
  /** Accessible name, when there is no visible heading to point at. */
  label?: string;
  /** Id of the visible heading that names the dialog. */
  labelledBy?: string;
  /** Classes for the panel itself. The shell supplies the backdrop and centring. */
  className?: string;
  /** Close by itself after this long without input. Omit to stay open. */
  idleCloseMs?: number;
  children: React.ReactNode;
}

/**
 * The one shell every popup uses: a dimmed backdrop that closes on click,
 * Escape to close, the page held still behind it, keyboard focus kept inside
 * while it is open and handed back to whatever opened it afterwards.
 *
 * Rendered at the end of the body, so a popup opened from inside something
 * with a blur or transform (the header) still covers the whole screen.
 */
export const Modal: React.FC<ModalProps> = ({ onClose, label, labelledBy, className = '', idleCloseMs, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useScrollLock();
  useIdleClose(idleCloseMs !== undefined, idleCloseMs ?? 0, onClose);
  // So the phone's or browser's Back button closes this instead of leaving the page.
  useModalHistory(onClose);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the panel rather than its first control, so a screen reader starts
    // at the title and a stray Enter does not press the first button.
    panel?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only the topmost dialog answers, so Escape peels one layer at a time.
        const dialogs = document.querySelectorAll('[data-modal-panel]');
        if (dialogs[dialogs.length - 1] === panel) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        data-modal-panel
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`outline-none max-h-[90vh] overflow-y-auto overscroll-contain ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
