import { normalizeName } from './rules';
import type { Assignment, Grade, Settings } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Дата YYYY-MM-DD → мілісекунди (опівніч UTC). */
export function dayMs(date: string): number {
  return Date.parse(date.slice(0, 10) + 'T00:00:00Z');
}

/**
 * Назва предмета в Єдиній школі для курсу Google Класу.
 * Спершу ручна відповідність з налаштувань, потім пошук за назвою.
 */
export function subjectForCourse(
  courseId: string,
  courseName: string,
  knownSubjects: string[],
  subjectMap: Settings['subjectMap'],
): string | null {
  const manual = subjectMap[courseId]?.trim();
  if (manual) return manual;
  const course = normalizeName(courseName);
  if (!course) return null;
  // Довші назви першими: «українська література» не має збігтися з «українська мова».
  const sorted = [...knownSubjects].sort((a, b) => b.length - a.length);
  for (const subject of sorted) {
    const s = normalizeName(subject);
    if (s && (course.includes(s) || s.includes(course))) return subject;
  }
  return null;
}

/**
 * Знаходить завдання, до якого найімовірніше належить оцінка:
 * той самий предмет, видане не пізніше дня оцінки і не раніше ніж за `matchWindowDays`.
 * Обирається найближче за часом.
 */
export function matchGradeToAssignment(
  grade: Grade,
  assignments: Assignment[],
  knownSubjects: string[],
  settings: Pick<Settings, 'subjectMap' | 'matchWindowDays'>,
): Assignment | null {
  const gradeDay = dayMs(grade.date);
  const gradeSubject = normalizeName(grade.subject);
  let best: Assignment | null = null;
  let bestDiff = Infinity;
  for (const a of assignments) {
    const subject = subjectForCourse(a.courseId, a.courseName, knownSubjects, settings.subjectMap);
    if (!subject || normalizeName(subject) !== gradeSubject) continue;
    const diff = gradeDay - dayMs(a.createdAt);
    if (diff < 0 || diff > settings.matchWindowDays * DAY_MS) continue;
    if (diff < bestDiff) {
      best = a;
      bestDiff = diff;
    }
  }
  return best;
}
