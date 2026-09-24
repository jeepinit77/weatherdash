import { useEffect, useRef } from 'react';

/**
 * Closes something after the viewer has gone quiet for `ms`. Any input resets
 * the clock. Pass `active: false` to hold it open (a pinned popup, say).
 *
 * Exists for the wall dashboard: nobody stands at it, so an overlay that only
 * a click can close would cover the weather until someone walked over.
 */
export function useIdleClose(active: boolean, ms: number, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(() => onCloseRef.current(), ms);
    const reset = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => onCloseRef.current(), ms);
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [active, ms]);
}
