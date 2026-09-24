import { useEffect, useRef } from 'react';

/**
 * Runs `fn` now and then every `intervalMs` while the page is visible.
 *
 * A background tab asks for nothing; when it comes back into view it catches
 * up at once if a tick was missed, rather than showing old numbers until the
 * next one. Changing any of `deps` restarts the cycle with an immediate run.
 *
 * `fn` is read through a ref, so it may be a fresh closure every render.
 */
export function useVisiblePolling(fn: () => void, intervalMs: number, deps: readonly unknown[] = []) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    let lastRun = 0;
    const run = () => {
      lastRun = Date.now();
      fnRef.current();
    };
    const tick = () => { if (document.visibilityState === 'visible') run(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun >= intervalMs) run();
    };

    run();
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // The caller's deps decide when to restart; fn is deliberately excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
