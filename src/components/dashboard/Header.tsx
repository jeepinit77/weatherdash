import React, { useLayoutEffect, useRef, useState } from 'react';
import { CloudSun, Settings, User as UserIcon } from 'lucide-react';
import { StationSwitcher } from './StationSwitcher';
import { stationPath } from '../../lib/format';
import { useScrollReveal } from '../../lib/useScrollReveal';
import type { PublicStation, User } from '../../types/weather';

interface HeaderProps {
  currentSlug: string | null;
  publicStations: PublicStation[];
  user: User | null;
  onNavigate: (slug: string | null) => void;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  /** Receives the element a page renders its own controls into, so there is one bar rather than two. */
  toolbarRef: (el: HTMLDivElement | null) => void;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const Header: React.FC<HeaderProps> = ({ currentSlug, publicStations, user, onNavigate, onOpenAccount, onOpenSettings, toolbarRef }) => {
  const headerRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  const { mode, animate } = useScrollReveal(headerRef);

  // The bar wraps to two rows on a phone, and a page's controls come and go,
  // so its height is measured rather than assumed.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pinned = mode !== 'inline';

  return (
    // Holds the header's place in the page while it is pinned, so nothing below jumps.
    <div className="w-full mb-6" style={pinned ? { height } : undefined}>
      <header
        ref={headerRef}
        className={`z-40 w-full glass-panel border-b border-line px-4 md:px-8 py-3 ${
          pinned ? 'fixed inset-x-0 top-0' : 'relative'
        } ${mode === 'hidden' ? '-translate-y-full focus-within:translate-y-0' : 'translate-y-0'}`}
        // Set here rather than by class, since .glass-panel animates every property: the
        // swap into the pinned position must be instant, only the slide in and out moves.
        style={{ transition: animate && !reducedMotion() ? 'translate 300ms ease' : 'none' }}
      >
        {/* The page caps at 96rem with its padding inside; this padding is outside, so 92rem lines the two up. */}
        <div className="max-w-[92rem] mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3 min-w-0">
            <a
              href={stationPath(null)}
              onClick={e => { e.preventDefault(); onNavigate(null); }}
              className="flex items-center gap-2 shrink-0"
            >
              <span className="p-2 rounded-xl bg-accent-soft border border-accent-line text-accent-text">
                <CloudSun className="w-6 h-6" />
              </span>
              <span className="hidden sm:inline text-lg font-bold text-ink tracking-tight">WeatherDash</span>
            </a>
            <StationSwitcher currentSlug={currentSlug} stations={publicStations} onSelectStation={onNavigate} />
          </div>

          {/* A page's own controls. On narrow screens they take a second row of the same bar. */}
          <div
            ref={toolbarRef}
            className="empty:hidden order-last w-full lg:order-none lg:w-auto lg:ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2"
          />

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 lg:pl-2 lg:border-l lg:border-line-soft">
            <button
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
              className="glass-button p-2 rounded-lg text-ink-3 hover:text-ink transition shrink-0"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenAccount}
              className="glass-button px-3 py-2 rounded-lg text-sm text-ink-2 flex items-center gap-2 transition hover:text-ink"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-5 h-5 rounded-full" />
              ) : (
                <UserIcon className="w-4 h-4 text-accent-text" />
              )}
              <span className="hidden sm:inline">{user ? 'My stations' : 'Sign in'}</span>
            </button>
          </div>
        </div>
      </header>
    </div>
  );
};
