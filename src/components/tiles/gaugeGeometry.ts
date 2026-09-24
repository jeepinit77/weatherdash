/**
 * The dial every gauge tile draws on: a square canvas of this many units, with
 * an outer and an inner ring. The canvas is scaled to the width it is given, so
 * these are drawing units rather than screen pixels.
 */
export const GAUGE_SIZE = 260;
export const GAUGE_CENTRE = GAUGE_SIZE / 2;
export const OUTER_R = 110;
export const INNER_R = 86;

/** How wide the dial may grow on screen: its drawn size in a window, and larger on a wall display. */
export const DIAL_MAX_WIDTH = 260;
export const DIAL_MAX_WIDTH_WALL = 320;

/**
 * A length on the dial, in drawing units, as a CSS length that scales with the
 * dial. For text and offsets laid over the rings, so they keep their place and
 * proportion at any size.
 */
export function dialUnits(units: number): string {
  return `${((units / GAUGE_SIZE) * 100).toFixed(3)}cqw`;
}
