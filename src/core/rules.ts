import type { Attachment, Grade, Submission } from './types';

/**
 * Перетворює запис з журналу на число 1–12.
 * "н", "н/а", "зар." та інше нечислове повертає null.
 */
export function parseGrade(raw: string): number | null {
  const m = /^\s*(\d{1,2})(?:\s*[+-])?\s*$/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

export function isBadGrade(grade: Pick<Grade, 'raw'>, threshold: number): boolean {
  const n = parseGrade(grade.raw);
  return n !== null && n < threshold;
}

export function isTurnedIn(sub: Submission): boolean {
  return sub.state === 'TURNED_IN' || sub.state === 'RETURNED';
}

function isAttachmentEmpty(a: Attachment): boolean {
  if (a.kind !== 'driveFile') return false; // посилання, відео, форма — вважаємо змістом
  if (a.textLength === 0) return true;
  if (a.sizeBytes === 0) return true;
  return false;
}

/**
 * Повертає причину, якщо здана робота порожня, інакше null.
 * Незданих робіт це не стосується.
 */
export function emptySubmissionReason(sub: Submission): string | null {
  if (!isTurnedIn(sub)) return null;
  if (sub.shortAnswer?.trim()) return null;
  if (sub.multipleChoiceAnswer?.trim()) return null;
  if (sub.attachments.length === 0) {
    return 'Робота здана без жодного файлу чи відповіді';
  }
  if (sub.attachments.every(isAttachmentEmpty)) {
    const names = sub.attachments.map((a) => `«${a.title ?? 'файл'}»`).join(', ');
    return `Прикріплені файли порожні: ${names}`;
  }
  return null;
}

/** Нормалізація назв предметів/курсів для порівняння. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ʼ'’`]/g, '')
    // "5-А клас", "7б", "9 кл." — номер класу в назві курсу
    .replace(/\d+(?:\s*[-–]?\s*[а-яіїєґa-z](?![а-яіїєґa-z]))?(?:\s*(?:клас|кл)(?![а-яіїєґa-z])\.?)?/g, ' ')
    .replace(/[^a-zа-яіїєґ]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
