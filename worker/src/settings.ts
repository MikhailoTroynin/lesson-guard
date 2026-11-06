/** Загальні налаштування (таблиця app_settings, JSON-значення). */

export interface AppSettings {
  /** Оцінка нижче цього числа — погана (12-бальна шкала). */
  badGradeThreshold: number;
  notifyNewAssignments: boolean;
  /** id курсу Google Класу → назва предмета в Єдиній школі. */
  subjectMap: Record<string, string>;
  matchWindowDays: number;
  gradeLookbackDays: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  badGradeThreshold: 7,
  notifyNewAssignments: true,
  subjectMap: {},
  matchWindowDays: 14,
  gradeLookbackDays: 7,
};

export interface RobotStatus {
  generatedAt: string;
  receivedAt: string;
  errors: { classroom?: string; eschool?: string };
  counts: { assignments: number; submissions: number; grades: number };
}

export async function getJson<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setJson(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value))
    .run();
}

export async function getSettings(db: D1Database): Promise<AppSettings> {
  return { ...DEFAULT_APP_SETTINGS, ...((await getJson<Partial<AppSettings>>(db, 'settings')) ?? {}) };
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Перевіряє часткове оновлення. Повертає текст помилки або нові налаштування. */
export function validateSettingsPatch(cur: AppSettings, patch: unknown): AppSettings | string {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'очікується об\'єкт';
  const p = patch as Record<string, unknown>;
  const next: AppSettings = { ...cur, subjectMap: { ...cur.subjectMap } };
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case 'badGradeThreshold':
        if (!isInt(v, 2, 12)) return 'badGradeThreshold: ціле 2–12';
        next.badGradeThreshold = v;
        break;
      case 'notifyNewAssignments':
        if (typeof v !== 'boolean') return 'notifyNewAssignments: true/false';
        next.notifyNewAssignments = v;
        break;
      case 'matchWindowDays':
        if (!isInt(v, 1, 60)) return 'matchWindowDays: ціле 1–60';
        next.matchWindowDays = v;
        break;
      case 'gradeLookbackDays':
        if (!isInt(v, 1, 60)) return 'gradeLookbackDays: ціле 1–60';
        next.gradeLookbackDays = v;
        break;
      case 'subjectMap': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return 'subjectMap: об\'єкт';
        const entries = Object.entries(v as Record<string, unknown>);
        if (entries.length > 200) return 'subjectMap: забагато записів';
        const map: Record<string, string> = {};
        for (const [course, subject] of entries) {
          if (course.length > 100 || typeof subject !== 'string' || subject.length > 100) return 'subjectMap: некоректний запис';
          if (subject.trim()) map[course] = subject.trim();
        }
        next.subjectMap = map;
        break;
      }
      default:
        return `невідоме поле ${k}`;
    }
  }
  return next;
}
