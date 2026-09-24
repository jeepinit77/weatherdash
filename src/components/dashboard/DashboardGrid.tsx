import React, { Suspense, lazy, useState } from 'react';
import type {
  AirQuality,
  DayRecords,
  ForecastData,
  HistoryPoint,
  HistoryRange,
  Reading,
  StationInfo,
  StationStats,
  LayoutItem,
  WidgetConfig,
  WidgetType,
} from '../../types/weather';
import { ClockDaylightTile } from '../tiles/ClockDaylightTile';
import { TemperatureTile } from '../tiles/TemperatureTile';
import { WindTile } from '../tiles/WindTile';
import { RainTile } from '../tiles/RainTile';
import { HumidityTile } from '../tiles/HumidityTile';
import { PressureTile } from '../tiles/PressureTile';
import { UvSolarTile } from '../tiles/UvSolarTile';
import { ForecastStripTile } from '../tiles/ForecastStripTile';
import { WeekAheadTile } from '../tiles/WeekAheadTile';
import { IndoorTile } from '../tiles/IndoorTile';
import { AqiTile } from '../tiles/AqiTile';
import { AlmanacTile } from '../tiles/AlmanacTile';
import { MoonTile } from '../tiles/MoonTile';
import { RadarTile } from '../tiles/RadarTile';
import { DETAIL_TYPES, WidgetDetail } from '../detail/WidgetDetail';
import { CurrentStationWidget } from '../widgets/CurrentStationWidget';
import { TimeDateWidget } from '../widgets/TimeDateWidget';
import { HourlyWidget } from '../widgets/HourlyWidget';
import { HistoryChartSkeleton } from '../widgets/HistoryChartSkeleton';
import { StationStatusWidget } from '../widgets/StationStatusWidget';
import { StationContext } from '../../lib/stationContext';
import { WallDisplayContext } from '../../lib/wallDisplay';
import { TILE_MIN_WIDTH, layoutRows, tileRowTemplate } from '../../lib/widgets';

// The chart library is the heaviest thing on the page, so it loads on its own
// after the readings are already up.
const HistoricalChartWidget = lazy(() =>
  import('../widgets/HistoricalChartWidget').then(m => ({ default: m.HistoricalChartWidget })),
);

interface DashboardGridProps {
  widgets: LayoutItem[];
  station: StationInfo;
  reading: Reading;
  stats: StationStats;
  /** Null while the current range is still loading. */
  history: HistoryPoint[] | null;
  /** The last history request for the current range failed. */
  historyError: boolean;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  forecast: ForecastData | null;
  forecastError: boolean;
  records: DayRecords | null;
  /** Null until loaded, and never asked for unless the tile is on the dashboard. */
  air: AirQuality | null;
  airError: boolean;
  /** Full-screen wall display: larger type, no close-reading detail. */
  fullscreen: boolean;
}

export const DashboardGrid: React.FC<DashboardGridProps> = ({
  widgets,
  station,
  reading,
  stats,
  history,
  historyError,
  range,
  onRangeChange,
  forecast,
  forecastError,
  records,
  air,
  airError,
  fullscreen,
}) => {
  const timezone = station.timezone ?? forecast?.timezone ?? null;
  const days = forecast?.daily ?? [];
  const [detail, setDetail] = useState<WidgetType | null>(null);

  const render = (widget: WidgetConfig) => {
    switch (widget.type) {
      case 'clock-daylight':
        return <ClockDaylightTile timezone={timezone} days={days} />;
      case 'temperature':
        return <TemperatureTile reading={reading} stats={stats} timezone={timezone} days={days} records={records} />;
      case 'wind':
        return <WindTile reading={reading} stats={stats} />;
      case 'rain':
        return <RainTile reading={reading} stats={stats} />;
      case 'humidity':
        return <HumidityTile reading={reading} stats={stats} />;
      case 'pressure':
        return <PressureTile reading={reading} stats={stats} />;
      case 'uv-solar':
        return <UvSolarTile reading={reading} />;
      case 'forecast-strip':
        return <ForecastStripTile forecast={forecast} hasError={forecastError} nowTemp={reading.tempf} />;
      case 'radar':
        return <RadarTile lat={station.approxLatitude ?? null} lon={station.approxLongitude ?? null} timezone={timezone} />;
      case 'moon':
        return <MoonTile timezone={timezone} lat={station.approxLatitude ?? null} lon={station.approxLongitude ?? null} />;
      case 'almanac':
        return <AlmanacTile reading={reading} stats={stats} records={records} />;
      case 'air-quality':
        return <AqiTile air={air} hasError={airError} />;
      case 'indoor':
        return <IndoorTile reading={reading} />;
      case 'week-ahead':
        return <WeekAheadTile forecast={forecast} hasError={forecastError} nowTemp={reading.tempf} />;
      case 'current-station':
        return <CurrentStationWidget data={reading} />;
      case 'time-date':
        return <TimeDateWidget timezone={timezone} days={days} />;
      case 'hourly':
        return <HourlyWidget forecast={forecast} hasError={forecastError} />;
      case 'historical-chart':
        return (
          <Suspense fallback={<HistoryChartSkeleton />}>
            <HistoricalChartWidget
              data={history}
              hasError={historyError}
              range={range}
              timezone={timezone}
              onRangeChange={onRangeChange}
            />
          </Suspense>
        );
      case 'station-status':
        return <StationStatusWidget station={station} reading={reading} />;
    }
  };

  // Runs of side-by-side tiles share a row, each as wide as its settings say.
  const rows = layoutRows(widgets);

  /** A widget, made tappable when it has a popup to open. */
  const cell = (widget: WidgetConfig) => {
    if (!DETAIL_TYPES.has(widget.type)) return render(widget);
    const open = () => setDetail(widget.type);
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${widget.title}: show details`}
        className="tile-tap h-full"
        onClick={open}
        onKeyDown={e => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          open();
        }}
      >
        {render(widget)}
      </div>
    );
  };

  return (
    <WallDisplayContext.Provider value={fullscreen}>
    <StationContext.Provider value={{ slug: station.slug, timezone }}>
      <div className="space-y-4">
        {rows.map(row =>
          row.columns === 1 ? (
            <div key={row.key}>{cell(row.widgets[0])}</div>
          ) : (
            <div
              key={row.key}
              className="grid gap-4"
              style={{ gridTemplateColumns: tileRowTemplate(row.columns, fullscreen ? TILE_MIN_WIDTH.wall : TILE_MIN_WIDTH.windowed, 1) }}
            >
              {row.widgets.map(widget => (
                <div key={widget.id}>{cell(widget)}</div>
              ))}
            </div>
          ),
        )}
      </div>

      {detail && (
        <WidgetDetail
          type={detail}
          data={{ reading, stats, records, forecast, timezone, air, lat: station.approxLatitude ?? null, lon: station.approxLongitude ?? null }}
          onClose={() => setDetail(null)}
        />
      )}
    </StationContext.Provider>
    </WallDisplayContext.Provider>
  );
};
