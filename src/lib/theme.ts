import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The look of the dashboard is a property of the screen it is being shown on,
 * not of the station being shown: the same station is read on a phone in
 * daylight and on a wall panel in a dark room, and those want different
 * treatments. So the choice lives in this browser's local storage.
 *
 * A signed-in user can ask for one theme on every browser they sign in on. The
 * account then holds it, and each of those browsers copies it into its own
 * storage (see App), so the page still paints in it before anyone is known.
 */
export type ThemeId = 'midnight' | 'paper' | 'chalk' | 'terracotta';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  blurb: string;
  /** Three colours for the picker's swatch: page, card, accent. */
  swatch: [string, string, string];
  /** Light text on dark surfaces, for anything drawn from outside the theme (a map). */
  dark: boolean;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'midnight',
    name: 'Midnight Glass',
    blurb: 'Deep indigo, lit edges and a soft glow.',
    swatch: ['#080C14', '#1E2963', '#3B82F6'],
    dark: true,
  },
  {
    id: 'paper',
    name: 'Paper & Glass',
    blurb: 'Warm architectural light on near-white card stock.',
    swatch: ['#F2EDE5', '#FFFDFA', '#2F6D9E'],
    dark: false,
  },
  {
    id: 'chalk',
    name: 'Matte Slate & Chalk',
    blurb: 'Flat surfaces, hairline rules, no glow at all.',
    swatch: ['#21262E', '#2B313A', '#7595B2'],
    dark: true,
  },
  {
    id: 'terracotta',
    name: 'Desert Terracotta & Sage',
    blurb: 'Sun-bleached sand with fired clay and sage.',
    swatch: ['#EBE1D2', '#FAF4E8', '#B4552F'],
    dark: false,
  },
];

export const DEFAULT_THEME: ThemeId = 'midnight';

const STORAGE_KEY = 'weatherdash_theme';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some(t => t.id === value);
}

/** The stored choice, or the default when there is none (or storage is blocked). */
export function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME;
}

function apply(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  // The browser's own chrome (the address bar on a phone, an installed app's
  // title bar) takes the page colour of the theme in use.
  const page = THEMES.find(t => t.id === id)?.swatch[0];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (page && meta) meta.setAttribute('content', page);
}

/**
 * Event fired when the theme changes, so every hook instance re-reads at once.
 * `storage` only fires in *other* tabs, which is the behaviour we want for
 * other tabs and not enough for this one.
 */
const CHANGE_EVENT = 'weatherdash:themechange';

/**
 * The current theme and a way to change it. The attribute is set as early as
 * `index.html` can manage it, so this only has to keep React in step.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);

  useEffect(() => {
    const sync = () => setThemeState(readStoredTheme());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Keeps the document honest if the attribute was never set (storage blocked,
  // or the boot script did not run) and after a change from another tab.
  useEffect(() => { apply(theme); }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    apply(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
    setThemeState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { theme, setTheme };
}

/**
 * Resolves theme tokens to the concrete colours they currently hold.
 *
 * Almost everything can name a token directly — a Tailwind utility, or
 * `var(--token)` in an inline style — and needs nothing from here. This is for
 * the few places that cannot: Recharts writes its colours out as SVG
 * attributes, where `var()` is not resolved.
 *
 * Subscribing to the theme is what makes this re-read: the token names never
 * change, only the values behind them, so a theme change is the one thing that
 * can make a resolved colour stale.
 */
export function useThemeColors<K extends string>(tokens: Record<K, string>): Record<K, string> {
  const { theme } = useTheme();
  // Callers pass a fresh object literal each render, so key on its contents.
  const key = JSON.stringify(tokens);

  // Reading computed styles forces a style recalculation, so it is done once
  // per theme rather than on every render of a chart that redraws each minute.
  return useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const entries = Object.entries(JSON.parse(key) as Record<K, string>) as [K, string][];
    return Object.fromEntries(
      entries.map(([name, token]) => [name, styles.getPropertyValue(token).trim()]),
    ) as Record<K, string>;
    // theme is the trigger: the token names never change, only their values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, key]);
}
