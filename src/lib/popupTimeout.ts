import { useSyncExternalStore } from 'react';

/**
 * How long a detail popup waits with nobody touching the screen before it
 * closes itself. A choice about the screen, like the theme and units, so it is
 * kept in this browser: a wall panel wants its popups gone quickly, a phone in
 * the hand can leave them up longer.
 */
export const POPUP_TIMEOUT_OPTIONS = [
  { seconds: 15, label: '15s' },
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1 min' },
  { seconds: 120, label: '2 min' },
  { seconds: 300, label: '5 min' },
] as const;

const STORAGE_KEY = 'weatherdash_popup_timeout';
const DEFAULT_SECONDS = 60;
const CHANGE_EVENT = 'weatherdash:popup-timeout';

function read(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (POPUP_TIMEOUT_OPTIONS.some(o => o.seconds === stored)) return stored;
  } catch { /* storage unavailable */ }
  return DEFAULT_SECONDS;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** The chosen timeout, in seconds. */
export function usePopupTimeout(): number {
  return useSyncExternalStore(subscribe, read);
}

export function setPopupTimeout(seconds: number) {
  try { localStorage.setItem(STORAGE_KEY, String(seconds)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
