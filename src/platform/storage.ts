import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_SETTINGS,
  EMPTY_STATE,
  type Alert,
  type CheckState,
  type Settings,
  type TimelineItem,
} from '../core/types';

const KEYS = {
  settings: 'lg.settings',
  state: 'lg.state',
  alerts: 'lg.alerts',
  timeline: 'lg.timeline',
  meta: 'lg.meta',
  demoStep: 'lg.demoStep',
} as const;

const MAX_ALERTS = 300;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/** Інформація про останню перевірку для екрана. */
export interface SyncMeta {
  lastRunAt?: string;
  errors: string[];
}

export const storage = {
  async getSettings(): Promise<Settings> {
    const forcedDemo = process.env.EXPO_PUBLIC_DEMO === '1';
    const s = { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(KEYS.settings, {})) };
    return forcedDemo ? { ...s, demoMode: true } : s;
  },
  setSettings: (s: Settings) => writeJson(KEYS.settings, s),

  getState: () => readJson<CheckState>(KEYS.state, EMPTY_STATE),
  setState: (s: CheckState) => writeJson(KEYS.state, s),

  getAlerts: () => readJson<Alert[]>(KEYS.alerts, []),
  async addAlerts(newAlerts: Alert[]): Promise<Alert[]> {
    const all = [...newAlerts, ...(await storage.getAlerts())].slice(0, MAX_ALERTS);
    await writeJson(KEYS.alerts, all);
    return all;
  },
  setAlerts: (a: Alert[]) => writeJson(KEYS.alerts, a),

  getTimeline: () => readJson<TimelineItem[]>(KEYS.timeline, []),
  setTimeline: (t: TimelineItem[]) => writeJson(KEYS.timeline, t),

  getMeta: () => readJson<SyncMeta>(KEYS.meta, { errors: [] }),
  setMeta: (m: SyncMeta) => writeJson(KEYS.meta, m),

  getDemoStep: () => readJson<number>(KEYS.demoStep, 0),
  setDemoStep: (n: number) => writeJson(KEYS.demoStep, n),

  /** Скидає стан перевірок і алерти (налаштування лишаються). */
  async resetData(): Promise<void> {
    await AsyncStorage.multiRemove([KEYS.state, KEYS.alerts, KEYS.timeline, KEYS.meta, KEYS.demoStep]);
  },
};
