import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';

import { DEFAULT_SETTINGS, type Alert, type Settings, type TimelineItem } from '../core/types';
import { DEMO_LAST_STEP } from '../providers/demo';
import { api, getToken, setToken } from '../platform/api';
import { onBackgroundSync } from '../platform/background';
import { storage, type SyncMeta } from '../platform/storage';
import { performSync, SERVER_SETTING_KEYS } from '../services/sync';

interface AppStateValue {
  ready: boolean;
  syncing: boolean;
  settings: Settings;
  alerts: Alert[];
  timeline: TimelineItem[];
  meta: SyncMeta;
  demoStep: number;
  /** Чи є сесія сторінки налаштувань (вхід через Telegram). */
  loggedIn: boolean;
  /** Після входу: вимикає демо й підтягує справжні дані. */
  onLoggedIn: () => Promise<void>;
  logout: () => Promise<void>;
  /** Алерти з останньої ручної перевірки — показуємо банером. */
  fresh: Alert[];
  dismissFresh: () => void;
  sync: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
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
  const [loggedIn, setLoggedIn] = useState(false);

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
    setLoggedIn(!!(await getToken()));
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
    const unsubBg = onBackgroundSync(() => void reload());
    return () => {
      cancelled = true;
      sub.remove();
      unsubBg();
    };
  }, [reload, sync]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      // Налаштування сповіщень зберігаються на сервері (їх використовує й робот/бот).
      const serverPatch = Object.fromEntries(
        Object.entries(patch).filter(([k]) => (SERVER_SETTING_KEYS as readonly string[]).includes(k)),
      );
      if (Object.keys(serverPatch).length && (await getToken())) await api.putSettings(serverPatch);
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

  const markRead = useCallback(async (id: string) => {
    const next = (await storage.getAlerts()).map((a) => (a.id === id ? { ...a, read: true } : a));
    await storage.setAlerts(next);
    setAlerts(next);
    setFresh((f) => f.map((a) => (a.id === id ? { ...a, read: true } : a)));
  }, []);

  const nextDemoDay = useCallback(async () => {
    const step = Math.min((await storage.getDemoStep()) + 1, DEMO_LAST_STEP);
    await storage.setDemoStep(step);
    await sync();
  }, [sync]);

  const onLoggedIn = useCallback(async () => {
    setLoggedIn(true);
    const cur = await storage.getSettings();
    if (cur.demoMode && process.env.EXPO_PUBLIC_DEMO !== '1') {
      await storage.setSettings({ ...cur, demoMode: false });
      await storage.resetData();
    }
    await reload();
    await sync();
  }, [reload, sync]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    await setToken(null);
    setLoggedIn(false);
    await storage.resetData();
    await reload();
  }, [reload]);

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
      loggedIn,
      onLoggedIn,
      logout,
      dismissFresh: () => setFresh([]),
      sync,
      updateSettings,
      markAllRead,
      markRead,
      nextDemoDay,
      resetData,
    }),
    [
      ready,
      syncing,
      settings,
      alerts,
      timeline,
      meta,
      demoStep,
      fresh,
      loggedIn,
      onLoggedIn,
      logout,
      sync,
      updateSettings,
      markAllRead,
      markRead,
      nextDemoDay,
      resetData,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState must be used inside AppStateProvider');
  return v;
}
