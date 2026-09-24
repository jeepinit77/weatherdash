import React from 'react';
import { AlmanacDetail } from './AlmanacDetail';
import { DetailHistory } from './DetailHistory';
import { RadarDetail } from './RadarDetail';
import type { PlotSeries } from './plotSeries';
import { DetailModal, DetailSection, DetailStat, DetailStats } from '../ui/DetailModal';
import { clockAt, fmt, formatInZone, tempColor, timeAgo, windCardinal } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { useUnits, type Units } from '../../lib/units';
import { UV_TONE, upcomingDays, uvCategory } from '../../lib/weather';
import { AQI_BANDS, POLLUTANT_NAME, aqiBand } from '../../lib/aqi';
import { moonNow, moonTimesToday, phaseName, upcomingPhases } from '../../lib/moon';
import { MoonPhoto } from '../tiles/MoonPhoto';
import type { AirQuality, DayRecords, ForecastData, HistoryRange, Reading, StationStats, WidgetType } from '../../types/weather';

export interface DetailData {
  reading: Reading;
  stats: StationStats;
  records: DayRecords | null;
  forecast: ForecastData | null;
  timezone: string | null;
  air: AirQuality | null;
  /** Rounded station coordinates, for the moon. */
  lat: number | null;
  lon: number | null;
}

/** The widgets that open a popup when tapped. The rest either have their own taps or are already the detail. */
export const DETAIL_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>([
  'temperature', 'wind', 'rain', 'humidity', 'pressure', 'uv-solar', 'clock-daylight', 'time-date', 'indoor', 'air-quality', 'moon', 'radar', 'almanac',
]);

const daily = (range: HistoryRange) => range === '30d' || range === '1y';

const withUnit = (value: string, unit: string) => (value === '—' ? value : `${value} ${unit}`);

/** "13h 04m" */
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "+2m 14s", "−1m 03s" */
function durationChange(seconds: number): string {
  const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : '±';
  const abs = Math.round(Math.abs(seconds));
  return `${sign}${Math.floor(abs / 60)}m ${String(abs % 60).padStart(2, '0')}s`;
}

const tempSeries = (units: Units) => (range: HistoryRange): PlotSeries[] => daily(range)
  ? [
    { key: 'tempMax', label: 'High', token: '--chart-temp-high', convert: units.temp, unit: '°' },
    { key: 'tempMin', label: 'Low', token: '--chart-temp-low', convert: units.temp, unit: '°' },
  ]
  : [
    { key: 'tempf', label: 'Temperature', token: '--chart-temp-high', convert: units.temp, unit: '°' },
    { key: 'dewPoint', label: 'Dew point', token: '--chart-dew', convert: units.temp, unit: '°', style: 'dashed' },
  ];

const TemperatureDetail: React.FC<{ data: DetailData }> = ({ data: { reading, stats, records, timezone } }) => {
  const units = useUnits();
  const deg = (f: number | null | undefined) => fmt(units.temp(f), 0, '°');
  const at = (iso: string | null) => (iso ? `at ${clockAt(iso, timezone)}` : null);
  return (
    <>
      <DetailStats>
        <DetailStat label="Now" value={<span style={{ color: tempColor(reading.tempf) }}>{deg(reading.tempf)}</span>} />
        <DetailStat label="Feels like" value={deg(reading.feelsLike)} />
        <DetailStat label="Dew point" value={deg(reading.dewPoint)} />
        <DetailStat label="Today's high" value={deg(stats.today.high.value)} note={at(stats.today.high.at)} />
        <DetailStat label="Today's low" tone="text-cool" value={deg(stats.today.low.value)} note={at(stats.today.low.at)} />
      </DetailStats>
      <DetailStats>
        <DetailStat label="Yesterday high" value={deg(stats.yesterday.high.value)} note={at(stats.yesterday.high.at)} />
        <DetailStat label="Yesterday low" tone="text-cool" value={deg(stats.yesterday.low.value)} note={at(stats.yesterday.low.at)} />
        {records?.recordHigh && <DetailStat label="Record high" value={deg(records.recordHigh.value)} note={`in ${records.recordHigh.year}`} />}
        {records?.recordLow && <DetailStat label="Record low" tone="text-cool" value={deg(records.recordLow.value)} note={`in ${records.recordLow.year}`} />}
      </DetailStats>
      <DetailHistory series={tempSeries(units)} ranges={['24h', '7d', '30d', '1y']} />
    </>
  );
};

const WindDetail: React.FC<{ data: DetailData }> = ({ data: { reading, stats } }) => {
  const units = useUnits();
  const speed = (mph: number | null | undefined) => withUnit(fmt(units.speed(mph), 0), units.speedUnit);
  return (
    <>
      <DetailStats>
        <DetailStat label="Speed" value={speed(reading.windspeedmph)} />
        <DetailStat label="Gust" value={speed(reading.windgustmph)} />
        <DetailStat
          label="From"
          value={reading.winddir === null ? '—' : windCardinal(reading.winddir)}
          note={reading.winddir === null ? null : `${reading.winddir}°`}
        />
        <DetailStat label="15-min average" value={speed(stats.windAvg15)} />
        <DetailStat label="Today's max gust" value={speed(stats.today.maxGust ?? reading.maxdailygust)} />
        <DetailStat label="Yesterday's max" value={speed(stats.yesterday.maxGust)} />
      </DetailStats>
      <DetailHistory
        ranges={['24h', '7d', '30d']}
        series={range => [
          { key: 'windgustmph', label: daily(range) ? 'Max gust' : 'Gust', token: '--chart-gust', convert: units.speed, unit: ` ${units.speedUnit}` },
          { key: 'windspeedmph', label: daily(range) ? 'Average' : 'Speed', token: '--chart-wind', convert: units.speed, unit: ` ${units.speedUnit}`, style: 'area' },
        ]}
      />
    </>
  );
};

const RainDetail: React.FC<{ data: DetailData }> = ({ data: { reading, stats } }) => {
  const units = useUnits();
  const amount = (inches: number | null | undefined) => withUnit(units.formatRain(inches), units.rainUnit);
  return (
    <>
      <DetailStats>
        <DetailStat label="Today" tone="text-info-text" value={amount(reading.dailyrainin)} />
        <DetailStat label="Rate now" value={reading.hourlyrainin === null ? '—' : `${units.formatRain(reading.hourlyrainin)} ${units.rainUnit}/hr`} />
        <DetailStat label="This event" value={amount(reading.eventrainin)} />
        <DetailStat label="Last rain" value={reading.lastRain ? timeAgo(reading.lastRain) : '—'} />
      </DetailStats>
      <DetailStats>
        <DetailStat label="7 days" value={amount(stats.rain7d)} />
        <DetailStat label="This month" value={amount(reading.monthlyrainin)} />
        <DetailStat label="This year" value={amount(reading.yearlyrainin)} />
      </DetailStats>
      <DetailHistory
        ranges={['30d', '1y', '24h']}
        series={range => [daily(range)
          ? { key: 'rainin', label: 'Rain per day', token: '--chart-rain', convert: units.rain, digits: units.rainDigits, unit: ` ${units.rainUnit}`, style: 'bar' }
          : { key: 'rainin', label: 'Rain since midnight', token: '--chart-rain', convert: units.rain, digits: units.rainDigits, unit: ` ${units.rainUnit}`, style: 'step' }]}
      />
    </>
  );
};

const HumidityDetail: React.FC<{ data: DetailData }> = ({ data: { reading, stats } }) => {
  const units = useUnits();
  return (
    <>
      <DetailStats>
        <DetailStat label="Now" tone="text-info-text" value={fmt(reading.humidity, 0, '%')} />
        <DetailStat label="Today's high" value={fmt(stats.today.humidityHigh, 0, '%')} />
        <DetailStat label="Today's low" value={fmt(stats.today.humidityLow, 0, '%')} />
        <DetailStat label="Dew point" value={fmt(units.temp(reading.dewPoint), 0, '°')} />
        <DetailStat label="Indoors" value={fmt(reading.humidityin, 0, '%')} />
      </DetailStats>
      <DetailHistory
        series={[
          { key: 'humidity', label: 'Humidity', token: '--humid-now', unit: '%' },
        ]}
      />
    </>
  );
};

const PressureDetail: React.FC<{ data: DetailData }> = ({ data: { reading, stats } }) => {
  const units = useUnits();
  const p = (inHg: number | null) => withUnit(fmt(units.pressure(inHg), units.pressureDigits), units.pressureUnit);
  const change = units.pressure(stats.baromTrend3h);
  const changeDigits = units.pressureUnit === 'hPa' ? 1 : 2;
  return (
    <>
      <DetailStats>
        <DetailStat label="Relative (sea level)" value={p(reading.baromrelin)} />
        <DetailStat label="Absolute (station)" value={p(reading.baromabsin)} />
        <DetailStat
          label="Change, 3 hours"
          value={change === null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change).toFixed(changeDigits)}`}
          note={change === null ? null : units.pressureUnit}
        />
      </DetailStats>
      <DetailHistory
        ranges={['24h', '7d', '30d']}
        series={[{ key: 'baromrelin', label: 'Relative pressure', token: '--chart-pressure', convert: units.pressure, digits: units.pressureDigits, unit: ` ${units.pressureUnit}` }]}
      />
    </>
  );
};

const UvSolarDetail: React.FC<{ data: DetailData }> = ({ data: { reading, forecast, timezone } }) => {
  const today = forecast ? upcomingDays(forecast.daily, timezone, new Date()).find(d => d.relative === 'Today')?.day : undefined;
  const band = reading.uv === null ? null : uvCategory(reading.uv);
  const peak = today?.uvIndexMax ?? null;
  return (
    <>
      <DetailStats>
        <DetailStat label="UV index now" tone={band ? UV_TONE[band] : 'text-ink'} value={fmt(reading.uv, 0)} note={band} />
        <DetailStat label="Forecast peak today" tone={peak === null ? 'text-ink' : UV_TONE[uvCategory(peak)]} value={fmt(peak, 0)} note={peak === null ? null : uvCategory(peak)} />
        <DetailStat label="Solar radiation" value={withUnit(fmt(reading.solarradiation, 0), 'W/m²')} />
      </DetailStats>
      <DetailHistory series={[{ key: 'solarradiation', label: 'Solar radiation', token: '--chart-solar', unit: ' W/m²', style: 'area' }]} />
    </>
  );
};

const DaylightDetail: React.FC<{ data: DetailData }> = ({ data: { forecast, timezone } }) => {
  const days = forecast ? upcomingDays(forecast.daily, timezone, new Date()) : [];
  const clock = (unix: number | null) => (unix === null ? '—' : formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' }));
  const length = (d: { sunrise: number | null; sunset: number | null }) => (d.sunrise !== null && d.sunset !== null ? d.sunset - d.sunrise : null);
  const today = days[0]?.day;
  const tomorrow = days[1]?.day;
  const todayLength = today ? length(today) : null;
  const tomorrowLength = tomorrow ? length(tomorrow) : null;
  const noon = today?.sunrise != null && today.sunset != null ? Math.round((today.sunrise + today.sunset) / 2) : null;

  if (!today) return <p className="mt-6 text-ink-3">Sun times come with the forecast, which hasn't loaded.</p>;
  return (
    <>
      <DetailStats>
        <DetailStat label="Sunrise" tone="text-sunrise" value={clock(today.sunrise)} />
        <DetailStat label="Solar noon" value={clock(noon)} />
        <DetailStat label="Sunset" tone="text-sunset" value={clock(today.sunset)} />
        <DetailStat
          label="Daylight"
          value={todayLength === null ? '—' : duration(todayLength)}
          note={todayLength !== null && tomorrowLength !== null ? `${durationChange(tomorrowLength - todayLength)} tomorrow` : null}
        />
      </DetailStats>
      <DetailSection title="The week ahead">
        <div className="grid grid-cols-[auto_auto_auto_auto] justify-start gap-x-8 sm:gap-x-12 gap-y-2 text-sm sm:text-base">
          <span className="text-ink-3 text-xs font-bold uppercase tracking-wider">Day</span>
          <span className="text-ink-3 text-xs font-bold uppercase tracking-wider">Sunrise</span>
          <span className="text-ink-3 text-xs font-bold uppercase tracking-wider">Sunset</span>
          <span className="text-ink-3 text-xs font-bold uppercase tracking-wider">Daylight</span>
          {days.slice(0, 7).map(({ day, relative }) => {
            const l = length(day);
            return (
              <React.Fragment key={day.time}>
                <span className="font-bold text-ink-2">{relative ?? formatInZone(new Date(day.time * 1000), timezone, { weekday: 'long' })}</span>
                <span className="text-ink">{clock(day.sunrise)}</span>
                <span className="text-ink">{clock(day.sunset)}</span>
                <span className="text-ink">{l === null ? '—' : duration(l)}</span>
              </React.Fragment>
            );
          })}
        </div>
      </DetailSection>
    </>
  );
};

const IndoorDetail: React.FC<{ data: DetailData }> = ({ data: { reading } }) => {
  const units = useUnits();
  const deg = (f: number | null) => fmt(units.temp(f), 0, '°');
  const tempDiff = reading.tempinf !== null && reading.tempf !== null ? units.tempDelta(reading.tempinf - reading.tempf) : null;
  const tempGap = tempDiff === null ? '—' : Math.round(tempDiff) === 0 ? 'Same' : `${Math.abs(tempDiff).toFixed(0)}° ${tempDiff > 0 ? 'warmer' : 'cooler'}`;
  const humidDiff = reading.humidityin !== null && reading.humidity !== null ? reading.humidityin - reading.humidity : null;
  const humidityGap = humidDiff === null ? '—' : Math.round(humidDiff) === 0 ? 'Same' : `${Math.abs(humidDiff).toFixed(0)}% ${humidDiff > 0 ? 'more humid' : 'drier'}`;
  return (
    <>
      <DetailStats>
        <DetailStat label="Temperature" value={<span style={{ color: tempColor(reading.tempinf) }}>{deg(reading.tempinf)}</span>} />
        <DetailStat label="Feels like" value={deg(reading.feelsLikein)} />
        <DetailStat label="Humidity" tone="text-info-text" value={fmt(reading.humidityin, 0, '%')} />
        <DetailStat label="Dew point" value={deg(reading.dewPointin)} />
      </DetailStats>
      <DetailSection title="Compared with outside">
        <DetailStats className="">
          <DetailStat label="Temperature" value={tempGap} note={`outside ${deg(reading.tempf)}`} />
          <DetailStat label="Humidity" value={humidityGap} note={`outside ${fmt(reading.humidity, 0, '%')}`} />
        </DetailStats>
      </DetailSection>
    </>
  );
};

const AirDetail: React.FC<{ data: DetailData }> = ({ data: { air, timezone } }) => {
  const now = useNow(60_000);
  if (!air || air.aqi === null) return <p className="mt-6 text-ink-3">Air quality has not loaded yet.</p>;
  const band = aqiBand(air.aqi);
  const nowUnix = now.getTime() / 1000;
  const hours = air.hourly.filter(h => h.time + 3600 > nowUnix).slice(0, 24);
  const top = Math.max(100, ...hours.map(h => h.aqi ?? 0));
  return (
    <>
      <div className="mt-6 flex items-center gap-5">
        <div className="text-6xl sm:text-7xl font-black leading-none" style={{ color: band.color }}>{fmt(air.aqi, 0)}</div>
        <div>
          <div className="text-xl sm:text-2xl font-bold text-ink">{band.label}</div>
          <p className="mt-1 text-sm sm:text-base text-ink-2 max-w-2xl">{band.advice}</p>
        </div>
      </div>

      <DetailSection title="By pollutant">
        <div className="space-y-3 max-w-3xl">
          {air.pollutants.map(p => (
            <div key={p.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="text-ink-2 font-semibold truncate">{POLLUTANT_NAME[p.id]}</span>
              <span className="h-2.5 rounded-full bg-well overflow-hidden">
                {p.aqi !== null && (
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, p.aqi / 2))}%`, background: aqiBand(p.aqi).color }} />
                )}
              </span>
              <span className="text-ink font-bold tabular-nums text-right">
                {fmt(p.aqi, 0)}
                <span className="ml-2 text-xs font-normal text-ink-3">{p.concentration === null ? '' : `${fmt(p.concentration, 1)} µg/m³`}</span>
              </span>
            </div>
          ))}
        </div>
      </DetailSection>

      {hours.length > 0 && (
        <DetailSection title="Next 24 hours">
          <div className="flex items-end gap-1 h-[clamp(4.5rem,14vh,7rem)]">
            {hours.map((h, i) => (
              <div key={h.time} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1">
                {h.aqi !== null && (
                  <span
                    className="w-full rounded-t"
                    style={{ height: `${Math.max(4, (h.aqi / top) * 100)}%`, background: aqiBand(h.aqi).color }}
                    title={`${fmt(h.aqi, 0)} · ${aqiBand(h.aqi).label}`}
                  />
                )}
                <span className="text-[10px] text-ink-3 h-3 whitespace-nowrap">{i % 3 === 0 ? formatInZone(new Date(h.time * 1000), timezone, { hour: 'numeric' }) : ''}</span>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        {AQI_BANDS.map((b, i) => (
          <span key={b.label} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />
            {i === 0 ? 0 : AQI_BANDS[i - 1].max + 1}–{b.max} {b.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-4">Modelled by Open-Meteo (Copernicus CAMS).</p>
    </>
  );
};

const KM_TO_MILES = 0.621371;

const MoonDetail: React.FC<{ data: DetailData }> = ({ data: { timezone, lat, lon } }) => {
  const units = useUnits();
  const now = useNow(60_000);
  const nowUnix = now.getTime() / 1000;
  const moon = moonNow(nowUnix, lat, lon);
  const times = lat !== null && lon !== null ? moonTimesToday(nowUnix, timezone, lat, lon) : null;
  const phases = upcomingPhases(nowUnix);
  const clock = (unix: number | null) => (unix === null ? '—' : formatInZone(new Date(unix * 1000), timezone, { hour: 'numeric', minute: '2-digit' }));
  const position = moon.position;
  return (
    <>
      <div className="mt-6 flex items-center gap-6">
        <MoonPhoto southern={(lat ?? 0) < 0} className="w-28 h-28 sm:w-36 sm:h-36 shrink-0" />
        <div>
          <div className="text-2xl sm:text-3xl font-black text-ink">{phaseName(moon.phase)}</div>
          <div className="text-ink-2">{Math.round(moon.fraction * 100)}% lit, {moon.waxing ? 'waxing' : 'waning'}</div>
        </div>
      </div>
      <DetailStats>
        {times && <DetailStat label="Rises today" value={clock(times.rise)} />}
        {times && <DetailStat label="Sets today" value={clock(times.set)} />}
        {position && (
          <DetailStat
            label="Right now"
            value={position.altitude > 0 ? `${Math.round(position.altitude)}° up` : 'Below horizon'}
            note={position.altitude > 0 ? `in the ${windCardinal(position.azimuth)}` : null}
          />
        )}
        {position && (
          <DetailStat
            label="Distance"
            value={units.system === 'metric'
              ? `${Math.round(position.distance).toLocaleString()} km`
              : `${Math.round(position.distance * KM_TO_MILES).toLocaleString()} mi`}
          />
        )}
      </DetailStats>
      <DetailSection title="Coming phases">
        <div className="grid grid-cols-[auto_auto_auto] justify-start gap-x-8 gap-y-2 text-sm sm:text-base">
          {phases.map(p => (
            <React.Fragment key={p.key}>
              <span className="font-bold text-ink">{p.label}</span>
              <span className="text-ink-2">
                {/* The date only: the phase maths is good to an hour or so, not to the minute. */}
                {formatInZone(new Date(p.time * 1000), timezone, { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              <span className="text-ink-3">in {Math.max(0, Math.round((p.time - nowUnix) / 86400))} days</span>
            </React.Fragment>
          ))}
        </div>
      </DetailSection>
      <p className="mt-4 text-xs text-ink-4">Moon image: NASA Scientific Visualization Studio, Dial-A-Moon.</p>
    </>
  );
};

const TITLES: Partial<Record<WidgetType, string>> = {
  temperature: 'Temperature',
  wind: 'Wind',
  rain: 'Rain',
  humidity: 'Humidity',
  pressure: 'Pressure',
  'uv-solar': 'UV & Solar',
  'clock-daylight': 'Daylight',
  'time-date': 'Daylight',
  indoor: 'Indoors',
  'air-quality': 'Air Quality',
  moon: 'Moon',
  radar: 'Radar',
  almanac: 'Almanac',
};

/** The popup a tile opens when tapped. */
export const WidgetDetail: React.FC<{ type: WidgetType; data: DetailData; onClose: () => void }> = ({ type, data, onClose }) => {
  const body = (() => {
    switch (type) {
      case 'temperature': return <TemperatureDetail data={data} />;
      case 'wind': return <WindDetail data={data} />;
      case 'rain': return <RainDetail data={data} />;
      case 'humidity': return <HumidityDetail data={data} />;
      case 'pressure': return <PressureDetail data={data} />;
      case 'uv-solar': return <UvSolarDetail data={data} />;
      case 'clock-daylight':
      case 'time-date': return <DaylightDetail data={data} />;
      case 'indoor': return <IndoorDetail data={data} />;
      case 'air-quality': return <AirDetail data={data} />;
      case 'moon': return <MoonDetail data={data} />;
      case 'radar': return <RadarDetail lat={data.lat} lon={data.lon} timezone={data.timezone} />;
      case 'almanac': return <AlmanacDetail reading={data.reading} stats={data.stats} records={data.records} timezone={data.timezone} />;
      default: return null;
    }
  })();
  return (
    <DetailModal
      title={TITLES[type] ?? ''}
      subtitle={type === 'air-quality' || type === 'radar'
        ? undefined
        : type === 'clock-daylight' || type === 'time-date' || type === 'moon' || type === 'almanac'
        ? formatInZone(new Date(), data.timezone, { weekday: 'long', month: 'long', day: 'numeric' })
        : `Reading ${timeAgo(data.reading.date)}`}
      onClose={onClose}
    >
      {body}
    </DetailModal>
  );
};
