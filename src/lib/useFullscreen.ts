import { useCallback, useEffect, useState } from 'react';

interface WakeLock {
  release: () => Promise<void>;
}

/**
 * Full-screen wall-display mode.
 *
 * Uses the browser's own full screen where it is allowed, and still hides the
 * page chrome when it isn't (iOS Safari has no Fullscreen API). While it is on,
 * the screen is kept awake if the browser supports wake locks.
 */
export function useFullscreen() {
  const [active, setActive] = useState(false);

  // Leaving full screen with Esc or the browser's own control must also restore the chrome.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setActive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Where the browser refused real full screen (or has none, as on iOS), Esc
  // would otherwise do nothing. An open popup gets the key first.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.fullscreenElement) return;
      if (document.querySelector('[data-modal-panel]')) return;
      setActive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    let lock: WakeLock | null = null;
    let released = false;

    const acquire = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } })
          .wakeLock?.request('screen') ?? null;
        if (released) void lock?.release().catch(() => {});
      } catch {
        // Wake locks are unsupported or blocked; full screen still works.
      }
    };
    // A wake lock is dropped when the tab is hidden, so take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);

  // The layout is driven by our own state, so it is set first and never waits on the browser:
  // a request that is refused, unsupported, or simply never answered must not strand the view.
  const enter = useCallback(() => {
    setActive(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  return { active, enter, exit };
}
