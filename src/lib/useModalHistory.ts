import { useEffect, useId, useRef } from 'react';

/**
 * Makes the browser's or phone's Back button close a popup instead of
 * navigating the page behind it. A dummy history entry is pushed while the
 * popup is open (the URL itself never changes), so Back lands on it and
 * closing fires here instead of leaving the page.
 *
 * If the popup closes some other way (its own Close button, Escape, a click
 * outside, an idle timeout), the entry is popped again on the way out, so
 * Back afterwards behaves as if the popup had never been there. That pop is
 * skipped once the entry is no longer on top — the page navigated on while
 * the popup was open — so this can never override where navigation actually
 * sent the browser.
 *
 * `onClose` may return false to refuse (a form with unsaved changes asking
 * first). Back has already used up the entry by then, so it is pushed again,
 * and the next Back asks again rather than leaving the page.
 */
export function useModalHistory(onClose: () => void | boolean) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // One id for the life of this popup, however many times the effect below
  // runs: React's Strict Mode mounts, cleans up and mounts every effect again
  // on its first real mount, purely to test that the cleanup is correct. A
  // fresh id every run would push a second, throwaway entry during that
  // rehearsal; a stable one lets the second mount recognise its own entry is
  // already there and leave it alone.
  const id = useId();
  // How many times this popup is currently mounted: 1 in the ordinary case,
  // briefly 0-then-1-again during Strict Mode's rehearsal, and settles at 0
  // once it is genuinely gone. The deferred check below reads this to tell
  // "still open" apart from "really closing" once everything has settled.
  const mountCountRef = useRef(0);
  const pushedRef = useRef(false);

  useEffect(() => {
    mountCountRef.current += 1;
    if (!pushedRef.current) {
      pushedRef.current = true;
      window.history.pushState({ ...(window.history.state as object | null), weatherdashModal: id }, '');
    }

    let closedByBack = false;
    const onPopState = () => {
      closedByBack = true;
      if (onCloseRef.current() === false) {
        closedByBack = false;
        window.history.pushState({ ...(window.history.state as object | null), weatherdashModal: id }, '');
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
      mountCountRef.current -= 1;
      if (closedByBack) return;
      // Deferred a tick, so Strict Mode's rehearsal mount (synchronous,
      // immediately after this) has already run and put the count back to 1
      // by the time this checks it.
      queueMicrotask(() => {
        if (mountCountRef.current > 0) return;
        const state = window.history.state as { weatherdashModal?: string } | null;
        if (state?.weatherdashModal === id) window.history.back();
      });
    };
    // id never changes for this instance (useId), so the effect need not restart on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
