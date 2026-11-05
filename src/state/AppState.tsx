import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';

import { DEFAULT_SETTINGS, type Alert, type Settings, type TimelineItem } from '../core/types';
import { DEMO_LAST_STEP } from '../providers/demo';
import { storage, type SyncMeta } from '../platform/storage';
import { performSync } from '../services/sync';

interface AppStateValue {
  ready: boolean;
  syncing: boolean;
  settings: Settings;
  alerts: Alert[];
  timeline: TimelineItem[];
  meta: SyncMeta;
  demoStep: number;
  /** Алерти з останньої ручної перевірки — показуємо банером. */
  fresh: Alert[];
  dismissFresh: () => void;
  sync: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  markAllRead: () => Promise<void>;
  nextDemoDay: () => Promise<void>;
  resetData: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [meta, setMeta] = useState<SyncMeta>({ errors: [] });
  const [demoStep, setDemoStep] = useState(0);
  const [fresh, setFresh] = useState<Alert[]>([]);

  const reload = useCallback(async () => {
    const [s, a, t, m, d] = await Promise.all([
      storage.getSettings(),
      storage.getAlerts(),
      storage.getTimeline(),
      storage.getMeta(),
      storage.getDemoStep(),
    ]);
    setSettings(s);
    setAlerts(a);
    setTimeline(t);
    setMeta(m);
    setDemoStep(d);
    return m;
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await performSync();
      setFresh(r.newAlerts);
    } catch (e) {
      await storage.setMeta({ ...(await storage.getMeta()), errors: [String(e)] });
    } finally {
      await reload();
      setSyncing(false);
    }
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await reload();
      if (cancelled) return;
      setReady(true);
      // Перший запуск: одразу підтягуємо дані (у демо — стартовий тиждень).
      if (!m.lastRunAt) await sync();
    })();
    // Фонова задача могла оновити дані, поки додаток був згорнутий.
    const sub = RNAppState.addEventListener('change', (st) => {
      if (st === 'active') void reload();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [reload, sync]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...(await storage.getSettings()), ...patch };
      await storage.setSettings(next);
      setSettings(next);
      if (patch.demoMode !== undefined) {
        // Перемикання джерела даних — починаємо історію заново.
        await storage.resetData();
        await sync();
      }
    },
    [sync],
  );

  const markAllRead = useCallback(async () => {
    const next = (await storage.getAlerts()).map((a) => ({ ...a, read: true }));
    await storage.setAlerts(next);
    setAlerts(next);
  }, []);

  const nextDemoDay = useCallback(async () => {
    const step = Math.min((await storage.getDemoStep()) + 1, DEMO_LAST_STEP);
    await storage.setDemoStep(step);
    await sync();
  }, [sync]);

  const resetData = useCallback(async () => {
    await storage.resetData();
    setFresh([]);
    await sync();
  }, [sync]);

  const value = useMemo<AppStateValue>(
    () => ({
      ready,
      syncing,
      settings,
      alerts,
      timeline,
      meta,
      demoStep,
      fresh,
      dismissFresh: () => setFresh([]),
      sync,
      updateSettings,
      markAllRead,
      nextDemoDay,
      resetData,
    }),
    [ready, syncing, settings, alerts, timeline, meta, demoStep, fresh, sync, updateSettings, markAllRead, nextDemoDay, resetData],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState must be used inside AppStateProvider');
  return v;
}
