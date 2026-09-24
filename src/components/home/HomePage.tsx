import React from 'react';
import { CloudSun, Plus, ChevronRight } from 'lucide-react';
import { fmt, stationPath, timeAgo } from '../../lib/format';
import { useUnits } from '../../lib/units';
import type { PublicStation } from '../../types/weather';

interface HomePageProps {
  stations: PublicStation[];
  onNavigate: (slug: string) => void;
  onOpenAccount: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ stations, onNavigate, onOpenAccount }) => {
  const units = useUnits();
  return (
  <div className="max-w-5xl mx-auto px-4 md:px-8 pb-12 space-y-8">
    <section className="tile p-8 sm:p-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-accent-soft border border-accent-line text-accent-text shrink-0">
          <CloudSun className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Personal weather station dashboards</h1>
          <p className="text-sm text-ink-3 mt-1 max-w-xl">
            Connect your Ambient Weather station to get a shareable page with live conditions, a local forecast,
            and history charts recorded every 5 minutes.
          </p>
        </div>
      </div>
      <button
        onClick={onOpenAccount}
        className="px-5 py-3 rounded-2xl bg-accent-strong hover:bg-accent text-accent-ink font-bold text-sm flex items-center justify-center gap-2 transition shrink-0"
      >
        <Plus className="w-4 h-4" /> Add your station
      </button>
    </section>

    <section>
      <h2 className="text-sm font-semibold text-ink-3 uppercase tracking-wider mb-3">Public stations</h2>
      {stations.length === 0 ? (
        <div className="tile p-8 text-center text-sm text-ink-3">
          No stations have been shared publicly yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stations.map(st => (
            <a
              key={st.slug}
              href={stationPath(st.slug)}
              onClick={e => { e.preventDefault(); onNavigate(st.slug); }}
              className="tile p-5 flex items-center justify-between hover:border-line-strong transition group"
            >
              <div className="min-w-0">
                <div className="font-semibold text-ink truncate">{st.name}</div>
                <div className="text-xs text-ink-3 mt-0.5">
                  <span className="font-mono">/{st.slug}</span> · {st.lastUpdated ? `updated ${timeAgo(st.lastUpdated)}` : 'no readings yet'}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-2xl font-bold text-warn-text">{fmt(units.temp(st.tempf), 0, '°')}</span>
                <ChevronRight className="w-4 h-4 text-ink-4 group-hover:text-ink transition" />
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  </div>
  );
};
