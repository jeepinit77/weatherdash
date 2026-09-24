import type { LayoutItem, RowBreak, StoredLayoutItem, TilesPerRow, WidgetConfig, WidgetType } from '../types/weather';

/** Every widget the dashboard can show, in the order a fresh dashboard uses. */
export const ALL_WIDGETS: WidgetConfig[] = [
  { id: 'w-clock-daylight', type: 'clock-daylight', title: 'Time & Daylight', enabled: true },
  { id: 'w-temp', type: 'temperature', title: 'Temperature', enabled: true },
  { id: 'w-wind', type: 'wind', title: 'Wind', enabled: true },
  { id: 'w-rain', type: 'rain', title: 'Rain', enabled: true },
  { id: 'w-humidity', type: 'humidity', title: 'Humidity', enabled: true },
  { id: 'w-pressure', type: 'pressure', title: 'Pressure', enabled: false },
  { id: 'w-uv-solar', type: 'uv-solar', title: 'UV & Solar', enabled: false },
  { id: 'w-indoor', type: 'indoor', title: 'Indoors', enabled: false },
  { id: 'w-air', type: 'air-quality', title: 'Air Quality', enabled: false },
  { id: 'w-almanac', type: 'almanac', title: 'Almanac', enabled: false },
  { id: 'w-moon', type: 'moon', title: 'Moon', enabled: false },
  { id: 'w-radar', type: 'radar', title: 'Radar', enabled: false },
  { id: 'w-week-ahead', type: 'week-ahead', title: 'Week Ahead', enabled: false },
  { id: 'w-forecast-strip', type: 'forecast-strip', title: '7-Day Forecast', enabled: true },
  { id: 'w-hourly', type: 'hourly', title: 'Next 24 Hours', enabled: false },
  { id: 'w-history', type: 'historical-chart', title: 'History', enabled: true },
  { id: 'w-status', type: 'station-status', title: 'Station Status', enabled: true },
  { id: 'w-current', type: 'current-station', title: 'All Sensors', enabled: false },
  { id: 'w-time', type: 'time-date', title: 'Local Time & Daylight', enabled: false },
];

/** These sit side by side in one row, like the Ambient dashboard. Everything else takes a row of its own. */
export const TILE_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>([
  'temperature', 'wind', 'rain', 'humidity', 'pressure', 'uv-solar', 'time-date', 'week-ahead', 'indoor', 'air-quality', 'almanac', 'moon', 'radar',
]);

/**
 * How many tiles a row may ask for. A row gets that many only where each tile
 * still has TILE_MIN_WIDTH to itself, and steps down a column at a time below
 * that, to one on a phone. Left to fit itself, a row asks for all its tiles
 * abreast, up to the most any row can have.
 */
export const TILES_PER_ROW_OPTIONS: TilesPerRow[] = [2, 3, 4, 5, 6];
const MAX_AUTO_COLUMNS = 6;

/**
 * Narrowest a tile may be, in px, before its row gives up a column. Measured:
 * 224 in the window takes six across its widest page, 1472px (232 each), and
 * 280 on the wall six across a 1920 screen (295 each). No tile spills at either.
 */
export const TILE_MIN_WIDTH = { windowed: 224, wall: 280 } as const;

/**
 * The grid columns for a row of tiles: `columns` across where each gets its
 * minimum width, otherwise as many as fit. Empty tracks stay empty, so a row
 * set wider than it has tiles keeps its tiles at the width asked for.
 */
export const tileRowTemplate = (columns: number, minWidth: number, gapRem: number) =>
  `repeat(auto-fill, minmax(max(${minWidth}px, calc((100% - ${(columns - 1) * gapRem}rem) / ${columns})), 1fr))`;

export const isTilesPerRow = (n: unknown): n is TilesPerRow => TILES_PER_ROW_OPTIONS.includes(n as TilesPerRow);

export const isRowBreak = (item: LayoutItem | undefined): item is RowBreak => item?.type === 'row-break';

const ROW_BREAK_PREFIX = 'row-';

export const makeRowBreak = (id: string, columns: TilesPerRow | null): RowBreak =>
  ({ id, type: 'row-break', title: 'Tile row', enabled: true, columns });

/** An id no break in the layout already uses. */
export function newRowBreakId(list: LayoutItem[]): string {
  const used = list.filter(isRowBreak).map(b => Number(b.id.slice(ROW_BREAK_PREFIX.length)) || 0);
  return `${ROW_BREAK_PREFIX}${Math.max(0, ...used) + 1}`;
}

/** A row of the dashboard: one wide widget, or a run of tiles side by side. */
export interface LayoutRow {
  /** Stable while the row lasts: its break's id, or else its first widget's. */
  key: string;
  widgets: WidgetConfig[];
  tiles: boolean;
  /** The break that started this row of tiles, when one did. */
  rowBreak: RowBreak | null;
  /** Columns on a wide screen. Tiles past that wrap onto another line of the same row. */
  columns: number;
}

/**
 * The layout as the dashboard draws it. A run of tiles shares a row until a
 * wide widget or a row break ends it; every wide widget is a row to itself.
 */
export function layoutRows(list: LayoutItem[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  // A break waits for the next tile, so one left just ahead of a wide widget still starts the tiles after it.
  let pending: RowBreak | null = null;
  for (const item of list) {
    if (isRowBreak(item)) {
      pending = item;
      continue;
    }
    if (!item.enabled) continue;
    if (!TILE_TYPES.has(item.type)) {
      rows.push({ key: item.id, widgets: [item], tiles: false, rowBreak: null, columns: 1 });
      continue;
    }
    const last = rows[rows.length - 1];
    if (!pending && last?.tiles) last.widgets.push(item);
    else rows.push({ key: pending?.id ?? item.id, widgets: [item], tiles: true, rowBreak: pending, columns: 0 });
    pending = null;
  }
  for (const row of rows) {
    if (row.tiles) row.columns = row.rowBreak?.columns ?? Math.min(row.widgets.length, MAX_AUTO_COLUMNS);
  }
  return rows;
}

/**
 * The layout with every break that does nothing taken out, and each one that
 * stays moved to just ahead of the tile it starts. A break earns its place by
 * splitting one run of tiles from another, or by fixing its row's width.
 */
export function normalizeLayout(list: LayoutItem[]): LayoutItem[] {
  const out: LayoutItem[] = [];
  let pending: RowBreak | null = null;
  let afterTile = false;
  for (const item of list) {
    if (isRowBreak(item)) {
      pending = item;
      continue;
    }
    const tile = item.enabled && TILE_TYPES.has(item.type);
    if (tile) {
      if (pending && (afterTile || pending.columns !== null)) out.push(pending);
      pending = null;
    }
    out.push(item);
    if (item.enabled) afterTile = tile;
  }
  return out;
}

export type WidgetCategory = 'conditions' | 'time' | 'forecast' | 'station';

export const WIDGET_CATEGORIES: { id: WidgetCategory; label: string }[] = [
  { id: 'conditions', label: 'Conditions' },
  { id: 'time', label: 'Time & sky' },
  { id: 'forecast', label: 'Forecast & trends' },
  { id: 'station', label: 'Station' },
];

/** What the editor tells a viewer about each widget before they add it. */
export const WIDGET_INFO: Record<WidgetType, { description: string; category: WidgetCategory }> = {
  'clock-daylight': { category: 'time', description: 'Slim bar with the time, date, sunrise, sunset and daylight progress.' },
  'time-date': { category: 'time', description: 'Tile with the local time and today’s sunrise and sunset.' },
  moon: { category: 'time', description: 'Tonight’s moon as it looks, how much is lit, its rise and set, and the next full or new moon.' },
  temperature: { category: 'conditions', description: 'Current temperature, feels-like, today’s range and records.' },
  wind: { category: 'conditions', description: 'Compass with speed, gusts, direction and the 15-minute average.' },
  rain: { category: 'conditions', description: 'Today’s rain, the rate right now, and event, week and month totals.' },
  humidity: { category: 'conditions', description: 'Relative humidity gauge with today’s high, low and dew point.' },
  pressure: { category: 'conditions', description: 'Barometric pressure and which way it has moved in three hours.' },
  'uv-solar': { category: 'conditions', description: 'UV index with its risk band, and solar radiation.' },
  indoor: { category: 'conditions', description: 'The console’s indoor temperature, humidity, feels-like and dew point.' },
  'air-quality': { category: 'conditions', description: 'The US Air Quality Index on a ring in the EPA’s colours, with the main pollutant.' },
  'current-station': { category: 'conditions', description: 'Every outdoor sensor on one wide card.' },
  radar: { category: 'forecast', description: 'The last two hours of rain radar around the station, looping.' },
  'forecast-strip': { category: 'forecast', description: 'Seven days of highs, lows, rain chance and wind. Tap a day for detail.' },
  'week-ahead': { category: 'forecast', description: 'The week as a tile: a line a day, each day’s low and high on one shared scale.' },
  hourly: { category: 'forecast', description: 'The next day hour by hour: temperature and rain chance, plus any of feels-like, wind, humidity, UV and more.' },
  almanac: { category: 'forecast', description: 'Today against the normal and the historical high and low for the date, this month’s and year’s rain against typical, and when it last rained.' },
  'historical-chart': { category: 'forecast', description: 'Chart of any measurement over the last day, week, month or year.' },
  'station-status': { category: 'station', description: 'Last reading, sensor batteries and whether the station is public.' },
};

/**
 * Templates: sets of widgets to start from. Each lists the widgets it shows, in
 * order; the rest are switched off. Choosing one resets any tile rows.
 */
export const WIDGET_TEMPLATES: { id: string; name: string; description: string; ids: string[] }[] = [
  {
    id: 'default',
    name: 'Standard',
    description: 'The dashboard as it first arrives.',
    ids: ALL_WIDGETS.filter(w => w.enabled).map(w => w.id),
  },
  {
    id: 'essentials',
    name: 'At a glance',
    description: 'The four big readings and the week ahead. Nothing else.',
    ids: ['w-clock-daylight', 'w-temp', 'w-wind', 'w-rain', 'w-humidity', 'w-forecast-strip'],
  },
  {
    id: 'wall',
    name: 'Wall display',
    description: 'Large, live readings for a screen across the room. No charts to read up close.',
    ids: ['w-clock-daylight', 'w-temp', 'w-wind', 'w-rain', 'w-humidity', 'w-pressure', 'w-uv-solar', 'w-forecast-strip'],
  },
  {
    id: 'enthusiast',
    name: 'Weather enthusiast',
    description: 'Every sensor, air quality, radar, the almanac and moon, the hourly forecast and the history chart.',
    ids: [
      'w-clock-daylight', 'w-temp', 'w-wind', 'w-rain', 'w-humidity', 'w-pressure', 'w-uv-solar',
      'w-indoor', 'w-air', 'w-radar', 'w-almanac', 'w-moon', 'w-week-ahead',
      'w-forecast-strip', 'w-hourly', 'w-history', 'w-current', 'w-status',
    ],
  },
];

/** The full widget list for a template: its widgets on, in its order, then the rest off. */
export function applyTemplate(ids: string[]): WidgetConfig[] {
  const on = ids
    .map(id => ALL_WIDGETS.find(w => w.id === id))
    .filter((w): w is WidgetConfig => w !== undefined)
    .map(w => ({ ...w, enabled: true }));
  const off = ALL_WIDGETS.filter(w => !ids.includes(w.id)).map(w => ({ ...w, enabled: false }));
  return [...on, ...off];
}

/** True when the widgets on show exactly the template, in its order, with no rows of their own. */
export function matchesTemplate(layout: LayoutItem[], ids: string[]): boolean {
  if (layout.some(isRowBreak)) return false;
  const on = layout.filter(w => w.enabled).map(w => w.id);
  return on.length === ids.length && on.every((id, i) => id === ids[i]);
}

/** Widgets replaced by another, so a layout that had the old one gets its successor in the same place. */
const RENAMED_WIDGETS: Record<string, string> = {
  'w-forecast': 'w-hourly',
};

/** The layout as it is kept, in this browser or with the account: no more than mergeLayout needs to rebuild it. */
export const serializeLayout = (list: LayoutItem[]): StoredLayoutItem[] =>
  normalizeLayout(list).map(item => (isRowBreak(item) ? { id: item.id, columns: item.columns } : { id: item.id, enabled: item.enabled }));

/** Keeps the viewer's saved order, on/off choices and tile rows, and adds any widget they haven't seen yet. */
export function mergeLayout(saved: unknown): LayoutItem[] {
  if (!Array.isArray(saved)) return ALL_WIDGETS;
  const known = saved
    .map((item): LayoutItem | null => {
      const raw = item as { id?: unknown; enabled?: unknown; columns?: unknown } | null;
      if (typeof raw?.id === 'string' && raw.id.startsWith(ROW_BREAK_PREFIX)) {
        return makeRowBreak(raw.id, isTilesPerRow(raw.columns) ? raw.columns : null);
      }
      const id = typeof raw?.id === 'string' ? (RENAMED_WIDGETS[raw.id] ?? raw.id) : raw?.id;
      const match = ALL_WIDGETS.find(w => w.id === id);
      return match ? { ...match, enabled: Boolean(raw?.enabled) } : null;
    })
    .filter((w): w is LayoutItem => w !== null);
  if (!known.some(w => !isRowBreak(w))) return ALL_WIDGETS;
  // A widget the viewer hasn't seen yet goes in after the one it follows in a
  // fresh layout, so a new tile joins the tile row rather than the foot of the page.
  const merged = [...known];
  ALL_WIDGETS.forEach((widget, i) => {
    if (merged.some(w => w.id === widget.id)) return;
    const before = ALL_WIDGETS.slice(0, i).reverse().find(prev => merged.some(w => w.id === prev.id));
    const at = before ? merged.findIndex(w => w.id === before.id) + 1 : 0;
    merged.splice(at, 0, widget);
  });
  return normalizeLayout(merged);
}
