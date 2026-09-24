import type { HistoryPoint } from '../../types/weather';

/** One measurement on a popup's chart. */
export interface PlotSeries {
  key: keyof HistoryPoint;
  label: string;
  /** The theme token that colours it, e.g. '--chart-temp-high'. */
  token: string;
  /** Into the viewer's units. */
  convert?: (value: number | null) => number | null;
  style?: 'line' | 'dashed' | 'area' | 'step' | 'bar';
  /** For the tooltip. */
  digits?: number;
  unit?: string;
}
