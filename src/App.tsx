import { useCallback, useEffect, useState } from 'react';
import { Header } from './components/dashboard/Header';
import { HomePage } from './components/home/HomePage';
import { StationPage } from './components/dashboard/StationPage';
import { AccountModal } from './components/account/AccountModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { api, setUnauthorizedHandler } from './services/api';
import { takeGoogleRedirect } from './services/googleAuth';
import { stationPath } from './lib/format';
import { useFullscreen } from './lib/useFullscreen';
import { useVisiblePolling } from './lib/useVisiblePolling';
import { UnitsProvider } from './lib/UnitsProvider';
import { isThemeId, useTheme } from './lib/theme';
import type { PublicStation, User } from './types/weather';

function slugFromPath(): string | null {
  const base = import.meta.env.BASE_URL;
  const path = window.location.pathname;
  const rest = path.startsWith(base) ? path.slice(base.length) : '';
  return rest.split('/')[0].toLowerCase() || null;
}

/** The station last shown in this browser, for the installed app to reopen. */
const LAST_STATION_KEY = 'weatherdash_last_station';

/**
 * The station to open with. An installed app always launches at the home page
 * (the address it was installed from), so there, and only on launch, the
 * station last viewed is reopened instead. A browser tab on the home page
 * still shows the home page.
 */
function initialSlug(): string | null {
  const fromPath = slugFromPath();
  if (fromPath) return fromPath;
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!installed) return null;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_STATION_KEY); } catch { /* storage unavailable */ }
  if (!last) return null;
  window.history.replaceState(null, '', stationPath(last));
  return last;
}

// Read once at startup, before the first render, so the token leaves the URL immediately.
const googleRedirect = takeGoogleRedirect();

/** The station list in the header and on the home page carries each station's temperature. */
const PUBLIC_STATIONS_REFRESH_MS = 5 * 60_000;

/**
 * How often a signed-in browser checks back with the account, so a theme shared
 * across devices reaches a screen nobody touches (a wall display) without a reload.
 */
const SESSION_REFRESH_MS = 10 * 60_000;

export function App() {
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [user, setUser] = useState<User | null>(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [publicStations, setPublicStations] = useState<PublicStation[]>([]);
  // Open, and when it is, the station (by slug) to go straight to editing.
  const [account, setAccount] = useState<{ edit?: string } | null>(googleRedirect !== null ? {} : null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [authError, setAuthError] = useState(googleRedirect && 'error' in googleRedirect ? googleRedirect.error : '');
  const fullscreen = useFullscreen();
  // Where the station page puts its controls inside the header.
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);

  const loadSession = useCallback(() => {
    api.me()
      .then(r => { setUser(r.user); setGoogleClientId(r.googleClientId); })
      .catch(() => setUser(null));
  }, []);

  // A theme the user shares across their devices wins over this browser's own.
  const { setTheme } = useTheme();
  const accountTheme = user?.theme ?? null;
  useEffect(() => {
    if (isThemeId(accountTheme)) setTheme(accountTheme);
  }, [accountTheme, setTheme]);

  const signedIn = user !== null;
  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => { if (document.visibilityState === 'visible') api.me().then(r => setUser(r.user)).catch(() => {}); };
    const timer = window.setInterval(refresh, SESSION_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signedIn]);

  const loadPublicStations = useCallback(() => {
    // A failed refresh keeps the list already shown rather than emptying it.
    api.publicStations().then(setPublicStations).catch(() => {});
  }, []);

  // Any request the server rejects for want of a session means it has expired
  // (or was signed out elsewhere), so stop presenting the viewer as signed in.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(() => {});
  }, []);

  useVisiblePolling(loadPublicStations, PUBLIC_STATIONS_REFRESH_MS);

  useEffect(() => {
    if (googleRedirect && 'idToken' in googleRedirect) {
      api.signInWithGoogle(googleRedirect.idToken)
        .then(setUser)
        .catch(e => setAuthError(e.message))
        .finally(loadSession);
    } else {
      loadSession();
    }
  }, [loadSession]);

  useEffect(() => {
    if (!slug) return;
    try { localStorage.setItem(LAST_STATION_KEY, slug); } catch { /* storage unavailable */ }
  }, [slug]);

  useEffect(() => {
    const onPopState = () => setSlug(slugFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (next: string | null) => {
    // Picking the page already on screen should not add a Back step that goes nowhere.
    if (next !== slug) {
      window.history.pushState(null, '', stationPath(next));
      setSlug(next);
    }
    window.scrollTo(0, 0);
  };

  const handleSignOut = async () => {
    await api.signOut().catch(() => {});
    setUser(null);
  };

  return (
    <UnitsProvider>
    <div className="min-h-screen text-ink flex flex-col font-sans selection:bg-accent selection:text-accent-ink">
      {!fullscreen.active && <Header
        currentSlug={slug}
        publicStations={publicStations}
        user={user}
        onNavigate={navigate}
        onOpenAccount={() => setAccount({})}
        onOpenSettings={() => setIsSettingsOpen(true)}
        toolbarRef={setToolbar}
      />}

      <main className={fullscreen.active ? 'flex-1 pt-4' : 'flex-1'}>
        {slug ? (
          <StationPage key={slug} slug={slug} onNavigate={navigate} fullscreen={fullscreen} toolbar={toolbar} viewerId={user?.id ?? null} onEditStation={() => setAccount({ edit: slug })} />
        ) : (
          <HomePage
            stations={publicStations}
            onNavigate={navigate}
            onOpenAccount={() => setAccount({})}
          />
        )}
      </main>

      {!fullscreen.active && (
        <footer className="w-full border-t border-line-soft py-6 px-4 text-center text-xs text-ink-4">
          Station data from Ambient Weather · Forecasts from Open-Meteo and the US National Weather Service
        </footer>
      )}

      {isSettingsOpen && <SettingsModal
        user={user}
        onAccountTheme={theme => setUser(u => (u ? { ...u, theme } : u))}
        onClose={() => setIsSettingsOpen(false)}
      />}

      {account && <AccountModal
        onClose={() => { setAccount(null); setAuthError(''); }}
        editSlug={account.edit}
        user={user}
        googleClientId={googleClientId}
        authError={authError}
        onSignOut={handleSignOut}
        onAccountDeleted={() => setUser(null)}
        onStationsChanged={loadPublicStations}
        onNavigate={slug => { setAccount(null); navigate(slug); }}
      />}
    </div>
    </UnitsProvider>
  );
}

export default App;
