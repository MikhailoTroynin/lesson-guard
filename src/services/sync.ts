import { DEMO_LAST_STEP, demoClassroom, demoGrades } from '../providers/demo';
import { GoogleClassroomProvider } from '../providers/classroom/google';
import { EschoolGradesProvider } from '../providers/eschool/client';
import type { ClassroomProvider, GradesProvider } from '../providers/types';
import { getGoogleAccessToken, invalidateGoogleToken, isGoogleConnected } from '../platform/googleAuth';
import { showAlertNotifications } from '../platform/notifications';
import { secrets } from '../platform/secrets';
import { storage } from '../platform/storage';
import { collectAndCheck, type CollectResult } from './collect';

export const ESCHOOL_LOGIN_KEY = 'eschool.login';
export const ESCHOOL_PASSWORD_KEY = 'eschool.password';

async function buildProviders(demo: boolean): Promise<{
  classroom: ClassroomProvider | null;
  grades: GradesProvider | null;
}> {
  if (demo) {
    const step = Math.min(await storage.getDemoStep(), DEMO_LAST_STEP);
    const now = new Date();
    return { classroom: demoClassroom(step, now), grades: demoGrades(step, now) };
  }
  const classroom = isGoogleConnected()
    ? new GoogleClassroomProvider({
        getAccessToken: getGoogleAccessToken,
        invalidateToken: invalidateGoogleToken,
      })
    : null;
  const login = await secrets.get(ESCHOOL_LOGIN_KEY);
  const password = await secrets.get(ESCHOOL_PASSWORD_KEY);
  const grades = login && password ? new EschoolGradesProvider({ login, password }) : null;
  return { classroom, grades };
}

let running: Promise<CollectResult> | null = null;

/**
 * Повна перевірка: дані → правила → збереження → сповіщення.
 * Викликається з екрана («Перевірити зараз») і з фонової задачі.
 */
export function performSync(): Promise<CollectResult> {
  if (running) return running;
  running = (async () => {
    const settings = await storage.getSettings();
    const state = await storage.getState();
    const providers = await buildProviders(settings.demoMode);
    const result = await collectAndCheck({ ...providers, settings, state, now: new Date() });
    await storage.setState(result.state);
    await storage.setTimeline(result.timeline);
    await storage.setMeta({ lastRunAt: result.state.lastRunAt, errors: result.errors });
    if (result.newAlerts.length > 0) {
      await storage.addAlerts(result.newAlerts);
      await showAlertNotifications(result.newAlerts);
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
