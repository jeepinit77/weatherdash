import React, { useState } from 'react';
import { Check, Download, Palette, Ruler, Settings, Share, SquarePlus, Timer, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { THEMES, useTheme } from '../../lib/theme';
import type { ThemeId } from '../../lib/theme';
import { useUnitSystem } from '../../lib/units';
import { POPUP_TIMEOUT_OPTIONS, setPopupTimeout, usePopupTimeout } from '../../lib/popupTimeout';
import { promptInstall, useInstallState } from '../../lib/installPrompt';
import { api } from '../../services/api';
import type { User } from '../../types/weather';

interface SettingsModalProps {
  user: User | null;
  /** The account's shared theme changed on the server (null: no longer shared). */
  onAccountTheme: (theme: string | null) => void;
  onClose: () => void;
}

/**
 * Everything about how this screen shows the dashboard: theme, units, how long
 * popups stay up, and installing it as an app. All of it is kept in this
 * browser, except a theme the signed-in user chooses to share across devices.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({ user, onAccountTheme, onClose }) => {
  const { theme, setTheme } = useTheme();
  const { units, setSystem } = useUnitSystem();
  const popupSeconds = usePopupTimeout();
  const install = useInstallState();
  const [syncError, setSyncError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const shared = user?.theme != null;

  const saveAccountTheme = (next: ThemeId | null) => {
    setSyncBusy(true);
    setSyncError('');
    api.setAccountTheme(next)
      .then(onAccountTheme)
      .catch(() => setSyncError('Could not save to your account'))
      .finally(() => setSyncBusy(false));
  };

  const chooseTheme = (next: ThemeId) => {
    setTheme(next);
    if (shared) saveAccountTheme(next);
  };

  return (
    <Modal onClose={onClose} labelledBy="settings-title" className="tile w-full max-w-2xl h-auto!">
      <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-line">
        <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent-soft text-accent-text shrink-0">
          <Settings className="w-5 h-5" />
        </div>
        <h2 id="settings-title" className="flex-1 text-lg font-bold text-ink">Settings</h2>
        <button onClick={onClose} aria-label="Close" className="grid place-items-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink hover:bg-fill transition">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-5 sm:px-6 py-5 space-y-7">
        {install !== 'none' && (
          <Section icon={Download} title="App">
            <button
              onClick={() => (install === 'prompt' ? void promptInstall() : setShowHowTo(true))}
              className="w-full flex items-center gap-3 rounded-xl bg-well border border-line px-4 py-3 text-left hover:border-line-strong transition"
            >
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent-soft text-accent-text shrink-0">
                <Download className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Install WeatherDash</span>
                <span className="block text-xs text-ink-3">Opens in its own window, straight to your last station</span>
              </span>
            </button>
          </Section>
        )}

        <Section icon={Palette} title="Theme">
          <div className="grid grid-cols-2 gap-3">
            {THEMES.map(option => {
              const selected = option.id === theme;
              const [page, card, accent] = option.swatch;
              return (
                <button
                  key={option.id}
                  onClick={() => chooseTheme(option.id)}
                  aria-pressed={selected}
                  className={`group relative text-left rounded-xl border-2 p-1.5 transition ${
                    selected ? 'border-accent' : 'border-line hover:border-line-strong'
                  }`}
                >
                  {/* The theme's own page, cards and accent, so it is chosen by eye. */}
                  <span className="block h-20 rounded-lg p-2 overflow-hidden" style={{ background: page }} aria-hidden="true">
                    <span className="flex gap-1.5 h-full">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="flex-1 rounded-md p-1.5 flex flex-col justify-end gap-1" style={{ background: card }}>
                          <span className="h-1.5 rounded-full" style={{ background: accent, width: `${[70, 45, 85][i]}%` }} />
                          <span className="h-1 rounded-full opacity-40" style={{ background: accent, width: '55%' }} />
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="flex items-start gap-2 px-1.5 pt-2 pb-1">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{option.name}</span>
                      <span className="block text-xs text-ink-3 leading-snug">{option.blurb}</span>
                    </span>
                    {selected && <Check className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />}
                  </span>
                </button>
              );
            })}
          </div>
          {user && (
            <label className="mt-3 flex items-center gap-3 rounded-xl bg-well border border-line px-4 py-3 cursor-pointer">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Same theme on all my devices</span>
                <span className="block text-xs text-ink-3">Wherever you're signed in</span>
              </span>
              <Switch checked={shared} disabled={syncBusy} onChange={on => saveAccountTheme(on ? theme : null)} />
            </label>
          )}
          {syncError && <p role="alert" className="mt-2 text-xs text-danger-text">{syncError}</p>}
        </Section>

        <Section icon={Ruler} title="Units">
          <Segmented
            label="Units"
            value={units.system}
            onChange={setSystem}
            options={[
              { value: 'us', label: 'US', detail: '°F · mph · in · inHg' },
              { value: 'metric', label: 'Metric', detail: '°C · km/h · mm · hPa' },
            ]}
          />
        </Section>

        <Section icon={Timer} title="Close popups after">
          <Segmented
            label="Close popups after"
            value={popupSeconds}
            onChange={setPopupTimeout}
            options={POPUP_TIMEOUT_OPTIONS.map(o => ({ value: o.seconds, label: o.label }))}
          />
          <p className="mt-2 text-xs text-ink-3">Counted from the last touch. Pin a popup to keep it open.</p>
        </Section>
      </div>

      {showHowTo && (
        <Modal onClose={() => setShowHowTo(false)} label="Install WeatherDash" className="bg-card rounded-2xl border border-line shadow-2xl w-full max-w-sm p-6">
          <h2 className="text-xl font-bold text-ink">Install WeatherDash</h2>
          <ol className="mt-4 space-y-3 text-ink-2">
            <li className="flex items-center gap-3">
              <Share className="w-5 h-5 text-accent-text shrink-0" />
              <span>Tap <b className="text-ink">Share</b> in Safari’s toolbar.</span>
            </li>
            <li className="flex items-center gap-3">
              <SquarePlus className="w-5 h-5 text-accent-text shrink-0" />
              <span>Choose <b className="text-ink">Add to Home Screen</b>.</span>
            </li>
          </ol>
          <button
            type="button"
            onClick={() => setShowHowTo(false)}
            className="mt-6 w-full rounded-lg bg-accent-strong text-accent-ink py-2 font-semibold"
          >
            Got it
          </button>
        </Modal>
      )}
    </Modal>
  );
};

const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <section>
    <h3 className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.18em] text-ink-3">
      <Icon className="w-4 h-4" /> {title}
    </h3>
    {children}
  </section>
);

function Segmented<T extends string | number>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; detail?: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex p-1 rounded-xl bg-well-deep border border-line">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 min-w-0 px-2 py-2 rounded-lg text-sm font-semibold transition ${
              on ? 'bg-accent-strong text-accent-ink shadow' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {o.label}
            {o.detail && <span className={`block text-[11px] font-medium ${on ? 'text-accent-ink/80' : 'text-ink-4'}`}>{o.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const Switch: React.FC<{ checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }> = ({ checked, disabled, onChange }) => (
  <>
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className="relative shrink-0 w-10 h-6 rounded-full bg-fill-strong transition peer-checked:bg-accent-strong peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-disabled:opacity-50 after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-marker after:transition peer-checked:after:translate-x-4"
    />
  </>
);
