import { DEMO_LAST_STEP, demoClassroom, demoGrades } from '../providers/demo';
import type { ClassroomProvider, GradesProvider } from '../providers/types';
import { WorkerSource } from '../providers/worker';
import { getToken, type ServerSettings } from '../platform/api';
import { showAlertNotifications } from '../platform/notifications';
import { storage } from '../platform/storage';
import { collectAndCheck, type CollectResult } from './collect';

/** Ключі налаштувань, які зберігаються на сервері (решта — лише в браузері). */
export const SERVER_SETTING_KEYS = [
  'badGradeThreshold',
  'notifyNewAssignments',
  'subjectMap',
  'matchWindowDays',
  'gradeLookbackDays',
] as const satisfies readonly (keyof ServerSettings)[];

export const NOT_LOGGED_IN = 'Увійдіть через Telegram на вкладці «Налаштування», щоб бачити справжні дані.';

let running: Promise<CollectResult> | null = null;

/**
 * Повна перевірка: дані → правила → збереження → сповіщення браузера.
 * Викликається з екрана («Перевірити») і за таймером, поки вкладка відкрита.
 */
export function performSync(): Promise<CollectResult> {
  if (running) return running;
  running = (async () => {
    let settings = await storage.getSettings();
    let classroom: ClassroomProvider | null = null;
    let grades: GradesProvider | null = null;
    const preErrors: string[] = [];

    if (settings.demoMode) {
      const step = Math.min(await storage.getDemoStep(), DEMO_LAST_STEP);
      const now = new Date();
      classroom = demoClassroom(step, now);
      grades = demoGrades(step, now);
    } else if (await getToken()) {
      const source = new WorkerSource();
      try {
        // Налаштування з сервера мають пріоритет над збереженими в браузері.
        const data = await source.fetch();
        const server = Object.fromEntries(SERVER_SETTING_KEYS.map((k) => [k, data.settings[k]]));
        settings = { ...settings, ...server };
        await storage.setSettings(settings);
        classroom = source.classroom();
        grades = source.grades();
      } catch (e) {
        preErrors.push(e instanceof Error ? e.message : String(e));
      }
    } else {
      preErrors.push(NOT_LOGGED_IN);
    }

    const state = await storage.getState();
    const result = await collectAndCheck({ classroom, grades, settings, state, now: new Date() });
    // «Не підключено» дублює головну причину — показуємо лише її.
    const errors = preErrors.length ? preErrors : result.errors;
    await storage.setState(result.state);
    await storage.setTimeline(result.timeline);
    await storage.setMeta({ lastRunAt: result.state.lastRunAt, errors });
    if (result.newAlerts.length > 0) {
      await storage.addAlerts(result.newAlerts);
      await showAlertNotifications(result.newAlerts);
    }
    return { ...result, errors };
  })().finally(() => {
    running = null;
  });
  return running;
}
