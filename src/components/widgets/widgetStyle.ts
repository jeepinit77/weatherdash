import {
  Activity, BookOpen, CalendarDays, CalendarRange, Clock3, CloudRain, Droplets, Gauge, House, Leaf, LayoutList, MoonStar, Radar, Sun, Sunrise, Thermometer,
  Timer, TrendingUp, Wind,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WidgetType } from '../../types/weather';

/** The icon that stands for each widget in the editor. */
export const WIDGET_ICON: Record<WidgetType, LucideIcon> = {
  'clock-daylight': Sunrise,
  'time-date': Timer,
  temperature: Thermometer,
  wind: Wind,
  rain: CloudRain,
  humidity: Droplets,
  pressure: Gauge,
  'uv-solar': Sun,
  'current-station': LayoutList,
  'forecast-strip': CalendarDays,
  'week-ahead': CalendarRange,
  indoor: House,
  'air-quality': Leaf,
  almanac: BookOpen,
  moon: MoonStar,
  radar: Radar,
  hourly: Clock3,
  'historical-chart': TrendingUp,
  'station-status': Activity,
};

/** Each widget's colour, borrowed from the scale its own card draws with, so it matches under every theme. */
export const WIDGET_TONE: Record<WidgetType, string> = {
  'clock-daylight': 'var(--daylight-2)',
  'time-date': 'var(--moon)',
  temperature: 'var(--temp-8)',
  wind: 'var(--wind-speed)',
  rain: 'var(--rain-total)',
  humidity: 'var(--humid-now)',
  pressure: 'var(--accent-text)',
  'uv-solar': 'var(--sun)',
  'current-station': 'var(--accent-text)',
  'forecast-strip': 'var(--info-text)',
  'week-ahead': 'var(--temp-6)',
  indoor: 'var(--temp-5)',
  'air-quality': 'var(--aqi-1)',
  almanac: 'var(--alt-text)',
  moon: 'var(--moon)',
  radar: 'var(--good-text)',
  hourly: 'var(--chart-temp-high)',
  'historical-chart': 'var(--good-text)',
  'station-status': 'var(--good-text)',
};

/** A soft wash of a tone, for the square an icon sits in. */
export const toneWash = (tone: string, amount = 16) => `color-mix(in srgb, ${tone} ${amount}%, transparent)`;
