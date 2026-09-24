import React, { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowLeft, Check, ChevronDown, CloudSun, Eye, Globe, KeyRound, Link2, Loader2, LocateFixed, Lock, MapPin,
  Plug, Save, Search, Trash2,
} from 'lucide-react';
import { RadarMap } from '../tiles/RadarMap';
import { api } from '../../services/api';
import { timeAgo } from '../../lib/format';
import type { ForecastProvider, OwnedStation, Place } from '../../types/weather';

interface StationFormProps {
  /** Omitted when adding a new station. */
  station?: OwnedStation;
  onSaved: (station: OwnedStation) => void;
  onCancel: () => void;
  /** Asks to delete the station being edited. */
  onDelete?: () => void;
  /** Told whenever the form comes to hold, or stops holding, anything unsaved. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Stops browsers and password managers treating the key fields as a login form. */
const noAutofill = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

const inputClass =
  'w-full bg-well-deep border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent transition';
const labelClass = 'block text-sm font-semibold text-ink-2 mb-1.5';
const hintClass = 'text-xs text-ink-4 mt-1.5';

const toSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 40);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** Same comparison the server makes: case and separators do not matter. */
const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, '');

/** How long to wait after the user stops typing before checking the slug with the server. */
const SLUG_CHECK_DEBOUNCE_MS = 500;

/** Browser fixes coarser than this are an internet-based guess, not a real position. */
const COARSE_ACCURACY_METRES = 5000;

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken';

const FORECAST_SOURCES: { value: ForecastProvider; title: string; detail: string }[] = [
  {
    value: 'auto',
    title: 'Automatic',
    detail: 'The National Weather Service in the US, Open-Meteo everywhere else.',
  },
  {
    value: 'nws',
    title: 'National Weather Service',
    detail: 'Adds the forecaster’s written outlook. US only, and no UV index.',
  },
  {
    value: 'open-meteo',
    title: 'Open-Meteo',
    detail: 'Worldwide, and includes the daily UV index.',
  },
];

const placeLabel = (place: Place) => [place.name, place.region, place.country].filter(Boolean).join(', ');

/**
 * Adding or editing a station. The settings sit in sections on the left and a
 * card on the right shows the station as it will be: its name, its link, a map
 * of where it is, and what is still missing.
 */
export const StationForm: React.FC<StationFormProps> = ({ station, onSaved, onCancel, onDelete, onDirtyChange }) => {
  const [name, setName] = useState(station?.name ?? '');
  const [slug, setSlug] = useState(station?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!station);
  // The server's answer for the last slug it was asked about. The status shown
  // is derived from it, so an answer for an older spelling is never displayed.
  const [slugCheck, setSlugCheck] = useState<{ slug: string; available: boolean | null } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [applicationKey, setApplicationKey] = useState('');
  const [macAddress, setMacAddress] = useState(station?.macAddress ?? '');
  const [latitude, setLatitude] = useState(station ? String(station.latitude) : '');
  const [longitude, setLongitude] = useState(station ? String(station.longitude) : '');
  const [forecastProvider, setForecastProvider] = useState<ForecastProvider>(station?.forecastProvider ?? 'auto');
  const [isPublic, setIsPublic] = useState(station?.isPublic ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState('');
  // A station that is already connected keeps its keys unless asked to replace them.
  // One saved before application keys were asked for has to be given one.
  const [replacingKeys, setReplacingKeys] = useState(!station || !station.appKeyHint);
  const [showAdvanced, setShowAdvanced] = useState(!!station?.macAddress);

  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [chosenPlace, setChosenPlace] = useState('');
  const [locationWarning, setLocationWarning] = useState('');
  const [showCoordinates, setShowCoordinates] = useState(false);

  // Name the saved location, so an existing station reads as a town rather than coordinates.
  useEffect(() => {
    if (!station) return;
    let live = true;
    api.describeLocation(station.latitude, station.longitude)
      .then(place => { if (live && place) setChosenPlace(current => current || place); })
      .catch(() => {});
    return () => { live = false; };
  }, [station]);

  const searchPlaces = async () => {
    if (placeQuery.trim().length < 2) return;
    setIsSearching(true);
    setError('');
    try {
      setPlaces(await api.searchPlaces(placeQuery.trim()));
    } catch (err) {
      setError((err as Error).message);
      setPlaces([]);
    } finally {
      setIsSearching(false);
    }
  };

  const choosePlace = (place: Place) => {
    setLatitude(String(place.latitude));
    setLongitude(String(place.longitude));
    setChosenPlace(placeLabel(place));
    setPlaces(null);
    setPlaceQuery('');
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Your browser does not share location; search for your town instead');
      return;
    }
    setIsLocating(true);
    setLocationWarning('');
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        setLatitude(String(lat));
        setLongitude(String(lon));
        setPlaces(null);

        // Name the spot so it reads like a searched place rather than raw coordinates
        const place = await api.describeLocation(lat, lon).catch(() => null);
        setChosenPlace(place ?? 'Your current location');

        const accuracy = pos.coords.accuracy;
        if (accuracy && accuracy > COARSE_ACCURACY_METRES) {
          const miles = Math.round(accuracy / 1609);
          setLocationWarning(
            `Your browser could only place you within about ${miles} miles, which usually means it guessed from your internet connection rather than your actual position. Check the town above, and search for it instead if it is wrong.`,
          );
        }
        setIsLocating(false);
      },
      () => {
        setError('Could not get your location; search for your town instead');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // What will actually be saved: trailing dashes are allowed while typing, so a
  // name can be followed by another word, but never end the link.
  const finalSlug = slug.replace(/-+$/, '');
  const slugIsValid = SLUG_PATTERN.test(finalSlug);
  const slugNeedsCheck = slugIsValid && finalSlug !== station?.slug;

  let slugStatus: SlugStatus = 'idle';
  if (slugNeedsCheck) {
    if (slugCheck?.slug !== finalSlug) slugStatus = 'checking';
    else if (slugCheck.available !== null) slugStatus = slugCheck.available ? 'available' : 'taken';
  }

  useEffect(() => {
    if (!slugNeedsCheck) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      api.checkSlugAvailable(finalSlug, station?.id)
        .then(available => { if (!cancelled) setSlugCheck({ slug: finalSlug, available }); })
        .catch(() => { if (!cancelled) setSlugCheck({ slug: finalSlug, available: null }); });
    }, SLUG_CHECK_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(handle); };
  }, [finalSlug, slugNeedsCheck, station?.id]);

  const lat = Number(latitude);
  const lon = Number(longitude);
  const hasLocation = latitude.trim() !== '' && longitude.trim() !== '' && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const hasKeys = !replacingKeys || (apiKey.trim() !== '' && applicationKey.trim() !== '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!hasLocation) {
      setError('Search for the nearest town so the forecast is for the right place');
      return;
    }
    if (!slugIsValid) {
      setError('Choose a dashboard link of 3-40 lowercase letters, numbers or dashes, starting with a letter or number');
      return;
    }
    setIsSaving(true);
    try {
      const saved = await api.saveStation({
        id: station?.id,
        name: name.trim(),
        slug: finalSlug,
        apiKey: replacingKeys ? apiKey.trim() : '',
        applicationKey: replacingKeys ? applicationKey.trim() : '',
        macAddress: macAddress.trim(),
        latitude: lat,
        longitude: lon,
        forecastProvider,
        isPublic,
      });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // What saving would change, for the preview of a station that already exists.
  const changes: { icon: React.ElementType; text: string }[] = [];
  if (station) {
    const forecastTitle = (p: ForecastProvider) => FORECAST_SOURCES.find(s => s.value === p)?.title ?? p;
    if (name.trim() !== station.name) changes.push({ icon: Link2, text: `Renamed to ${name.trim() || '…'}` });
    if (finalSlug !== station.slug) changes.push({ icon: Link2, text: `New link /${finalSlug || '…'}` });
    if (hasLocation && (lat !== station.latitude || lon !== station.longitude)) {
      changes.push({ icon: MapPin, text: `Moved to ${chosenPlace || `${lat.toFixed(3)}, ${lon.toFixed(3)}`}` });
    }
    if (forecastProvider !== station.forecastProvider) changes.push({ icon: CloudSun, text: `${forecastTitle(forecastProvider)} forecast` });
    if (isPublic !== station.isPublic) changes.push({ icon: isPublic ? Globe : Lock, text: isPublic ? 'Made public' : 'Made unlisted' });
    if (replacingKeys && station.appKeyHint) changes.push({ icon: KeyRound, text: 'New Ambient keys' });
    if (normalizeMac(macAddress) !== normalizeMac(station.macAddress)) {
      changes.push({ icon: Plug, text: macAddress.trim() ? `Device ${macAddress.trim()}` : 'Any device on the account' });
    }
  }

  // Anything that leaving now would lose. A new station counts anything typed or changed from the defaults.
  const dirty = station
    ? changes.length > 0
    : [name, slug, latitude, longitude, apiKey, applicationKey, macAddress, placeQuery].some(v => v.trim() !== '')
      || forecastProvider !== 'auto' || !isPublic;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Gone, so nothing is left unsaved here.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const canSave = !isSaving && slugStatus !== 'checking' && slugStatus !== 'taken';
  const saveLabel = isSaving ? 'Checking with Ambient…' : station ? 'Save changes' : 'Add station';
  const host = `${window.location.host}${import.meta.env.BASE_URL}`;

  const saveButton = (
    <button
      type="submit"
      form="station-form"
      disabled={!canSave}
      className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-strong hover:bg-accent text-sm font-bold text-accent-ink shadow-lg shadow-accent-soft disabled:opacity-60 transition"
    >
      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {saveLabel}
    </button>
  );

  return (
    <form id="station-form" onSubmit={handleSubmit} autoComplete="off" className="flex flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-line bg-card/90 backdrop-blur rounded-t-[var(--tile-radius)]">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back to my stations"
          title="Back to my stations"
          className="grid place-items-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink hover:bg-fill transition shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">My stations</p>
          <h2 id="account-modal-title" className="text-lg font-bold text-ink truncate">
            {station ? `Edit ${station.name}` : 'Add a station'}
          </h2>
        </div>
        <div className="hidden sm:block">{saveButton}</div>
      </header>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5 min-w-0">
          {error && (
            <div role="alert" className="flex items-start gap-2 bg-danger-soft border border-danger-line rounded-xl px-4 py-3 text-sm text-danger-text">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <Section icon={Link2} title="Name and link">
            <div className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="st-name">Station name</label>
                <input
                  id="st-name"
                  name="station-name"
                  {...noAutofill}
                  className={`${inputClass} text-base font-semibold`}
                  value={name}
                  maxLength={60}
                  required
                  placeholder="Back yard"
                  onChange={e => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(toSlug(e.target.value));
                  }}
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="st-slug">Dashboard link</label>
                <div className="flex items-stretch rounded-xl border border-line bg-well-deep overflow-hidden focus-within:border-accent transition">
                  <span className="px-3.5 py-2.5 text-sm text-ink-4 border-r border-line whitespace-nowrap hidden sm:block">{host}</span>
                  <input
                    id="st-slug"
                    name="station-page-address"
                    {...noAutofill}
                    className="flex-1 bg-transparent px-3.5 py-2.5 text-sm font-mono text-info-text outline-none min-w-0"
                    value={slug}
                    required
                    placeholder="back-yard"
                    onChange={e => { setSlugTouched(true); setSlug(toSlug(e.target.value)); }}
                  />
                </div>
                {slugStatus === 'checking' && (
                  <p className="text-xs text-ink-3 mt-1.5 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Checking availability…
                  </p>
                )}
                {slugStatus === 'available' && (
                  <p className="text-xs text-good-text mt-1.5 flex items-center gap-1">
                    <Check className="w-3 h-3" /> That link is available
                  </p>
                )}
                {slugStatus === 'taken' && (
                  <p className="text-xs text-danger-text mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> That link is already taken
                  </p>
                )}
                {slugStatus === 'idle' && <p className={hintClass}>Lowercase letters, numbers and dashes.</p>}
              </div>
            </div>
          </Section>

          <Section icon={MapPin} title="Location" description="Only the nearest town is needed, and it is never shown publicly.">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-ink-4 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  aria-label="Search for a town or postcode"
                  name="station-place"
                  {...noAutofill}
                  className={`${inputClass} pl-10`}
                  placeholder="Town, city or ZIP code"
                  value={placeQuery}
                  onChange={e => setPlaceQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void searchPlaces(); } }}
                />
              </div>
              <button
                type="button"
                onClick={() => void searchPlaces()}
                disabled={isSearching || placeQuery.trim().length < 2}
                className="px-4 py-2.5 rounded-xl bg-fill border border-line text-sm font-semibold text-ink hover:bg-fill-strong disabled:opacity-50 shrink-0 transition"
              >
                {isSearching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {places !== null && (
              places.length === 0 ? (
                <p className="text-sm text-ink-3 mt-3">No matches. Try a nearby larger town, or enter coordinates.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {places.map(place => (
                    <li key={`${place.latitude},${place.longitude}`}>
                      <button
                        type="button"
                        onClick={() => { setLocationWarning(''); choosePlace(place); }}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl bg-well-deep border border-line hover:border-accent-line text-sm text-ink-2 flex items-center gap-2 transition"
                      >
                        <MapPin className="w-4 h-4 text-danger-text shrink-0" />
                        {placeLabel(place)}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {hasLocation && (
              <p className="mt-3 text-sm text-good-text flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Check className="w-4 h-4 shrink-0" />
                <span className="font-semibold">{chosenPlace || 'Location set'}</span>
                <span className="text-ink-4 font-mono text-xs">{lat.toFixed(3)}, {lon.toFixed(3)}</span>
              </p>
            )}

            {locationWarning && (
              <p className="mt-2 flex items-start gap-2 text-sm text-warn-text">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {locationWarning}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={isLocating}
                className="text-sm font-semibold text-accent-text hover:underline flex items-center gap-1.5"
              >
                <LocateFixed className="w-4 h-4" /> {isLocating ? 'Locating…' : 'Use my current location'}
              </button>
              <button type="button" onClick={() => setShowCoordinates(v => !v)} className="text-sm text-ink-3 hover:text-ink">
                {showCoordinates ? 'Hide coordinates' : 'Enter coordinates'}
              </button>
            </div>

            {showCoordinates && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <input aria-label="Latitude" name="station-latitude" {...noAutofill} placeholder="Latitude" inputMode="decimal" className={inputClass} value={latitude} onChange={e => { setLatitude(e.target.value); setChosenPlace(''); }} />
                <input aria-label="Longitude" name="station-longitude" {...noAutofill} placeholder="Longitude" inputMode="decimal" className={inputClass} value={longitude} onChange={e => { setLongitude(e.target.value); setChosenPlace(''); }} />
              </div>
            )}
          </Section>

          <Section icon={CloudSun} title="Forecast" description="Your sensors always give the current conditions. This picks who forecasts the days ahead.">
            <div className="grid gap-2 sm:grid-cols-3">
              {FORECAST_SOURCES.map(source => (
                <Choice key={source.value} selected={forecastProvider === source.value} onClick={() => setForecastProvider(source.value)}>
                  <span className="block text-sm font-semibold text-ink">{source.title}</span>
                  <span className="block text-xs text-ink-3 mt-0.5 leading-snug">{source.detail}</span>
                </Choice>
              ))}
            </div>
          </Section>

          <Section icon={Eye} title="Who can see it">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice selected={isPublic} onClick={() => setIsPublic(true)}>
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Globe className="w-4 h-4 text-info-text" /> Public</span>
                <span className="block text-xs text-ink-3 mt-0.5">Listed on the home page for anyone to browse</span>
              </Choice>
              <Choice selected={!isPublic} onClick={() => setIsPublic(false)}>
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Lock className="w-4 h-4 text-ink-3" /> Unlisted</span>
                <span className="block text-xs text-ink-3 mt-0.5">Only people with the link can see it</span>
              </Choice>
            </div>
          </Section>

          <Section icon={Plug} title="Ambient Weather connection">
            {station && (
              <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                station.lastPollError ? 'bg-danger-soft border-danger-line' : 'bg-good-soft border-good-line'
              }`}>
                <StatusDot ok={!station.lastPollError} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${station.lastPollError ? 'text-danger-text' : 'text-good-text'}`}>
                    {station.lastPollError ? 'Last update failed' : 'Connected'}
                  </p>
                  <p className="text-xs text-ink-3 truncate">
                    {station.lastPollError ?? `Checked ${timeAgo(station.lastPollAt)} · API key ${station.apiKeyHint}${station.appKeyHint ? ` · app key ${station.appKeyHint}` : ''}`}
                  </p>
                </div>
                {station.appKeyHint && (
                  <button
                    type="button"
                    onClick={() => { setReplacingKeys(v => !v); setApiKey(''); setApplicationKey(''); }}
                    className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-card border border-line text-ink-2 hover:text-ink hover:border-line-strong transition"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> {replacingKeys ? 'Keep keys' : 'Replace keys'}
                  </button>
                )}
              </div>
            )}

            {replacingKeys && (
              <div className={station ? 'mt-4' : ''}>
                <div className="rounded-xl border border-line bg-well-deep px-4 py-3 text-sm text-ink-2 mb-4">
                  <p className="font-semibold text-ink mb-2">Two keys from your Ambient account</p>
                  <ol className="list-decimal pl-5 space-y-1.5 marker:text-ink-4">
                    <li>
                      Open your{' '}
                      <a href="https://ambientweather.net/account/keys" target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
                        Ambient Weather API keys page ↗
                      </a>{' '}
                      and sign in if it asks.
                    </li>
                    <li><span className="text-ink">API key:</span> click <span className="text-ink">Create API Key</span> and copy it.</li>
                    <li>
                      <span className="text-ink">Application key:</span> below the API keys, click the
                      {' '}<span className="text-ink">"Developers: An Application Key is also required…"</span> link to create one, and copy it.
                    </li>
                  </ol>
                  <p className="mt-2 text-xs text-ink-3">Already have keys? Copy those instead. Both are stored on the server and never shown again.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass} htmlFor="st-key">API key</label>
                    <input
                      id="st-key"
                      type="password"
                      name="ambient-api-key"
                      {...noAutofill}
                      autoComplete="new-password"
                      className={`${inputClass} font-mono`}
                      value={apiKey}
                      required={replacingKeys}
                      onChange={e => setApiKey(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="st-app-key">Application key</label>
                    <input
                      id="st-app-key"
                      type="password"
                      name="ambient-application-key"
                      {...noAutofill}
                      autoComplete="new-password"
                      className={`${inputClass} font-mono`}
                      value={applicationKey}
                      required={replacingKeys}
                      onChange={e => setApplicationKey(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                aria-expanded={showAdvanced}
                className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                More than one device on your Ambient account?
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <label className={labelClass} htmlFor="st-mac">MAC address</label>
                  <input id="st-mac" name="station-mac" {...noAutofill} className={`${inputClass} font-mono`} value={macAddress} onChange={e => setMacAddress(e.target.value)} placeholder="00:0E:C6:12:34:56" />
                  <p className={hintClass}>Picks which device this station shows.</p>
                  {station && normalizeMac(station.macAddress) !== '' && normalizeMac(macAddress) !== '' && normalizeMac(macAddress) !== normalizeMac(station.macAddress) && (
                    <p className="text-xs text-warn-text mt-1.5 flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      Pointing this station at a different device clears its recorded history and starts over from the new one.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>

          {station && onDelete && (
            <section className="rounded-2xl border border-danger-line p-5 flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-ink">Delete this station</h3>
                <p className="text-xs text-ink-3 mt-0.5">Its page stops working and every reading recorded for it is deleted.</p>
              </div>
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-danger-soft border border-danger-line text-danger-text hover:brightness-110 transition"
              >
                <Trash2 className="w-4 h-4" /> Delete station
              </button>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 self-start">
          <div className="rounded-2xl overflow-hidden border border-line bg-well">
            {hasLocation ? (
              <RadarMap lat={lat} lon={lon} zoom={10} host={null} frames={[]} index={0} failed={false} timezone={null} className="h-40 lg:h-48" />
            ) : (
              <div className="h-40 lg:h-48 grid place-items-center bg-well-deep text-ink-4" style={{ backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
                <span className="flex flex-col items-center gap-1.5 text-xs font-semibold">
                  <MapPin className="w-6 h-6" /> No location yet
                </span>
              </div>
            )}
            <div className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">Preview</p>
              <h3 className={`mt-1 text-xl font-extrabold tracking-tight truncate ${name.trim() ? 'text-ink' : 'text-ink-4'}`}>
                {name.trim() || 'Your station'}
              </h3>
              <p className="text-xs font-mono text-info-text truncate">{host}{finalSlug || '…'}</p>
              {station ? (
                <Changes items={changes} />
              ) : (
              <ul className="mt-4 space-y-2.5">
                <PreviewItem done={name.trim() !== '' && slugIsValid && slugStatus !== 'taken'} icon={Link2}>
                  {slugStatus === 'taken' ? 'Link already taken' : slugIsValid ? 'Name and link' : 'Needs a name and link'}
                </PreviewItem>
                <PreviewItem done={hasLocation} icon={MapPin}>{hasLocation ? chosenPlace || 'Location set' : 'Needs a location'}</PreviewItem>
                <PreviewItem done icon={CloudSun}>{FORECAST_SOURCES.find(s => s.value === forecastProvider)?.title} forecast</PreviewItem>
                <PreviewItem done icon={isPublic ? Globe : Lock}>{isPublic ? 'Public' : 'Unlisted'}</PreviewItem>
                <PreviewItem done={hasKeys} icon={Plug}>
                  {hasKeys ? 'Ambient keys' : 'Needs both Ambient keys'}
                </PreviewItem>
              </ul>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* On a phone the header's Save scrolls away with a long form, so it is repeated here. */}
      <div className="sm:hidden sticky bottom-0 flex justify-end gap-2 px-5 py-3 border-t border-line bg-card/95 backdrop-blur">
        {saveButton}
      </div>
    </form>
  );
};

const Section: React.FC<{ icon: React.ElementType; title: string; description?: string; children: React.ReactNode }> = ({
  icon: Icon, title, description, children,
}) => (
  <section className="rounded-2xl border border-line bg-fill-soft p-5">
    <div className="flex items-start gap-3 mb-4">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-accent-soft text-accent-text shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 pt-1">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {description && <p className="text-xs text-ink-3 mt-0.5">{description}</p>}
      </div>
    </div>
    {children}
  </section>
);

const Choice: React.FC<{ selected: boolean; onClick: () => void; children: React.ReactNode }> = ({ selected, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={`relative text-left rounded-xl border-2 px-3.5 py-3 transition ${
      selected ? 'border-accent bg-accent-soft' : 'border-line bg-well-deep hover:border-line-strong'
    }`}
  >
    {selected && (
      <span className="absolute top-2.5 right-2.5 grid place-items-center w-5 h-5 rounded-full bg-accent-strong text-accent-ink">
        <Check className="w-3 h-3" />
      </span>
    )}
    <span className="block pr-6">{children}</span>
  </button>
);

/** The edits not yet saved, or a quiet line when there are none. */
const Changes: React.FC<{ items: { icon: React.ElementType; text: string }[] }> = ({ items }) => (
  items.length === 0 ? (
    <p className="mt-4 text-sm text-ink-4">No unsaved changes</p>
  ) : (
    <div className="mt-4">
      <p className="text-xs font-semibold text-accent-text">
        {items.length} unsaved {items.length === 1 ? 'change' : 'changes'}
      </p>
      <ul className="mt-2 space-y-2">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5 text-sm text-ink-2">
            <span className="grid place-items-center w-6 h-6 rounded-full shrink-0 bg-accent-soft text-accent-text">
              <Icon className="w-3.5 h-3.5" />
            </span>
            <span className="min-w-0 truncate">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
);

const PreviewItem: React.FC<{ done: boolean; icon: React.ElementType; children: React.ReactNode }> = ({ done, icon: Icon, children }) => (
  <li className={`flex items-center gap-2.5 text-sm ${done ? 'text-ink-2' : 'text-warn-text'}`}>
    <span className={`grid place-items-center w-6 h-6 rounded-full shrink-0 ${done ? 'bg-good-soft text-good-text' : 'bg-warn-soft text-warn-text'}`}>
      {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
    </span>
    <span className="min-w-0 truncate">{children}</span>
  </li>
);

export const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) => (
  <span className="relative flex w-2.5 h-2.5 shrink-0" aria-hidden="true">
    {ok && <span className="absolute inset-0 rounded-full bg-good opacity-60 animate-ping motion-reduce:animate-none" />}
    <span className={`relative w-2.5 h-2.5 rounded-full ${ok ? 'bg-good' : 'bg-danger'}`} />
  </span>
);
