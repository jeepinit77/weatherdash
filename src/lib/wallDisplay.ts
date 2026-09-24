import { createContext, useContext } from 'react';

/**
 * True while the dashboard is in full-screen mode, which is a wall display read
 * from across a room with nobody standing at it. Cards use it to drop the
 * detail that only rewards close reading, to keep every line of text large
 * enough to read at a distance (roughly 16px and up), and to avoid anything
 * that would need a click to put right.
 *
 * DashboardGrid provides it; outside a dashboard it reads false.
 */
export const WallDisplayContext = createContext(false);

export function useWallDisplay(): boolean {
  return useContext(WallDisplayContext);
}
