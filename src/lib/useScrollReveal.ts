import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Where a scroll-away header should be drawn.
 * - 'inline': in the page flow, scrolling away with everything else.
 * - 'shown': pinned to the top of the window, because the viewer scrolled back up.
 * - 'hidden': pinned but slid out of view, because the viewer is reading further down.
 */
export type RevealMode = 'inline' | 'shown' | 'hidden';

/** Scroll movement smaller than this is jitter from a trackpad, not a change of direction. */
const DIRECTION_THRESHOLD_PX = 6;

/**
 * Lets a header scroll off with the page and slide back in as soon as the
 * viewer starts scrolling up. Once the page has scrolled past the header's
 * height it is out of sight, so pinning it (still hidden) changes nothing on screen.
 */
export function useScrollReveal(header: RefObject<HTMLElement | null>): { mode: RevealMode; animate: boolean } {
  const [state, setState] = useState<{ mode: RevealMode; animate: boolean }>({ mode: 'inline', animate: false });
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Read on every pass: the bar wraps differently as the window resizes.
      const height = header.current?.offsetHeight ?? 0;
      const dy = y - lastY.current;
      setState(prev => {
        // Back at the top the header is where it always was, pinned or not.
        if (y <= 0) return prev.mode === 'inline' ? prev : { mode: 'inline', animate: false };
        if (prev.mode === 'inline') {
          // Swap to pinned only once the inline header is out of sight, and
          // without a transition, so it does not visibly slide away.
          return y > height ? { mode: 'hidden', animate: false } : prev;
        }
        if (dy <= -DIRECTION_THRESHOLD_PX && prev.mode !== 'shown') return { mode: 'shown', animate: true };
        // While the top of the page is still in view the pinned header covers
        // the gap its inline place left, so it stays until that has scrolled by.
        if (dy >= DIRECTION_THRESHOLD_PX && y > height && prev.mode !== 'hidden') return { mode: 'hidden', animate: true };
        return prev;
      });
      if (Math.abs(dy) >= DIRECTION_THRESHOLD_PX || y <= 0) lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [header]);

  return state;
}
