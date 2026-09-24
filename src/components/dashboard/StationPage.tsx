import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, LayoutGrid, Radio, SearchX, Hourglass, Maximize2, Minimize2, SlidersHorizontal, Share2, Check, Pencil } from 'lucide-react';
import { AlertsBanner } from './AlertsBanner';
import { AlertsCountButton } from './AlertsCountButton';
import { AlertsModal } from './AlertsModal';
import { AlertsTicker } from './AlertsTicker';
import { RainSoonBanner } from './RainSoonBanner';
import { DashboardGrid } from './DashboardGrid';
import { WidgetEditorModal } from '../widgets/WidgetEditorModal';
import { MockDataEditorModal } from '../dev/MockDataEditorModal';
import { api, ApiError } from '../../services/api';
import { STALE_AFTER_MINUTES, minutesSince, timeAgo } from '../../lib/format';
import { useIdleHidden } from '../../lib/useIdleHidden';
import { useNow } from '../../lib/useNow';
import { rainOutlook } from '../../lib/rainOutlook';
import { usePopupTimeout } from '../../lib/popupTimeout';
import { useVisiblePolling } from '../../lib/useVisiblePolling';
import { useWidgetLayout } from '../../lib/useWidgetLayout';
import type { AirQuality, DayRecords, ForecastData, HistoryPoint, HistoryRange, NowcastStep, Reading, StationInfo, StationStats, WeatherAlert } from '../../types/weather';

const REFRESH_MS = 60_000;
const HISTORY_REFRESH_MS = 5 * 60_000;
/** Today's records turn over at midnight; a wall display left for days must notice. */
const RECORDS_REFRESH_MS = 60 * 60_000;

/** The short-range rain outlook is cached ten minutes upstream; asking more often gains nothing. */
const NOWCAST_REFRESH_MS = 10 * 60_000;

/** Air quality is cached thirty minutes upstream. */
const AIR_REFRESH_MS = 30 * 60_000;

/** How long the full-screen header lingers before getting out of the way. */
const CHROME_IDLE_MS = 3_000;


type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; station: StationInfo; reading: Reading | null; stats: StationStats };

interface StationPageProps {
  slug: string;
  onNavigate: (slug: string | null) => void;
  fullscreen: { active: boolean; enter: () => void; exit: () => void };
  /** The header's slot for this page's controls; null while the header is not drawn. */
  toolbar: HTMLElement | null;
  /** Who is signed in. A change re-asks the server, which decides whether this viewer owns the station. */
  viewerId: number | null;
  /** Opens this station in the station editor (offered to its owner only). */
  onEditStation: () => void;
}

/** True when `next` is older than what is already on screen, so it must not replace it. */
function isOlderReading(next: Reading | null, shown: Reading | null): boolean {
  if (!next || !shown) return false;
  return Date.parse(next.date) < Date.parse(shown.date);
}

export const StationPage: React.FC<StationPageProps> = ({ slug, onNavigate, fullscreen, toolbar, viewerId, onEditStation }) => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Set when the last refresh failed after the page had loaded, so the viewer
  // is told the numbers may be old instead of finding out from the clock.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [range, setRange] = useState<HistoryRange>('24h');
  // null while the current range is still loading, so the chart never claims
  // "no history" before it has asked.
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [forecastError, setForecastError] = useState(false);
  const [records, setRecords] = useState<DayRecords | null>(null);
  const [nowcast, setNowcast] = useState<NowcastStep[]>([]);
  const [air, setAir] = useState<AirQuality | null>(null);
  const [airError, setAirError] = useState(false);
  // The rain banners the viewer has closed, by the time they announced. Kept for the visit only.
  const [dismissedRain, setDismissedRain] = useState<ReadonlySet<number>>(() => new Set());
  const now = useNow(60_000);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  // Alert bars the viewer has closed, by id. Kept for the visit only: a warning
  // is worth showing again on a fresh load.
  const [dismissedAlerts, setDismissedAlerts] = useState<ReadonlySet<string>>(() => new Set());
  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isWidgetModalOpen, setIsWidgetModalOpen] = useState(false);
  const [isMockEditorOpen, setIsMockEditorOpen] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const layout = useWidgetLayout(slug);
  const chromeHidden = useIdleHidden(fullscreen.active, CHROME_IDLE_MS);
  // On the wall, an alerts panel someone opened closes itself on the viewer's popup timer.
  const popupSeconds = usePopupTimeout();

  // Each kind of request is numbered, so an answer that arrives after a newer
  // request was sent is dropped rather than drawn over the newer one.
  const historyRequest = useRef(0);
  const historyRange = useRef<HistoryRange | null>(null);
  const forecastRequest = useRef(0);
  const alertsRequest = useRef(0);

  const loadHistory = useCallback((r: HistoryRange) => {
    const id = ++historyRequest.current;
    if (historyRange.current !== r) {
      // A different range: what is on screen no longer answers the question.
      historyRange.current = r;
      setHistory(null);
      setHistoryError(false);
    }
    api.history(slug, r)
      .then(points => {
        if (id !== historyRequest.current) return;
        setHistory(points);
        setHistoryError(false);
      })
      .catch(() => { if (id === historyRequest.current) setHistoryError(true); });
  }, [slug]);

  const loadForecastAndAlerts = useCallback(() => {
    const forecastId = ++forecastRequest.current;
    api.forecast(slug)
      .then(f => {
        if (forecastId !== forecastRequest.current) return;
        setForecast(f);
        setForecastError(false);
      })
      .catch(() => { if (forecastId === forecastRequest.current) setForecastError(true); });

    // Cached for five minutes server-side, so asking on every pass is cheap.
    // A station the weather service does not cover answers with an empty
    // list, and a failure leaves the banner off rather than guessing.
    const alertsId = ++alertsRequest.current;
    api.alerts(slug)
      .then(a => {
        if (alertsId !== alertsRequest.current) return;
        const active = a.supported ? a.alerts : [];
        setAlerts(active);
        // Forget alerts that have lapsed, so the set cannot grow without
        // bound and a reissued id is not silently swallowed.
        setDismissedAlerts(prev => {
          const live = active.filter(alert => prev.has(alert.id)).map(alert => alert.id);
          return live.length === prev.size ? prev : new Set(live);
        });
      })
      .catch(() => { if (alertsId === alertsRequest.current) setAlerts([]); });
  }, [slug]);

  const refresh = useCallback(async (live = false) => {
    try {
      const { station, reading, stats } = await api.current(slug, live);
      // A slow answer can land after a quicker, newer one (the minute timer
      // racing a live refresh); keep whichever reading is more recent.
      setState(prev => (prev.status === 'ready' && isOlderReading(reading, prev.reading)
        ? prev
        : { status: 'ready', station, reading, stats }));
      setRefreshFailed(false);
      loadForecastAndAlerts();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setState({ status: 'not-found' });
      } else {
        setRefreshFailed(true);
        setState(prev => (prev.status === 'ready' ? prev : { status: 'error', message: (e as Error).message }));
      }
    }
  }, [slug, loadForecastAndAlerts]);

  useVisiblePolling(() => { void refresh(); }, REFRESH_MS, [viewerId]);
  useVisiblePolling(() => loadHistory(range), HISTORY_REFRESH_MS, [range]);
  useVisiblePolling(() => {
    api.records(slug).then(setRecords).catch(() => setRecords(null));
  }, RECORDS_REFRESH_MS);
  // Only asked for while the tile is on the dashboard.
  const wantsAir = layout.widgets.some(w => w.type === 'air-quality' && w.enabled);
  useVisiblePolling(() => {
    if (!wantsAir) return;
    api.airQuality(slug)
      .then(a => { setAir(a); setAirError(false); })
      .catch(() => setAirError(true));
  }, AIR_REFRESH_MS, [wantsAir]);
  // A failure clears the banner rather than leaving an old warning up.
  useVisiblePolling(() => {
    api.nowcast(slug).then(setNowcast).catch(() => setNowcast([]));
  }, NOWCAST_REFRESH_MS);

  const stationName = state.status === 'ready' ? state.station.name : null;
  useEffect(() => {
    if (stationName === null) return;
    document.title = `${stationName} · WeatherDash`;
    return () => { document.title = 'WeatherDash'; };
  }, [stationName]);

  const handleRefreshClick = () => {
    setIsRefreshing(true);
    loadHistory(range);
    // Ask Ambient for a reading now, rather than redrawing what the poller last
    // stored. Only the owner sees this button: it spends their Ambient quota.
    refresh(true).finally(() => setIsRefreshing(false));
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: stationName ?? 'WeatherDash', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNote('Link copied');
    } catch (e) {
      // Closing the share sheet is not a failure worth reporting.
      if ((e as Error).name === 'AbortError') return;
      setShareNote('Copy the address bar to share');
    }
    window.setTimeout(() => setShareNote(''), 2500);
  };

  if (state.status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (state.status === 'not-found') {
    return (
      <MessageCard icon={<SearchX className="w-8 h-8 text-ink-3" />} title="Station not found">
        There's no station at <span className="font-mono text-info-text">/{slug}</span>.{' '}
        <button className="text-accent-text hover:underline" onClick={() => onNavigate(null)}>Browse public stations</button>
      </MessageCard>
    );
  }

  if (state.status === 'error') {
    return <MessageCard icon={<SearchX className="w-8 h-8 text-danger-text" />} title="Couldn't load this station">{state.message}</MessageCard>;
  }

  const { station, reading, stats } = state;
  const age = minutesSince(reading?.date);
  const isStale = age === null || age > STALE_AFTER_MINUTES;
  const timezone = station.timezone ?? forecast?.timezone ?? null;
  const visibleAlerts = alerts.filter(alert => !dismissedAlerts.has(alert.id));
  const nowUnix = now.getTime() / 1000;
  // The station's own rain gauge decides whether it is raining now; the outlook only says what changes next.
  const rain = rainOutlook(nowcast, (reading?.hourlyrainin ?? 0) > 0, nowUnix);
  const anyAlertsDismissed = visibleAlerts.length < alerts.length;
  // Closing a bar is the viewer's decision and nothing here undoes it. The count
  // opens the alerts for reading instead, which is how a dismissed one is still
  // reachable.
  const dismissAlert = (id: string) => setDismissedAlerts(prev => new Set(prev).add(id));
  const dismissShownAlerts = () =>
    setDismissedAlerts(prev => new Set([...prev, ...visibleAlerts.map(alert => alert.id)]));

  // In full screen the floating alerts button never hides, so whatever comes
  // first on the page starts below it instead of underneath it.
  const clearFloatingButton = fullscreen.active && (anyAlertsDismissed || visibleAlerts.length > 0);

  const buttonClass = 'glass-button px-3 py-2 rounded-lg text-sm text-ink-2 flex items-center gap-2 transition hover:text-ink';
  // Labels only where the header has room for them; otherwise each button says what it does in its title.
  const labelClass = 'hidden xl:inline';
  const titleButtonClass = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-semibold text-ink-3 border border-line hover:text-ink hover:border-line-strong hover:bg-fill-soft transition';

  // Drawn inside the site header rather than in a bar of their own.
  const controls = (
    <>
      <AlertsCountButton
        alerts={alerts}
        onClick={() => setIsAlertsModalOpen(true)}
        variant="header"
      />
      <button onClick={() => setIsWidgetModalOpen(true)} className={buttonClass} title="Customize this dashboard">
        <LayoutGrid className="w-4 h-4 text-alt-text" />
        <span className={labelClass}>Customize</span>
      </button>
      {window.__mockData && (
        <button onClick={() => setIsMockEditorOpen(true)} className={buttonClass} title="Mock data">
          <SlidersHorizontal className="w-4 h-4 text-warn-text" />
          <span className={labelClass}>Mock Data</span>
        </button>
      )}
      <button onClick={fullscreen.enter} title="Full screen" className={buttonClass}>
        <Maximize2 className="w-4 h-4 text-info-text" />
        <span className={labelClass}>Full screen</span>
      </button>
    </>
  );

  return (
    <div className={`mx-auto px-4 md:px-8 ${fullscreen.active ? 'max-w-full pb-4 space-y-4' : 'max-w-[96rem] pb-12 space-y-6'}`}>
      {fullscreen.active ? (
        <>
        {/* The one way back to a closed alert, so unlike the header it never
            hides itself. Nothing is shown while every bar is still on screen. */}
        {anyAlertsDismissed && (
          <div className="fixed top-3 right-4 md:right-8 z-50">
            <AlertsCountButton alerts={alerts} onClick={() => setIsAlertsModalOpen(true)} variant="floating" />
          </div>
        )}
        {/* Floats over the dashboard rather than taking a row of its own, so the tiles get the full height. */}
        <div
          className={`fixed inset-x-0 top-0 z-40 px-4 md:px-8 pt-3 transition-all duration-300 ${
            chromeHidden ? 'opacity-0 -translate-y-3 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className={`flex items-center justify-between gap-3 rounded-xl border border-line bg-well-deep backdrop-blur px-4 py-2 ${
            anyAlertsDismissed ? 'pr-32 sm:pr-36' : ''
          }`}>
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="text-xl font-bold text-ink truncate">{station.name}</h1>
              <span className={`text-sm ${isStale ? 'text-warn-text' : 'text-ink-3'}`}>
                {isStale ? 'Stale · ' : ''}{timeAgo(reading?.date)}
              </span>
            </div>
            <button
              onClick={fullscreen.exit}
              title="Leave full screen (Esc)"
              className="glass-button p-2 rounded-lg text-ink-3 hover:text-ink transition shrink-0"
              aria-label="Leave full screen"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        {clearFloatingButton && <div className="h-6" aria-hidden="true" />}
        </>
      ) : (
      <div className="min-w-0">
        <div>
          {/* What can be done with the station itself sits with its name; the bar above is for the dashboard. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">{station.name}</h1>
            <div className="flex items-center gap-1">
              <button onClick={handleShare} className={titleButtonClass} title="Copy a link to this dashboard">
                {shareNote ? <Check className="w-3.5 h-3.5 text-good-text" /> : <Share2 className="w-3.5 h-3.5" />}
                <span aria-live="polite">{shareNote || 'Share'}</span>
              </button>
              {station.isOwner && (
                <button onClick={onEditStation} className={titleButtonClass} title="Name, location, forecast and connection">
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit station</span>
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-3 mt-1 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
              isStale ? 'bg-warn-soft text-warn-text border-warn-line' : 'bg-good-soft text-good-text border-good-line'
            }`}>
              <Radio className={`w-3 h-3 ${isStale ? '' : 'animate-pulse motion-reduce:animate-none'}`} />
              {isStale ? 'Stale' : 'Live'}
            </span>
            <span>Last reading {timeAgo(reading?.date)}</span>
            {station.isOwner && (
              <button
                onClick={handleRefreshClick}
                disabled={isRefreshing}
                title="Ask Ambient Weather for a reading now"
                aria-label="Ask Ambient Weather for a reading now"
                className="grid place-items-center w-6 h-6 -my-1 rounded-md text-ink-3 hover:text-ink hover:bg-fill transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-accent-text' : ''}`} />
              </button>
            )}
            {refreshFailed && <span className="text-warn-text">· Couldn't reach the server, retrying</span>}
          </p>
        </div>
        {toolbar && createPortal(controls, toolbar)}
      </div>
      )}

      {/* On the wall the header hides itself, so staleness gets a line of its
          own that stays up, large enough to read across the room. */}
      {fullscreen.active && isStale && (
        <div className="rounded-2xl border border-warn-line bg-warn-soft text-warn-text px-6 py-4 flex items-center gap-4" role="status">
          <Radio className="w-8 h-8 md:w-10 md:h-10 shrink-0" />
          <span className="text-2xl md:text-4xl font-black leading-tight">
            {reading ? `No new reading since ${timeAgo(reading.date)}` : 'No readings yet'}
          </span>
        </div>
      )}

      {visibleAlerts.length > 0 && (
        fullscreen.active ? (
          // A wall dashboard has nobody standing at it, so it gets headlines
          // in one bar that never grows and never covers the weather.
          <AlertsTicker
            alerts={visibleAlerts}
            timezone={timezone}
            onOpen={() => setIsAlertsModalOpen(true)}
            onDismissAll={dismissShownAlerts}
          />
        ) : (
          <AlertsBanner
            alerts={visibleAlerts}
            timezone={timezone}
            onDismiss={dismissAlert}
          />
        )
      )}

      {rain && !dismissedRain.has(rain.step) && (
        <RainSoonBanner
          outlook={rain}
          timezone={timezone}
          nowUnix={nowUnix}
          wall={fullscreen.active}
          onDismiss={fullscreen.active ? undefined : () => setDismissedRain(prev => new Set(prev).add(rain.step))}
        />
      )}

      {reading ? (
        <DashboardGrid
          widgets={layout.widgets}
          station={station}
          reading={reading}
          stats={stats}
          history={history}
          historyError={historyError}
          range={range}
          onRangeChange={setRange}
          forecast={forecast}
          forecastError={forecastError}
          records={records}
          air={air}
          airError={airError}
          fullscreen={fullscreen.active}
        />
      ) : (
        <MessageCard icon={<Hourglass className="w-8 h-8 text-warn-text" />} title="Waiting for the first reading">
          This station hasn't reported any data yet. Readings are collected every 5 minutes.
        </MessageCard>
      )}

      {isAlertsModalOpen && (
        <AlertsModal
          alerts={alerts}
          timezone={timezone}
          onClose={() => setIsAlertsModalOpen(false)}
          idleCloseMs={fullscreen.active ? popupSeconds * 1000 : undefined}
        />
      )}

      {isWidgetModalOpen && (
        <WidgetEditorModal
          widgets={layout.widgets}
          onChange={layout.set}
          onClose={() => setIsWidgetModalOpen(false)}
          signedIn={viewerId !== null}
        />
      )}

      {reading && (
        <MockDataEditorModal
          isOpen={isMockEditorOpen}
          reading={reading}
          stats={stats}
          onClose={() => setIsMockEditorOpen(false)}
          onApply={() => refresh(true)}
        />
      )}
    </div>
  );
};

/** Placeholder cards in the shape of the dashboard, so it does not jump when the data lands. */
const LoadingSkeleton: React.FC = () => (
  <div className="max-w-[96rem] mx-auto px-4 md:px-8 pb-12 space-y-6" aria-busy="true">
    <span className="sr-only">Loading station…</span>
    <div className="h-12 w-64 max-w-full rounded-lg bg-fill-soft animate-pulse motion-reduce:animate-none" />
    <div className="h-24"><div className="tile animate-pulse motion-reduce:animate-none" /></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-72"><div className="tile animate-pulse motion-reduce:animate-none" /></div>
      ))}
    </div>
  </div>
);

const MessageCard: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="max-w-2xl mx-auto px-4">
    <div className="tile p-8 text-center flex flex-col items-center gap-3">
      {icon}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-3">{children}</p>
    </div>
  </div>
);
