import React from 'react';
import { X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { Reading, StationStats } from '../../types/weather';

interface MockDataEditorModalProps {
  isOpen: boolean;
  reading: Reading;
  stats: StationStats;
  onClose: () => void;
  /** Called after every edit so the caller can re-fetch and re-render with the new mock values. */
  onApply: () => void;
}

interface MockField {
  /** Dot path into `{ reading, stats, sun }`, e.g. "reading.tempf" or "stats.today.high.value". */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const GROUPS: { title: string; fields: MockField[] }[] = [
  {
    title: 'Temperature',
    fields: [
      { path: 'reading.tempf', label: 'Temperature', min: -20, max: 120, step: 1, unit: '°F' },
      { path: 'reading.feelsLike', label: 'Feels Like', min: -20, max: 120, step: 1, unit: '°F' },
      { path: 'stats.today.high.value', label: "Today's High", min: -20, max: 120, step: 1, unit: '°F' },
      { path: 'stats.today.low.value', label: "Today's Low", min: -20, max: 120, step: 1, unit: '°F' },
      { path: 'stats.yesterday.high.value', label: "Yesterday's High", min: -20, max: 120, step: 1, unit: '°F' },
      { path: 'stats.yesterday.low.value', label: "Yesterday's Low", min: -20, max: 120, step: 1, unit: '°F' },
    ],
  },
  {
    title: 'Wind',
    fields: [
      { path: 'reading.windspeedmph', label: 'Wind Speed', min: 0, max: 60, step: 1, unit: 'mph' },
      { path: 'reading.windgustmph', label: 'Gust', min: 0, max: 80, step: 1, unit: 'mph' },
      { path: 'reading.winddir', label: 'Direction', min: 0, max: 359, step: 1, unit: '°' },
      { path: 'stats.today.maxGust', label: "Today's Max Gust", min: 0, max: 80, step: 1, unit: 'mph' },
    ],
  },
  {
    title: 'Rain',
    fields: [
      { path: 'reading.dailyrainin', label: 'Daily Total', min: 0, max: 5, step: 0.01, unit: 'in' },
      { path: 'reading.hourlyrainin', label: 'Rain Rate', min: 0, max: 2, step: 0.01, unit: 'in/hr' },
      { path: 'reading.eventrainin', label: 'Event Total', min: 0, max: 5, step: 0.01, unit: 'in' },
      { path: 'stats.rain7d', label: '7-Day Total', min: 0, max: 20, step: 0.1, unit: 'in' },
    ],
  },
  {
    title: 'Sun',
    fields: [
      { path: 'sun.sunriseHour', label: 'Sunrise', min: 0, max: 24, step: 0.25, unit: 'h' },
      { path: 'sun.sunsetHour', label: 'Sunset', min: 0, max: 24, step: 0.25, unit: 'h' },
    ],
  },
  {
    title: 'Humidity',
    fields: [
      { path: 'reading.humidity', label: 'Outdoor Humidity', min: 0, max: 100, step: 1, unit: '%' },
      { path: 'reading.humidityin', label: 'Indoor Humidity', min: 0, max: 100, step: 1, unit: '%' },
      { path: 'reading.dewPoint', label: 'Dew Point', min: -20, max: 100, step: 1, unit: '°F' },
      { path: 'stats.today.humidityHigh', label: "Today's High", min: 0, max: 100, step: 1, unit: '%' },
      { path: 'stats.today.humidityLow', label: "Today's Low", min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
];

function getAtPath(root: unknown, path: string): number {
  const value = path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), root);
  return typeof value === 'number' ? value : 0;
}

function setAtPath(root: Record<string, unknown>, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, root);
  target[last] = value;
}

const FieldRow: React.FC<{ field: MockField; value: number; onChange: (value: number) => void }> = ({ field, value, onChange }) => (
  <div className="py-2">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs font-medium text-ink-2">{field.label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={e => onChange(Number(e.target.value))}
          className="w-20 bg-well border border-line rounded-md px-2 py-0.5 text-xs text-ink text-right font-mono"
        />
        <span className="text-[11px] text-ink-4 w-9">{field.unit}</span>
      </div>
    </div>
    <input
      type="range"
      min={field.min}
      max={field.max}
      step={field.step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full accent-accent"
    />
  </div>
);

/** Dev-only overlay for tweaking the values behind the mock dashboard, grouped to match each tile. */
export const MockDataEditorModal: React.FC<MockDataEditorModalProps> = ({ isOpen, reading, stats, onClose, onApply }) => {
  if (!isOpen) return null;

  // Sun times aren't part of the station response, so they're read straight off the mock.
  const root = { reading, stats, sun: window.__mockData?.sun };

  const handleChange = (field: MockField, value: number) => {
    const mock = window.__mockData;
    if (!mock) return;
    setAtPath(mock as unknown as Record<string, unknown>, field.path, value);
    onApply();
  };

  return (
    <Modal onClose={onClose} label="Edit mock data" className="tile w-full max-w-lg p-6">
        <div className="flex items-center justify-between pb-4 mb-2 border-b border-line">
          <div>
            <h2 className="text-lg font-bold text-ink">Edit Mock Data</h2>
            <p className="text-xs text-ink-3">Grouped by the tile each value drives</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-fill transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto overscroll-contain pr-1 divide-y divide-line-soft">
          {GROUPS.map(group => (
            <div key={group.title} className="py-3 first:pt-0">
              <div className="text-xs font-bold text-ink-3 tracking-[0.15em] uppercase mb-1">{group.title}</div>
              {group.fields.map(field => (
                <FieldRow key={field.path} field={field} value={getAtPath(root, field.path)} onChange={v => handleChange(field, v)} />
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end mt-4 pt-4 border-t border-line">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-accent-strong text-accent-ink font-medium text-sm hover:bg-accent transition shadow-lg shadow-accent-soft"
          >
            Done
          </button>
        </div>
    </Modal>
  );
};
