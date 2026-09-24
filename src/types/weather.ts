/** Latest station reading. Any field can be null when the station doesn't report it. */
export interface Reading {
  date: string;
  tempf: number | null;
  feelsLike: number | null;
  dewPoint: number | null;
  humidity: number | null;
  tempinf: number | null;
  humidityin: number | null;
  feelsLikein: number | null;
  dewPointin: number | null;
  baromrelin: number | null;
  baromabsin: number | null;
  windspeedmph: number | null;
  windgustmph: number | null;
  maxdailygust: number | null;
  winddir: number | null;
  hourlyrainin: number | null;
  eventrainin: number | null;
  dailyrainin: number | null;
  weeklyrainin: number | null;
  monthlyrainin: number | null;
  yearlyrainin: number | null;
  /** When rain was last recorded, as ISO 8601 UTC. */
  lastRain: string | null;
  totalrainin: number | null;
  solarradiation: number | null;
  uv: number | null;
  battout: number | null;
}

export interface Extreme {
  value: number | null;
  at: string | null;
}

export interface DayStats {
  high: Extreme;
  low: Extreme;
  maxGust: number | null;
  humidityHigh: number | null;
  humidityLow: number | null;
}

/** Figures derived from recorded history, in the station's local day. */
export interface StationStats {
  today: DayStats;
  yesterday: DayStats;
  /** Mean wind speed over the last 15 minutes of readings. */
  windAvg15: number | null;
  rain7d: number | null;
  /**
   * Change in relative pressure over roughly the last three hours, in inHg.
   * Positive is rising. Null when there is no reading near three hours ago.
   */
  baromTrend3h: number | null;
  /** The station's own almanac figures. Absent from a server that predates them. */
  almanac?: StationAlmanac;
}

/** Almanac figures measured by the station itself, from its daily summaries. Dates are local YYYY-MM-DD. */
export interface StationAlmanac {
  /** The last rain of 0.10 in or more, as the whole storm: its total and its last wet day. */
  lastRain: { date: string; amount: number } | null;
  /** Lighter rain since then, in inches, when there was any. */
  lightRainSince: number | null;
  /** This year's longest run of days without a rain of 0.10 in or more. */
  dryStretch: { days: number; start: string; end: string; ongoing: boolean } | null;
  /** Each day's high and low this year, °F, from the first day with a summary. */
  yearTemps: { since: string; highs: number[]; lows: number[] } | null;
}

export interface RecordStat {
  value: number;
  year: number;
}

/** Record high/low for today's calendar date, derived from historical reanalysis data. */
/** Averages for a calendar date over a standard 30-year period. °F and inches. */
export interface DayNormals {
  high: number;
  low: number;
  /** Rain that has usually fallen by the end of this date, from the first of the month. */
  rainMonth: number;
  /** The same from the first of the year. */
  rainYear: number;
  /** A whole normal year's rain. */
  rainAnnual: number | null;
  /** e.g. "1991–2020". */
  period: string;
}

export interface DayRecords {
  recordHigh: RecordStat | null;
  recordLow: RecordStat | null;
  sinceYear: number;
  /** Absent until the archive has been folded into normals for this location. */
  normal?: DayNormals | null;
}

export interface StationInfo {
  slug: string;
  name: string;
  timezone: string | null;
  isPublic: boolean;
  lastPollAt: string | null;
  /**
   * True when the signed-in viewer owns this station. Only the owner may ask
   * for a live reading, since that spends their Ambient API quota.
   * Only the current-reading endpoint sets it.
   */
  isOwner?: boolean;
  /** Rounded to a tenth of a degree, for sun and moon times. Only the current-reading endpoint sets these. */
  approxLatitude?: number;
  approxLongitude?: number;
}

/** A station as its owner sees it. */
export interface OwnedStation extends StationInfo {
  id: number;
  macAddress: string;
  apiKeyHint: string;
  appKeyHint: string;
  latitude: number;
  longitude: number;
  forecastProvider: ForecastProvider;
  lastPollError: string | null;
  /** How far back history has been pulled from Ambient, and whether that is finished. */
  backfillComplete: boolean;
  backfilledTo: string | null;
}

export interface StationInput {
  id?: number;
  name: string;
  slug: string;
  apiKey: string;
  applicationKey: string;
  macAddress: string;
  latitude: number;
  longitude: number;
  forecastProvider: ForecastProvider;
  isPublic: boolean;
}

export interface PublicStation {
  slug: string;
  name: string;
  tempf: number | null;
  lastUpdated: string | null;
}

export type HistoryRange = '24h' | '7d' | '30d' | '1y';

/** For 24h/7d `time` is an ISO timestamp; for 30d/1y it is a local YYYY-MM-DD date and values are daily aggregates. */
export interface HistoryPoint {
  time: string;
  tempf: number | null;
  tempMin: number | null;
  tempMax: number | null;
  dewPoint: number | null;
  humidity: number | null;
  baromrelin: number | null;
  windspeedmph: number | null;
  windgustmph: number | null;
  rainin: number | null;
  solarradiation: number | null;
  uv: number | null;
  /** Daily points only: detail kept after the 5-minute readings are pruned. */
  readingCount?: number | null;
  windDirAvg?: number | null;
  feelsLikeMax?: number | null;
  feelsLikeMin?: number | null;
  humidityMin?: number | null;
  humidityMax?: number | null;
  dewPointMax?: number | null;
  dewPointMin?: number | null;
  baromMin?: number | null;
  baromMax?: number | null;
  rainRateMax?: number | null;
}

/** Times are unix seconds. */
export interface DailyForecast {
  time: number;
  weatherCode: number | null;
  tempMax: number | null;
  tempMin: number | null;
  popMax: number | null;
  /** Total rainfall expected over the day, in inches. */
  precipSum: number | null;
  /** Which service the rain total came from, which can differ from the forecast's own. */
  precipSource: ForecastSource | null;
  windSpeedMax: number | null;
  windGustMax: number | null;
  windDirectionMax: number | null;
  uvIndexMax: number | null;
  sunrise: number | null;
  sunset: number | null;
  /** The forecaster's own wording for the day. Only the National Weather Service writes this. */
  detailText: string | null;
}

/** Units as stored: °F, %, mph, degrees, inches. */
export interface HourlyForecast {
  time: number;
  temp: number | null;
  pop: number | null;
  weatherCode: number | null;
  feelsLike: number | null;
  dewPoint: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  /** Rain expected in the hour, in inches. */
  precip: number | null;
  uv: number | null;
  cloudCover: number | null;
}

/** Which service a forecast came from. */
export type ForecastSource = 'open-meteo' | 'nws';

export interface ForecastData {
  source: ForecastSource;
  timezone: string;
  /** "block.column" for each column Open-Meteo filled into a National Weather Service forecast. */
  supplemented: string[];
  daily: DailyForecast[];
  hourly: HourlyForecast[];
}

/**
 * Where a station's forecast comes from. 'auto' prefers the National Weather
 * Service where it has coverage and uses Open-Meteo everywhere else.
 */
export type ForecastProvider = 'auto' | 'nws' | 'open-meteo';

/**
 * A National Weather Service watch, warning or advisory in effect for a
 * station. Every field but the id can be absent: the API fills in what the
 * issuing office wrote and nothing more.
 */
export interface WeatherAlert {
  id: string;
  /** The kind of alert, e.g. "Flood Warning" or "Special Weather Statement". */
  event: string | null;
  /** CAP severity: Extreme, Severe, Moderate, Minor or Unknown. Drives the styling. */
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  /** ISO 8601 with an offset, not necessarily UTC. */
  onset: string | null;
  expires: string | null;
  /** The counties or zones the alert covers, as the office named them. */
  areaDesc: string | null;
}

export interface AlertsData {
  /**
   * False where the National Weather Service does not forecast this station,
   * either because its owner chose Open-Meteo or because it sits outside NWS
   * coverage. Such a station shows no alerts UI at all, as distinct from a
   * supported one with an empty list, which means nothing is in effect.
   */
  supported: boolean;
  alerts: WeatherAlert[];
}

/** Precipitation expected in one 15-minute step. Times are unix seconds. */
export interface NowcastStep {
  time: number;
  /** Inches over the 15 minutes. */
  precip: number | null;
  probability: number | null;
}

export type PollutantId = 'pm2_5' | 'pm10' | 'ozone' | 'no2';

/** Modelled air quality at the station. AQI values are the US index; concentrations are µg/m³. */
export interface AirQuality {
  /** Unix seconds the figures apply to. */
  time: number | null;
  aqi: number | null;
  pollutants: { id: PollutantId; aqi: number | null; concentration: number | null }[];
  hourly: { time: number; aqi: number | null }[];
}

export interface Place {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** The theme every browser this user signs in on takes up, when they have asked for one. */
  theme: string | null;
}

/** A layout as it is stored: each widget on or off, and each row break's width. */
export type StoredLayoutItem = { id: string; enabled: boolean } | { id: string; columns: number | null };

/** A dashboard layout the signed-in user has saved under a name. */
export interface SavedLayout {
  id: number;
  name: string;
  layout: StoredLayoutItem[];
  updatedAt: string | null;
}

export type WidgetType =
  | 'clock-daylight'
  | 'temperature'
  | 'wind'
  | 'rain'
  | 'humidity'
  | 'forecast-strip'
  | 'week-ahead'
  | 'indoor'
  | 'air-quality'
  | 'almanac'
  | 'moon'
  | 'radar'
  | 'current-station'
  | 'time-date'
  | 'hourly'
  | 'historical-chart'
  | 'station-status'
  | 'pressure'
  | 'uv-solar';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  enabled: boolean;
}

/** How many tiles a row of them shows side by side on a wide screen. */
export type TilesPerRow = 2 | 3 | 4 | 5 | 6;

/** Starts a new row of tiles in a layout, and can fix how many sit across in it. */
export interface RowBreak {
  id: string;
  type: 'row-break';
  title: string;
  enabled: true;
  /** Null lets the row fit its tiles: all of them abreast, as far as the screen allows. */
  columns: TilesPerRow | null;
}

/** One entry in a dashboard layout: a widget, or the start of a new row of tiles. */
export type LayoutItem = WidgetConfig | RowBreak;
