import type { RobotSnapshot } from '../core/snapshot';
import type { Grade } from '../core/types';
import { api, type RobotStatus, type ServerSettings } from '../platform/api';
import type { ClassroomData, ClassroomProvider, GradesProvider } from './types';

/** Якщо робот не оновлював дані довше — вважаємо їх застарілими. */
const STALE_HOURS = 26;

export interface WorkerData {
  snapshot: RobotSnapshot | null;
  settings: ServerSettings;
  robot: RobotStatus | null;
}

/**
 * Дані від хмарного робота, які лежать у Cloudflare Worker'і.
 * Завантажуються один раз на перевірку і віддаються обом джерелам.
 */
export class WorkerSource {
  private data: Promise<WorkerData> | null = null;

  constructor(
    private load: () => Promise<WorkerData> = api.snapshot,
    private now: () => Date = () => new Date(),
  ) {}

  fetch(): Promise<WorkerData> {
    this.data ??= this.load();
    return this.data;
  }

  private async snapshot(): Promise<RobotSnapshot> {
    const { snapshot } = await this.fetch();
    if (!snapshot) {
      throw new Error('Даних ще немає. Заповніть «Акаунти дитини» і натисніть «Перевірити зараз».');
    }
    const ageH = (this.now().getTime() - Date.parse(snapshot.generatedAt)) / 3_600_000;
    if (ageH > STALE_HOURS) {
      throw new Error(`Дані застарілі (остання перевірка ${Math.round(ageH)} год тому). Натисніть «Перевірити зараз» у налаштуваннях.`);
    }
    return snapshot;
  }

  classroom(): ClassroomProvider {
    return {
      fetch: async (): Promise<ClassroomData> => {
        const s = await this.snapshot();
        if (!s.classroom) throw new Error(s.errors.classroom ?? 'Google Клас не прочитано');
        return s.classroom;
      },
    };
  }

  grades(): GradesProvider {
    return {
      listGrades: async (from: Date, to: Date): Promise<Grade[]> => {
        const s = await this.snapshot();
        if (!s.grades) throw new Error(s.errors.eschool ?? 'Єдину школу не прочитано');
        const a = from.toISOString().slice(0, 10);
        const b = to.toISOString().slice(0, 10);
        return s.grades.filter((g) => g.date >= a && g.date <= b);
      },
    };
  }
}
