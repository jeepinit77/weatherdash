import { useEffect, useState } from 'react';

/**
 * True once the viewer has gone quiet for `delayMs` while `active`. Any input
 * brings it straight back to false. Used to get the full-screen header out of
 * the way of a wall dashboard.
 */
export function useIdleHidden(active: boolean, delayMs: number): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(() => setHidden(true), delayMs);
    const wake = () => {
      setHidden(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setHidden(true), delayMs);
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'wheel'];
    events.forEach(event => window.addEventListener(event, wake, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(event => window.removeEventListener(event, wake));
      // Next time full screen starts, the header starts visible.
      setHidden(false);
    };
  }, [active, delayMs]);

  return active && hidden;
}
