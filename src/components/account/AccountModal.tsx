import React, { useCallback, useEffect, useState } from 'react';
import { X, User as UserIcon, Plus, Pencil, AlertCircle, Globe, Lock, Loader2, ArrowUpRight, CloudSun, LogOut, History } from 'lucide-react';
import { StationForm, StatusDot } from './StationForm';
import { Modal } from '../ui/Modal';
import { RadarMap } from '../tiles/RadarMap';
import { api } from '../../services/api';
import { startGoogleSignIn } from '../../services/googleAuth';
import { timeAgo } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import type { OwnedStation, User } from '../../types/weather';

interface AccountModalProps {
  onClose: () => void;
  user: User | null;
  googleClientId: string;
  authError: string;
  /** Open straight on this station's editor (by slug), for its Edit button on the dashboard. */
  editSlug?: string;
  onSignOut: () => void;
  /** The account is gone; the app should forget the signed-in user. */
  onAccountDeleted: () => void;
  onStationsChanged: () => void;
  onNavigate: (slug: string) => void;
}

type View =
  | { mode: 'list' }
  | { mode: 'add' }
  | { mode: 'edit'; station: OwnedStation }
  | { mode: 'confirm-delete-station'; station: OwnedStation }
  | { mode: 'confirm-delete-account' };

/** How much history the backfill aims to pull from Ambient. */
const BACKFILL_SPAN_MS = 365 * 86_400_000;

export const AccountModal: React.FC<AccountModalProps> = ({
  onClose,
  user,
  googleClientId,
  authError,
  editSlug,
  onSignOut,
  onAccountDeleted,
  onStationsChanged,
  onNavigate,
}) => {
  const [stations, setStations] = useState<OwnedStation[] | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  // Opened from a station's Edit button: close again on the way out rather than land on the list.
  const [cameToEdit, setCameToEdit] = useState(false);
  // The editor holds changes that leaving would lose, and whether the viewer is being asked about them.
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<'close' | 'back' | null>(null);
  // The station still to be opened in the editor, once the list has arrived.
  const [pendingEdit, setPendingEdit] = useState(editSlug ?? null);

  const loadStations = useCallback(() => {
    api.myStations()
      .then(setStations)
      .catch(e => { setStations([]); setError(e.message); });
  }, []);

  useEffect(() => {
    if (user) loadStations();
  }, [user, loadStations]);

  if (pendingEdit && stations) {
    setPendingEdit(null);
    const station = stations.find(s => s.slug === pendingEdit);
    if (station) {
      setCameToEdit(true);
      setView({ mode: 'edit', station });
    }
  }

  const leave = (how: 'close' | 'back') => {
    setConfirmLeave(null);
    if (how === 'close' || cameToEdit) onClose();
    else setView({ mode: 'list' });
  };

  /**
   * Every way out of the dialog comes through here: its buttons, Escape, a
   * click outside and the Back button. False keeps it open, with a question,
   * when the editor has changes that leaving would lose.
   */
  const requestLeave = (how: 'close' | 'back'): boolean => {
    if (confirmLeave) {
      // Asked already: Escape or Back again answers "keep editing".
      setConfirmLeave(null);
      return false;
    }
    if (dirty && editing) {
      setConfirmLeave(how);
      return false;
    }
    leave(how);
    return true;
  };

  const backToList = () => { requestLeave('back'); };

  const handleSignIn = () => {
    setError('');
    startGoogleSignIn(googleClientId).catch(e => setError(e.message));
  };

  const handleSaved = (saved: OwnedStation, isNew: boolean) => {
    onStationsChanged();
    setDirty(false);
    if (isNew || cameToEdit) {
      // A new station's page is the thing its owner wants to see next; an edit
      // begun from the dashboard goes back to it, under its new link if that changed.
      onNavigate(saved.slug);
      return;
    }
    setView({ mode: 'list' });
    loadStations();
  };

  const deleteStation = async (station: OwnedStation) => {
    setIsDeleting(true);
    setError('');
    try {
      await api.deleteStation(station.id);
      setCameToEdit(false);
      setView({ mode: 'list' });
      loadStations();
      onStationsChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteAccount = async () => {
    setIsDeleting(true);
    setError('');
    try {
      await api.deleteAccount();
      onStationsChanged();
      onAccountDeleted();
      setView({ mode: 'list' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const shownError = error || authError;
  const editing = !!user && (view.mode === 'add' || view.mode === 'edit');
  // While the editor's list is loading on the way to a station, show nothing rather than the list flashing by.
  const waitingForEdit = pendingEdit !== null && user !== null;

  return (
    <Modal
      onClose={() => requestLeave('close')}
      labelledBy="account-modal-title"
      className={`tile w-full h-auto! ${editing ? 'max-w-5xl' : user ? 'max-w-3xl' : 'max-w-md'}`}
    >
      {editing ? (
        view.mode === 'add' ? (
          <StationForm onSaved={saved => handleSaved(saved, true)} onCancel={backToList} onDirtyChange={setDirty} />
        ) : (
          <StationForm
            station={view.station}
            onSaved={saved => handleSaved(saved, false)}
            onCancel={backToList}
            onDelete={() => setView({ mode: 'confirm-delete-station', station: view.station })}
            onDirtyChange={setDirty}
          />
        )
      ) : !user ? (
        <SignIn googleClientId={googleClientId} error={shownError} onSignIn={handleSignIn} onClose={onClose} />
      ) : (
        <>
          <div className="flex items-center gap-4 px-5 sm:px-6 py-5 border-b border-line">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full ring-2 ring-accent-line" />
            ) : (
              <div className="grid place-items-center w-12 h-12 rounded-full bg-accent-soft text-accent-text">
                <UserIcon className="w-6 h-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 id="account-modal-title" className="text-lg font-bold text-ink truncate">{user.name || user.email}</h2>
              <p className="text-sm text-ink-3 truncate">{user.email}</p>
            </div>
            <button
              onClick={onSignOut}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold text-ink-3 border border-line hover:text-ink hover:border-line-strong transition"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
            <button onClick={onClose} aria-label="Close" className="grid place-items-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink hover:bg-fill transition shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-5 sm:px-6 py-5">
            {shownError && (
              <div role="alert" className="flex items-start gap-2 bg-danger-soft border border-danger-line rounded-xl px-4 py-3 mb-4 text-sm text-danger-text">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {shownError}
              </div>
            )}

            {view.mode === 'confirm-delete-station' ? (
              <ConfirmPanel
                title={`Delete “${view.station.name}”?`}
                confirmLabel="Delete station"
                busy={isDeleting}
                onConfirm={() => deleteStation(view.station)}
                onCancel={() => setView({ mode: 'edit', station: view.station })}
              >
                Its page at <span className="font-mono">/{view.station.slug}</span> stops working and every reading
                and daily summary recorded for it is deleted. This cannot be undone.
              </ConfirmPanel>
            ) : view.mode === 'confirm-delete-account' ? (
              <ConfirmPanel
                title="Delete your account?"
                confirmLabel="Delete account"
                busy={isDeleting}
                onConfirm={deleteAccount}
                onCancel={() => setView({ mode: 'list' })}
              >
                This deletes your WeatherDash account
                {stations && stations.length === 1 && ' and your station, with every reading recorded for it'}
                {stations && stations.length > 1 && ` and all ${stations.length} of your stations, with every reading recorded for them`}
                . Your Ambient Weather account and its keys are not affected. This cannot be undone.
              </ConfirmPanel>
            ) : stations === null || waitingForEdit ? (
              <p className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3"><Loader2 className="w-4 h-4 animate-spin" /> Loading your stations</p>
            ) : stations.length === 0 ? (
              <div className="flex flex-col items-center text-center py-10 px-4">
                <div className="grid place-items-center w-16 h-16 rounded-2xl bg-accent-soft text-accent-text mb-4">
                  <CloudSun className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-ink">Connect your first station</h3>
                <p className="text-sm text-ink-3 mt-1 max-w-sm">Bring your Ambient Weather station's readings to a dashboard of your own.</p>
                <button
                  onClick={() => setView({ mode: 'add' })}
                  className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-strong hover:bg-accent text-sm font-bold text-accent-ink shadow-lg shadow-accent-soft transition"
                >
                  <Plus className="w-4 h-4" /> Add a station
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-ink-3">
                    My stations <span className="ml-1 normal-case tracking-normal text-ink-4">{stations.length}</span>
                  </h3>
                </div>
                <div className="grid gap-3">
                  {stations.map(st => (
                    <StationCard
                      key={st.id}
                      station={st}
                      onOpen={() => onNavigate(st.slug)}
                      onEdit={() => setView({ mode: 'edit', station: st })}
                    />
                  ))}
                  <button
                    onClick={() => setView({ mode: 'add' })}
                    className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-5 text-sm font-semibold text-ink-3 hover:text-accent-text hover:border-accent-line hover:bg-accent-soft transition"
                  >
                    <Plus className="w-4 h-4" /> Add a station
                  </button>
                </div>
              </>
            )}
          </div>

          {view.mode === 'list' && stations !== null && (
            <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-3 border-t border-line">
              <button onClick={onSignOut} className="sm:hidden inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
              <button
                onClick={() => setView({ mode: 'confirm-delete-account' })}
                className="ml-auto text-xs text-ink-4 hover:text-danger-text hover:underline"
              >
                Delete my account
              </button>
            </div>
          )}
        </>
      )}

      {confirmLeave && (
        <div className="fixed inset-0 z-10 grid place-items-center p-4 bg-scrim animate-fade-in">
          <div role="alertdialog" aria-labelledby="leave-title" aria-describedby="leave-text" className="tile h-auto! w-full max-w-sm p-6">
            <h3 id="leave-title" className="text-lg font-bold text-ink">Discard your changes?</h3>
            <p id="leave-text" className="text-sm text-ink-3 mt-1">
              {view.mode === 'add' ? 'This station hasn’t been added yet.' : 'Your changes to this station haven’t been saved.'}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmLeave(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-accent-strong text-accent-ink hover:bg-accent transition"
              >
                Keep editing
              </button>
              <button
                onClick={() => leave(confirmLeave)}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-danger-soft border border-danger-line text-danger-text hover:brightness-110 transition"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

/** One of the user's stations: where it is, whether it is reporting, and the ways into it. */
const StationCard: React.FC<{ station: OwnedStation; onOpen: () => void; onEdit: () => void }> = ({ station: st, onOpen, onEdit }) => {
  const now = useNow(60_000).getTime();
  const backfillShare = st.backfilledTo
    ? Math.min(1, Math.max(0, (now - Date.parse(st.backfilledTo)) / BACKFILL_SPAN_MS))
    : 0;
  return (
    <article className="flex flex-col sm:flex-row rounded-2xl border border-line bg-well overflow-hidden">
      <button onClick={onOpen} aria-label={`Open ${st.name}`} className="relative sm:w-48 shrink-0 group">
        <RadarMap lat={st.latitude} lon={st.longitude} zoom={9} host={null} frames={[]} index={0} failed={false} timezone={st.timezone} className="h-28 sm:h-full sm:min-h-36" />
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
      </button>
      <div className="min-w-0 flex-1 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-bold text-ink truncate">{st.name}</h4>
            <p className="text-xs font-mono text-info-text truncate">/{st.slug}</p>
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
            st.isPublic ? 'bg-info-soft text-info-text border-info-line' : 'bg-fill text-ink-3 border-line'
          }`}>
            {st.isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {st.isPublic ? 'Public' : 'Unlisted'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <StatusDot ok={!st.lastPollError} />
          <span className={`truncate ${st.lastPollError ? 'text-danger-text' : 'text-ink-3'}`}>
            {st.lastPollError ? `Last update failed: ${st.lastPollError}` : `Reporting · checked ${timeAgo(st.lastPollAt)}`}
          </span>
        </div>

        {!st.backfillComplete && (
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
              <span className="inline-flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Importing a year of history</span>
              <span className="tabular-nums font-semibold">{Math.round(backfillShare * 100)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-fill overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(3, backfillShare * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-auto">
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-accent-strong text-accent-ink hover:bg-accent transition"
          >
            Open dashboard <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-ink-2 border border-line hover:text-ink hover:border-line-strong transition"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
      </div>
    </article>
  );
};

const SignIn: React.FC<{ googleClientId: string; error: string; onSignIn: () => void; onClose: () => void }> = ({
  googleClientId, error, onSignIn, onClose,
}) => (
  <div className="relative px-6 pt-10 pb-8 text-center">
    <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 grid place-items-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink hover:bg-fill transition">
      <X className="w-5 h-5" />
    </button>
    <div className="mx-auto grid place-items-center w-16 h-16 rounded-2xl bg-accent-soft border border-accent-line text-accent-text mb-5">
      <CloudSun className="w-8 h-8" />
    </div>
    <h2 id="account-modal-title" className="text-xl font-bold text-ink">Your weather, your dashboard</h2>
    <p className="text-sm text-ink-3 mt-2 mb-6">
      Sign in to connect your Ambient Weather station, save your own layouts and keep your theme on every device.
    </p>
    {error && (
      <div role="alert" className="flex items-start gap-2 text-left bg-danger-soft border border-danger-line rounded-xl px-4 py-3 mb-5 text-sm text-danger-text">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
      </div>
    )}
    {googleClientId ? (
      // The one control that does not follow the theme: Google asks that
      // its sign-in button keep its own colours wherever it appears.
      <button
        onClick={onSignIn}
        className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-[#FFFFFF] text-[#1F1F1F] border border-line font-bold text-sm shadow-lg hover:scale-[1.02] transition"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.27v3.15C3.25 21.3 7.31 24 12 24z" />
          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.27C.46 8.2 0 10.04 0 12s.46 3.8 1.27 5.42l4.01-3.15z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.58l4.01 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
        </svg>
        Continue with Google
      </button>
    ) : (
      <p className="text-xs text-warn-text">Google sign-in isn't configured on this server yet.</p>
    )}
  </div>
);

interface ConfirmPanelProps {
  title: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

/** An in-place "are you sure", styled like the rest of the app rather than the browser's own dialog. */
const ConfirmPanel: React.FC<ConfirmPanelProps> = ({ title, confirmLabel, busy, onConfirm, onCancel, children }) => (
  <div className="space-y-4">
    <div className="flex items-start gap-3 bg-danger-soft border border-danger-line rounded-xl p-4">
      <AlertCircle className="w-5 h-5 text-danger-text shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold text-ink">{title}</h3>
        <p className="text-sm text-ink-2 mt-1">{children}</p>
      </div>
    </div>
    <div className="flex items-center justify-end gap-2">
      <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg text-sm text-ink-2 hover:text-ink hover:bg-fill-soft transition">
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy}
        className="px-4 py-2 rounded-lg text-sm font-bold bg-danger-soft border border-danger-line text-danger-text hover:brightness-110 transition flex items-center gap-2 disabled:opacity-60"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  </div>
);
