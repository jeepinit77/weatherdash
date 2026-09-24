/*
  Heights shared by the history chart and the placeholder shown while its code
  loads, so swapping one for the other does not shift the page. Kept apart from
  the chart itself so the placeholder can be imported without pulling in
  Recharts.
*/

/** The row of metric and range controls (windowed only). */
export const CONTROLS_ROW = 'min-h-10';
/** The series key above the plot. */
export const KEY_ROW = 'h-5';
export const KEY_ROW_WALL = 'h-7';
/** The plot itself. */
export const PLOT_HEIGHT = 'h-72 sm:h-80';
export const PLOT_HEIGHT_WALL = 'h-96';
