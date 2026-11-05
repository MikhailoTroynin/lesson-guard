import { decryptText, type Envelope, type RobotSnapshot } from '../core/snapshot';
import type { Grade } from '../core/types';
import type { ClassroomData, ClassroomProvider, GradesProvider } from './types';

/** Якщо робот не оновлював дані довше — вважаємо їх застарілими. */
const STALE_HOURS = 26;

export const DEFAULT_ROBOT_URL =
  process.env.EXPO_PUBLIC_ROBOT_URL ||
  'https://raw.githubusercontent.com/MikhailoTroynin/lesson-guard/robot-data/snapshot.json';

/**
 * Дані від хмарного робота: він сам заходить у Google Клас і Єдину школу
 * через браузер (Playwright) у GitHub Actions і викладає зашифрований знімок.
 * Один знімок завантажується один раз на перевірку і віддається обом джерелам.
 */
export class RobotSource {
  private snapshot: Promise<RobotSnapshot> | null = null;

  constructor(
    private url: string,
    private passphrase: string,
    private fetchFn: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
  ) {}

  load(): Promise<RobotSnapshot> {
    this.snapshot ??= (async () => {
      // raw.githubusercontent кешує файл ~5 хв; параметр обходить кеш застосунку.
      const sep = this.url.includes('?') ? '&' : '?';
      const res = await this.fetchFn(`${this.url}${sep}t=${this.now().getTime()}`);
      if (res.status === 404) {
        throw new Error('Робот ще не запускався (файл даних не знайдено). Запустіть workflow «Robot» у GitHub.');
      }
      if (!res.ok) throw new Error(`Не вдалося завантажити дані робота: HTTP ${res.status}`);
      const env = (await res.json()) as Envelope;
      const snap = JSON.parse(decryptText(env, this.passphrase)) as RobotSnapshot;
      const ageH = (this.now().getTime() - Date.parse(snap.generatedAt)) / 3_600_000;
      if (ageH > STALE_HOURS) {
        throw new Error(
          `Дані робота застарілі (останній запуск ${Math.round(ageH)} год тому). Перевірте вкладку Actions у GitHub.`,
        );
      }
      return snap;
    })();
    return this.snapshot;
  }

  classroom(): ClassroomProvider {
    return {
      fetch: async (): Promise<ClassroomData> => {
        const s = await this.load();
        if (!s.classroom) throw new Error(s.errors.classroom ?? 'робот не зміг прочитати Google Клас');
        return s.classroom;
      },
    };
  }

  grades(): GradesProvider {
    return {
      listGrades: async (from: Date, to: Date): Promise<Grade[]> => {
        const s = await this.load();
        if (!s.grades) throw new Error(s.errors.eschool ?? 'робот не зміг прочитати Єдину школу');
        const a = from.toISOString().slice(0, 10);
        const b = to.toISOString().slice(0, 10);
        return s.grades.filter((g) => g.date >= a && g.date <= b);
      },
    };
  }
}
