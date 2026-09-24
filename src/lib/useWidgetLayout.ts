import { useState } from 'react';
import { ALL_WIDGETS, mergeLayout, normalizeLayout, serializeLayout } from './widgets';
import type { LayoutItem } from '../types/weather';

/**
 * Which widgets this browser shows for a station, in what order and in which
 * rows of tiles. A display preference, so it lives in local storage per
 * station. A signed-in viewer can also save layouts to their account by name,
 * but those only ever arrive here when picked in the editor.
 */
export function useWidgetLayout(slug: string) {
  const storageKey = `weatherdash_widgets_${slug}`;
  const [widgets, setWidgets] = useState<LayoutItem[]>(() => {
    try {
      return mergeLayout(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
    } catch {
      return ALL_WIDGETS;
    }
  });

  const save = (next: LayoutItem[]) => {
    const tidy = normalizeLayout(next);
    setWidgets(tidy);
    try { localStorage.setItem(storageKey, JSON.stringify(serializeLayout(tidy))); } catch { /* storage unavailable */ }
  };

  return {
    widgets,
    /** Replace the whole layout: order, on/off and tile rows together. */
    set: save,
  };
}
