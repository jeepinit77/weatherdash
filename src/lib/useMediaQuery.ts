import { useCallback, useSyncExternalStore } from 'react';

/** Whether a media query matches right now, re-rendering when that changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** Tailwind's `lg` breakpoint, where the forecast strip has room for all seven days as cards. */
export const WIDE_FORECAST_QUERY = '(min-width: 1024px)';
