import { useSyncExternalStore } from 'react';

/**
 * Offering to install the dashboard as an app. Chrome, Edge and Android hand
 * over an install prompt the page can show on a click of its own; it arrives
 * once, often before React has drawn anything, so it is caught at startup and
 * kept here. Safari on iPhone and iPad has no prompt at all, only Share → Add
 * to Home Screen, so there the page can only say how.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Safari on iPhone or iPad, where installing is Share → Add to Home Screen. */
const iosSafari = () => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

/** Call once at startup, before the app renders. */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

type InstallState = 'prompt' | 'ios' | 'none';

function snapshot(): InstallState {
  if (installed || standalone()) return 'none';
  if (deferred) return 'prompt';
  return iosSafari() ? 'ios' : 'none';
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** 'prompt' when the browser can install on a click, 'ios' when only the manual route exists, else 'none'. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Shows the browser's own install dialog. */
export async function promptInstall() {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installed = true;
  notify();
}
