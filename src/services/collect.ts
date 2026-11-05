import { runCheck, type CheckResult } from '../core/checker';
import type { CheckState, Grade, Settings } from '../core/types';
import type { ClassroomData, ClassroomProvider, GradesProvider } from '../providers/types';

const DAY = 24 * 60 * 60 * 1000;
/** За який період брати оцінки — з запасом на вікно зіставлення із завданнями. */
const GRADES_PERIOD_DAYS = 30;

export interface CollectInput {
  classroom: ClassroomProvider | null;
  grades: GradesProvider | null;
  settings: Settings;
  state: CheckState;
  now: Date;
}

export interface CollectResult extends CheckResult {
  errors: string[];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Збирає дані з обох джерел і запускає перевірку.
 * Збій одного джерела не зупиняє інше — помилки повертаються окремо.
 */
export async function collectAndCheck(input: CollectInput): Promise<CollectResult> {
  const errors: string[] = [];
  let classroom: ClassroomData = { assignments: [], submissions: [] };
  let grades: Grade[] = [];

  if (input.classroom) {
    try {
      classroom = await input.classroom.fetch();
    } catch (e) {
      errors.push(`Google Клас: ${message(e)}`);
    }
  } else {
    errors.push('Google Клас не підключено.');
  }

  if (input.grades) {
    try {
      grades = await input.grades.listGrades(
        new Date(input.now.getTime() - GRADES_PERIOD_DAYS * DAY),
        input.now,
      );
    } catch (e) {
      errors.push(`Єдина школа: ${message(e)}`);
    }
  } else {
    errors.push('Єдину школу не підключено.');
  }

  // Якщо Google Клас не відповів, не оновлюємо список відомих завдань,
  // інакше після відновлення всі завдання здадуться «новими».
  const classroomFailed = errors.some((e) => e.startsWith('Google Клас'));
  const result = runCheck({ ...classroom, grades, settings: input.settings, state: input.state, now: input.now });
  if (classroomFailed) {
    result.state = { ...result.state, knownAssignmentIds: input.state.knownAssignmentIds };
    if (!input.state.lastRunAt) result.state = { ...result.state, lastRunAt: undefined };
  }
  return { ...result, errors };
}
