import { useEffect } from 'react';

// Shared by every overlay on the page, so the count and the styles to put back
// live at module scope rather than in any one of them.
let locks = 0;
let restore: { overflow: string; paddingRight: string } | null = null;

/**
 * Holds the page still while an overlay is open, so the wheel and touch
 * scrolling a popup receives never reaches the dashboard behind it.
 *
 * Counted rather than a plain on/off flag: overlays can sit on top of one
 * another (an alert opened over a forecast day, say), and the page must stay
 * locked until the last of them closes.
 *
 * Takes `active` so a modal that returns null when it is closed can still call
 * this at the top of its body, where the rules of hooks need it.
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;

    const body = document.body;
    if (locks === 0) {
      restore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      // Hiding the scrollbar hands its width back to the layout, which would shift
      // the whole dashboard sideways behind the popup; pad by the same amount.
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      if (gutter > 0) body.style.paddingRight = `${gutter}px`;
      body.style.overflow = 'hidden';
    }
    locks += 1;

    return () => {
      locks -= 1;
      if (locks === 0 && restore) {
        body.style.overflow = restore.overflow;
        body.style.paddingRight = restore.paddingRight;
        restore = null;
      }
    };
  }, [active]);
}
