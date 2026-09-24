import type {
  AlertsData,
  DayRecords,
  ForecastData,
  ForecastSource,
  HistoryPoint,
  HistoryRange,
  NowcastStep,
  AirQuality,
  PollutantId,
  OwnedStation,
  PublicStation,
  Reading,
  SavedLayout,
  StoredLayoutItem,
  StationInfo,
  Place,
  StationInput,
  StationStats,
  User,
} from '../types/weather';

const API_BASE = `${import.meta.env.BASE_URL}api`;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Called when the server says the session is gone (it expired, or was signed
 * out in another tab), so the app can stop showing the viewer as signed in.
 */
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${path}`, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('Could not reach the server', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

function post<T>(path: string, data: object): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

const q = encodeURIComponent;

export const api = {
  me: () => request<{ user: User | null; googleClientId: string }>('auth.php?action=me'),
  googleNonce: () => post<{ nonce: string }>('auth.php', { action: 'nonce' }).then(r => r.nonce),
  signInWithGoogle: (credential: string) =>
    post<{ user: User }>('auth.php', { action: 'google', credential }).then(r => r.user),
  signOut: () => post('auth.php', { action: 'logout' }),
  /** Deletes the signed-in account and every station, reading and summary it owns. */
  deleteAccount: () => post('auth.php', { action: 'delete-account' }),

  savedLayouts: () => request<{ layouts: SavedLayout[] }>('prefs.php?action=layouts').then(r => r.layouts),
  /** Saves a new layout, or replaces the one with `id`. */
  saveLayout: (name: string, layout: StoredLayoutItem[], id?: number) =>
    post<{ layout: SavedLayout }>('prefs.php', { action: 'save-layout', id, name, layout }).then(r => r.layout),
  deleteLayout: (id: number) => post('prefs.php', { action: 'delete-layout', id }),
  /** The theme every signed-in browser takes up, or null to leave each browser to its own. */
  setAccountTheme: (theme: string | null) =>
    post<{ theme: string | null }>('prefs.php', { action: 'theme', theme }).then(r => r.theme),

  publicStations: () =>
    request<{ stations: PublicStation[] }>('stations.php?action=public').then(r => r.stations),
  myStations: () => request<{ stations: OwnedStation[] }>('stations.php?action=mine').then(r => r.stations),
  saveStation: (input: StationInput) =>
    post<{ station: OwnedStation }>('stations.php', {
      action: 'save',
      id: input.id,
      name: input.name,
      slug: input.slug,
      api_key: input.apiKey,
      application_key: input.applicationKey,
      mac_address: input.macAddress,
      latitude: input.latitude,
      longitude: input.longitude,
      forecast_provider: input.forecastProvider,
      is_public: input.isPublic,
    }).then(r => r.station),
  deleteStation: (id: number) => post('stations.php', { action: 'delete', id }),
  checkSlugAvailable: (slug: string, excludeId?: number) =>
    request<{ available: boolean }>(`stations.php?action=check-slug&slug=${q(slug)}&id=${excludeId ?? 0}`).then(r => r.available),
  searchPlaces: (query: string) => request<{ places: Place[] }>(`geocode.php?q=${q(query)}`).then(r => r.places),
  describeLocation: (lat: number, lon: number) =>
    request<{ place: string | null }>(`geocode.php?lat=${lat}&lon=${lon}`).then(r => r.place),

  current: (slug: string, live = false) =>
    request<{ station: StationInfo; reading: Reading | null; stats: StationStats }>(
      `current.php?slug=${q(slug)}${live ? '&live=1' : ''}`,
    ),
  history: (slug: string, range: HistoryRange) =>
    request<{ points: HistoryPoint[] }>(`history.php?slug=${q(slug)}&range=${range}`).then(r => r.points),
  forecast: (slug: string) => request<ForecastResponse>(`forecast.php?slug=${q(slug)}`).then(parseForecast),
  records: (slug: string) => request<{ records: DayRecords }>(`records.php?slug=${q(slug)}`).then(r => r.records),
  alerts: (slug: string) => request<AlertsData>(`alerts.php?slug=${q(slug)}`),
  airQuality: (slug: string) =>
    request<{ time?: unknown; aqi?: unknown; pollutants?: { id?: unknown; aqi?: unknown; concentration?: unknown }[]; hourly?: { time?: unknown[]; aqi?: unknown[] } }>(
      `airquality.php?slug=${q(slug)}`,
    ).then((r): AirQuality => {
      const num = (v: unknown) => (typeof v === 'number' ? v : null);
      return {
        time: num(r.time),
        aqi: num(r.aqi),
        pollutants: (r.pollutants ?? [])
          .filter(p => ['pm2_5', 'pm10', 'ozone', 'no2'].includes(String(p.id)))
          .map(p => ({ id: p.id as PollutantId, aqi: num(p.aqi), concentration: num(p.concentration) })),
        hourly: (r.hourly?.time ?? []).map((time, i) => ({ time: Number(time), aqi: num(r.hourly?.aqi?.[i]) })),
      };
    }),
  moonImage: () => request<{ north?: unknown; south?: unknown }>('lunar.php')
    .then(r => (typeof r.north === 'string' && typeof r.south === 'string' ? { north: r.north, south: r.south } : null)),
  nowcast: (slug: string) =>
    request<{ time?: unknown[]; precipitation?: unknown[]; probability?: unknown[] }>(`nowcast.php?slug=${q(slug)}`)
      .then((r): NowcastStep[] => (r.time ?? []).map((time, i) => ({
        time: Number(time),
        precip: typeof r.precipitation?.[i] === 'number' ? (r.precipitation[i] as number) : null,
        probability: typeof r.probability?.[i] === 'number' ? (r.probability[i] as number) : null,
      }))),
};

/**
 * Both providers answer in Open-Meteo's columnar layout: parallel arrays keyed
 * by field name, indexed by day or hour. `detail_text` only comes from NWS.
 */
interface ForecastResponse {
  source?: ForecastSource;
  timezone: string;
  daily?: Record<string, (number | string | null)[] | undefined> | null;
  hourly?: Record<string, (number | string | null)[] | undefined> | null;
  /** "block.column" for each column Open-Meteo filled into a National Weather Service forecast. */
  supplemented?: string[];
}

function parseForecast(data: ForecastResponse): ForecastData {
  const d = data.daily ?? {};
  const h = data.hourly ?? {};
  const at = (series: (number | string | null)[] | undefined, i: number) => {
    const value = series?.[i];
    return typeof value === 'number' ? value : null;
  };
  const text = (series: (number | string | null)[] | undefined, i: number) => {
    const value = series?.[i];
    return typeof value === 'string' && value !== '' ? value : null;
  };

  const source: ForecastSource = data.source === 'nws' ? 'nws' : 'open-meteo';
  // Absent when every rain total came from the forecast's own service.
  const precipSource = (i: number): ForecastSource | null => {
    if (at(d.precipitation_sum, i) === null) return null;
    const named = d.precipitation_sum_source?.[i];
    return named === 'nws' || named === 'open-meteo' ? named : source;
  };

  return {
    source,
    timezone: data.timezone,
    supplemented: Array.isArray(data.supplemented) ? data.supplemented.filter((c): c is string => typeof c === 'string') : [],
    daily: (d.time ?? []).map((time, i) => ({
      time: time as number,
      weatherCode: at(d.weather_code, i),
      tempMax: at(d.temperature_2m_max, i),
      tempMin: at(d.temperature_2m_min, i),
      popMax: at(d.precipitation_probability_max, i),
      precipSum: at(d.precipitation_sum, i),
      precipSource: precipSource(i),
      windSpeedMax: at(d.wind_speed_10m_max, i),
      windGustMax: at(d.wind_gusts_10m_max, i),
      windDirectionMax: at(d.wind_direction_10m_dominant, i),
      uvIndexMax: at(d.uv_index_max, i),
      sunrise: at(d.sunrise, i),
      sunset: at(d.sunset, i),
      detailText: text(d.detail_text, i),
    })),
    hourly: (h.time ?? []).map((time, i) => ({
      time: time as number,
      temp: at(h.temperature_2m, i),
      pop: at(h.precipitation_probability, i),
      weatherCode: at(h.weather_code, i),
      feelsLike: at(h.apparent_temperature, i),
      dewPoint: at(h.dew_point_2m, i),
      humidity: at(h.relative_humidity_2m, i),
      windSpeed: at(h.wind_speed_10m, i),
      windGust: at(h.wind_gusts_10m, i),
      windDirection: at(h.wind_direction_10m, i),
      precip: at(h.precipitation, i),
      uv: at(h.uv_index, i),
      cloudCover: at(h.cloud_cover, i),
    })),
  };
}
