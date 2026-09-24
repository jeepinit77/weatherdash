import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown, Check, Globe } from 'lucide-react';
import { fmt } from '../../lib/format';
import { useUnits } from '../../lib/units';
import type { PublicStation } from '../../types/weather';

interface StationSwitcherProps {
  currentSlug: string | null;
  stations: PublicStation[];
  onSelectStation: (slug: string) => void;
}

export const StationSwitcher: React.FC<StationSwitcherProps> = ({ currentSlug, stations, onSelectStation }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const active = stations.find(s => s.slug === currentSlug);
  const units = useUnits();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <div className="relative min-w-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className="glass-button px-3 py-1.5 rounded-xl text-sm flex items-center gap-2 text-ink hover:border-line-strong transition min-w-0"
      >
        <MapPin className="hidden min-[380px]:block w-4 h-4 text-danger-text shrink-0" />
        <span className="block font-semibold truncate max-w-[72px] min-[380px]:max-w-[140px] sm:max-w-[220px]">
          {active ? active.name : 'Stations'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 glass-panel rounded-2xl p-2 border border-line shadow-2xl z-50">
          <div className="px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wider flex items-center justify-between border-b border-line-soft mb-1">
            <span className="flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-info-text" /> Public stations
            </span>
            <span className="text-[11px] text-ink-3">{stations.length}</span>
          </div>

          {stations.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-3">No public stations yet.</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {stations.map(st => (
                <button
                  key={st.slug}
                  onClick={() => { onSelectStation(st.slug); setIsOpen(false); }}
                  className={`w-full p-2.5 rounded-xl text-left flex items-center justify-between transition ${
                    st.slug === currentSlug ? 'bg-accent-soft text-ink border border-accent-line' : 'hover:bg-fill-soft text-ink-2'
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold truncate">{st.name}</span>
                    <span className="text-[11px] font-mono text-ink-3">/{st.slug}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {st.tempf !== null && <span className="text-xs font-bold text-warn-text">{fmt(units.temp(st.tempf), 0, units.tempUnit)}</span>}
                    {st.slug === currentSlug && <Check className="w-4 h-4 text-accent-text" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
