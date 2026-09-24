import React from 'react';
import type { WidgetType } from '../../types/weather';

const svg = (viewBox: string, children: React.ReactNode) => (
  <svg viewBox={viewBox} className="w-full h-full" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
    {children}
  </svg>
);

/**
 * A line drawing of the shape each widget takes, for the editor's miniature
 * dashboard. Deliberately abstract, with no figures in it: a preview that showed
 * numbers would look like a real reading.
 */
export const WidgetGlyph: React.FC<{ type: WidgetType }> = ({ type }) => {
  switch (type) {
    case 'temperature':
      return svg('0 0 60 60', <>
        <rect x="25" y="6" width="10" height="36" rx="5" strokeWidth="2.5" opacity="0.45" />
        <line x1="30" y1="20" x2="30" y2="44" strokeWidth="4" />
        <circle cx="30" cy="47" r="8" fill="currentColor" stroke="none" />
      </>);
    case 'wind':
      return svg('0 0 60 60', <>
        <circle cx="30" cy="30" r="21" strokeWidth="2.5" opacity="0.3" />
        {[0, 90, 180, 270].map(a => (
          <line key={a} x1="30" y1="9" x2="30" y2="14" strokeWidth="2.5" opacity="0.5" transform={`rotate(${a} 30 30)`} />
        ))}
        {/* A balanced needle through the hub: solid head, faded tail. */}
        <g transform="rotate(40 30 30)" stroke="none" fill="currentColor">
          <path d="M30 13 L34.5 30 L25.5 30 Z" />
          <path d="M25.5 30 L34.5 30 L30 47 Z" opacity="0.35" />
        </g>
        <circle cx="30" cy="30" r="2.5" fill="currentColor" stroke="none" />
      </>);
    case 'rain':
      return svg('0 0 60 60', <>
        <path d="M18 18c3 5 5 8 5 10a5 5 0 0 1-10 0c0-2 2-5 5-10Z" fill="currentColor" stroke="none" opacity="0.55" />
        <path d="M31 10c4 6 6 10 6 13a6 6 0 0 1-12 0c0-3 2-7 6-13Z" fill="currentColor" stroke="none" />
        <path d="M44 22c3 5 5 8 5 10a5 5 0 0 1-10 0c0-2 2-5 5-10Z" fill="currentColor" stroke="none" opacity="0.55" />
        <line x1="10" y1="50" x2="50" y2="50" strokeWidth="3" opacity="0.35" />
        <line x1="10" y1="50" x2="32" y2="50" strokeWidth="3" />
      </>);
    case 'humidity':
      return svg('0 0 60 60', <>
        <circle cx="30" cy="30" r="20" strokeWidth="5" opacity="0.2" />
        <path d="M30 10a20 20 0 1 1-19 26" strokeWidth="5" />
        <path d="M30 22c3 4 5 7 5 9a5 5 0 0 1-10 0c0-2 2-5 5-9Z" fill="currentColor" stroke="none" opacity="0.8" />
      </>);
    case 'pressure':
      return svg('0 0 60 60', <>
        <path d="M9 42a21 21 0 0 1 42 0" strokeWidth="5" opacity="0.25" />
        <path d="M9 42a21 21 0 0 1 30-19" strokeWidth="5" />
        <line x1="30" y1="42" x2="41" y2="27" strokeWidth="3" />
        <circle cx="30" cy="42" r="3.5" fill="currentColor" stroke="none" />
      </>);
    case 'uv-solar':
      return svg('0 0 60 60', <>
        <circle cx="30" cy="30" r="10" fill="currentColor" stroke="none" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
          <line key={a} x1="30" y1="12" x2="30" y2="6" strokeWidth="3" transform={`rotate(${a} 30 30)`} opacity="0.7" />
        ))}
      </>);
    case 'time-date':
      return svg('0 0 60 60', <>
        <circle cx="30" cy="30" r="20" strokeWidth="3" opacity="0.4" />
        <line x1="30" y1="30" x2="30" y2="17" strokeWidth="3.5" />
        <line x1="30" y1="30" x2="39" y2="35" strokeWidth="3.5" />
        <circle cx="30" cy="30" r="2.5" fill="currentColor" stroke="none" />
      </>);
    case 'clock-daylight':
      return svg('0 0 200 40', <>
        <path d="M20 30 Q100 -6 180 30" strokeWidth="2" strokeDasharray="3 5" opacity="0.5" />
        <circle cx="74" cy="13" r="6" fill="currentColor" stroke="none" />
        <line x1="8" y1="37" x2="192" y2="37" strokeWidth="3" opacity="0.2" />
        <line x1="8" y1="37" x2="74" y2="37" strokeWidth="3" />
      </>);
    case 'forecast-strip':
      return svg('0 0 210 60', <>
        {[0, 1, 2, 3, 4, 5, 6].map(i => {
          const x = 8 + i * 29;
          const hi = [16, 12, 20, 14, 10, 18, 15][i];
          return (
            <g key={i}>
              <rect x={x} y="4" width="25" height="52" rx="5" strokeWidth="1.5" opacity="0.3" />
              <circle cx={x + 12.5} cy="16" r="4.5" fill="currentColor" stroke="none" opacity="0.8" />
              <line x1={x + 12.5} y1={26 + (20 - hi)} x2={x + 12.5} y2="48" strokeWidth="4" />
            </g>
          );
        })}
      </>);
    case 'air-quality':
      return svg('0 0 60 60', <>
        <path d="M13 44 A21 21 0 1 1 47 44" strokeWidth="6" opacity="0.3" />
        <path d="M13 44 A21 21 0 0 1 22 13" strokeWidth="6" />
        <circle cx="22" cy="13" r="4.5" fill="currentColor" stroke="none" />
      </>);
    case 'almanac':
      return svg('0 0 60 60', <>
        {[14, 26].map(y => (
          <g key={y}>
            <line x1="8" y1={y} x2="20" y2={y} strokeWidth="3" opacity="0.5" />
            <line x1="26" y1={y} x2="34" y2={y} strokeWidth="4" />
            <line x1="40" y1={y} x2="52" y2={y} strokeWidth="4" opacity="0.6" />
          </g>
        ))}
        <line x1="8" y1="40" x2="52" y2="40" strokeWidth="4" opacity="0.2" />
        <line x1="8" y1="40" x2="38" y2="40" strokeWidth="4" />
        <line x1="8" y1="50" x2="52" y2="50" strokeWidth="4" opacity="0.2" />
        <line x1="8" y1="50" x2="44" y2="50" strokeWidth="4" />
      </>);
    case 'radar':
      return svg('0 0 60 60', <>
        <rect x="6" y="6" width="48" height="48" rx="6" strokeWidth="2" opacity="0.35" />
        <path d="M14 40 C18 26 30 20 40 24 S50 38 42 44 S20 50 14 40 Z" fill="currentColor" stroke="none" opacity="0.35" />
        <path d="M24 36 C26 30 32 28 36 31 S38 38 33 40 S24 40 24 36 Z" fill="currentColor" stroke="none" />
        <circle cx="30" cy="30" r="2.5" fill="currentColor" stroke="none" />
      </>);
    case 'moon':
      return svg('0 0 60 60', <>
        <circle cx="30" cy="30" r="20" strokeWidth="2.5" opacity="0.35" />
        <path d="M30 10 A20 20 0 0 1 30 50 A10 20 0 0 1 30 10 Z" fill="currentColor" stroke="none" />
      </>);
    case 'indoor':
      return svg('0 0 60 60', <>
        <path d="M10 30 L30 12 L50 30" strokeWidth="3" strokeLinejoin="round" opacity="0.5" />
        <path d="M16 26 V50 H44 V26" strokeWidth="2.5" opacity="0.35" />
        <rect x="23" y="30" width="14" height="14" rx="3" fill="currentColor" stroke="none" />
      </>);
    case 'week-ahead':
      return svg('0 0 60 60', <>
        {[[12, 34], [18, 44], [8, 30], [22, 48]].map(([from, to], i) => (
          <g key={i}>
            <line x1="6" y1={12 + i * 12} x2="54" y2={12 + i * 12} strokeWidth="4" opacity="0.2" />
            <line x1={from} y1={12 + i * 12} x2={to} y2={12 + i * 12} strokeWidth="4" />
          </g>
        ))}
      </>);
    case 'hourly':
      return svg('0 0 200 60', <>
        <path d="M6 26 C30 14 50 10 74 16 S118 34 142 28 S178 12 194 18" strokeWidth="3.5" />
        {Array.from({ length: 12 }, (_, i) => {
          const h = [4, 6, 10, 16, 20, 14, 8, 4, 2, 2, 6, 10][i];
          return <rect key={i} x={8 + i * 16} y={56 - h} width="10" height={h} rx="2" fill="currentColor" stroke="none" opacity="0.45" />;
        })}
      </>);
    case 'historical-chart':
      return svg('0 0 200 60', <>
        {[14, 30, 46].map(y => <line key={y} x1="4" y1={y} x2="196" y2={y} strokeWidth="1" opacity="0.18" />)}
        <path d="M4 44 C24 40 34 18 56 22 S88 46 110 34 S148 8 170 16 S190 30 196 26 L196 56 L4 56 Z" fill="currentColor" stroke="none" opacity="0.15" />
        <path d="M4 44 C24 40 34 18 56 22 S88 46 110 34 S148 8 170 16 S190 30 196 26" strokeWidth="3" />
      </>);
    case 'current-station':
      return svg('0 0 200 40', <>
        <rect x="6" y="8" width="44" height="24" rx="6" fill="currentColor" stroke="none" opacity="0.8" />
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i} opacity="0.55">
            <line x1={64 + i * 27} y1="14" x2={80 + i * 27} y2="14" strokeWidth="3" opacity="0.6" />
            <line x1={64 + i * 27} y1="26" x2={84 + i * 27} y2="26" strokeWidth="4" />
          </g>
        ))}
      </>);
    case 'station-status':
      return svg('0 0 200 40', <>
        <rect x="70" y="4" width="60" height="12" rx="6" fill="currentColor" stroke="none" opacity="0.25" />
        <circle cx="80" cy="10" r="3" fill="currentColor" stroke="none" />
        {[0, 1, 2, 3].map(i => (
          <g key={i} opacity="0.6">
            <line x1={24 + i * 42} y1="26" x2={48 + i * 42} y2="26" strokeWidth="2" opacity="0.6" />
            <line x1={26 + i * 42} y1="34" x2={46 + i * 42} y2="34" strokeWidth="3.5" />
          </g>
        ))}
      </>);
  }
};
