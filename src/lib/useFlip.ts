import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** A child's layout box, relative to the container, without any animation applied. */
export interface FlipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Glides the container's `[data-flip-id]` children from where they were to where
 * a re-render put them, instead of letting them jump. Runs whenever `key`
 * changes, and picks up from mid-flight if a second change lands before the
 * first has settled.
 *
 * Returns each child's resting box, which hit-testing should use: a box read
 * from the DOM mid-glide is somewhere in between.
 */
export function useFlip(container: RefObject<HTMLElement | null>, key: unknown) {
  const rects = useRef(new Map<string, FlipRect>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, FlipRect>();

    root.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
      const id = el.dataset.flipId!;
      const prev = rects.current.get(id);
      // Where the element is drawn right now, part-way through any earlier glide.
      const current = getComputedStyle(el).transform;
      const drift = current && current !== 'none' ? new DOMMatrixReadOnly(current) : null;

      el.style.transition = 'none';
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const rest = { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height };
      next.set(id, rest);
      if (!prev || still) return;

      const dx = prev.left + (drift?.e ?? 0) - rest.left;
      const dy = prev.top + (drift?.f ?? 0) - rest.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // commit the start position before easing away from it
      el.style.transition = 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      el.style.transform = '';
    });

    rects.current = next;
  }, [container, key]);

  return rects;
}
