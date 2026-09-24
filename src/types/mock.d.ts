import type { Reading, StationStats } from './weather';

// Populated by src/mocktmp.ts (gitignored, localhost-only) so the app can offer
// a mock data editor without depending on that file existing in the bundle.
declare global {
  interface Window {
    __mockData?: {
      reading: Reading;
      stats: StationStats;
      /** Hours into the local day, which the mock forecast turns into sunrise/sunset timestamps. */
      sun: { sunriseHour: number; sunsetHour: number };
    };
  }
}

export {};
