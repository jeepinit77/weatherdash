import { createContext } from 'react';

/** The station a dashboard is showing, for anything deep in it that fetches on its own (a popup's chart). */
export const StationContext = createContext<{ slug: string; timezone: string | null }>({ slug: '', timezone: null });
