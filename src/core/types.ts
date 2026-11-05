/** Завдання з Google Класу (courseWork). */
export interface Assignment {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  /** ISO-час, коли вчитель опублікував завдання. */
  createdAt: string;
  /** Дата здачі YYYY-MM-DD, якщо вказана. */
  dueDate?: string;
  link?: string;
}

export type SubmissionState =
  | 'NEW'
  | 'CREATED'
  | 'TURNED_IN'
  | 'RETURNED'
  | 'RECLAIMED_BY_STUDENT';

export type AttachmentKind = 'driveFile' | 'link' | 'youtube' | 'form';

export interface Attachment {
  kind: AttachmentKind;
  id?: string;
  title?: string;
  url?: string;
  mimeType?: string;
  /**
   * Кількість значущих символів у Google Docs/Slides/Sheets.
   * `null`/`undefined` — невідомо (не вдалося прочитати), такий файл не вважається порожнім.
   */
  textLength?: number | null;
  /** Розмір звичайного файлу в байтах. */
  sizeBytes?: number | null;
  /** У документі/презентації є картинки (наприклад, фото зошита) — це зміст, навіть без тексту. */
  hasImages?: boolean;
}

/** Здана (або ні) робота дитини за завданням. */
export interface Submission {
  id: string;
  assignmentId: string;
  courseId: string;
  state: SubmissionState;
  /** ISO-час останньої зміни. */
  updatedAt: string;
  attachments: Attachment[];
  shortAnswer?: string;
  multipleChoiceAnswer?: string;
  late?: boolean;
}

/** Оцінка з «Єдиної школи». */
export interface Grade {
  id: string;
  subject: string;
  /** Як оцінка записана в журналі: "10", "н", "зар." тощо. */
  raw: string;
  /** Дата уроку YYYY-MM-DD. */
  date: string;
  lessonTopic?: string;
  workType?: string;
  comment?: string;
}

export type AlertKind = 'new_assignment' | 'bad_grade' | 'empty_submission';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  /** Стабільний id — по ньому не надсилаємо той самий алерт двічі. */
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
  createdAt: string;
  assignmentId?: string;
  gradeId?: string;
  read?: boolean;
}

export interface Settings {
  /** Оцінка нижче цього числа вважається поганою (12-бальна шкала). */
  badGradeThreshold: number;
  /** Ручна відповідність: id курсу Google Класу → назва предмета в Єдиній школі. */
  subjectMap: Record<string, string>;
  /** Скільки днів після видачі завдання оцінку ще можна до нього прив'язати. */
  matchWindowDays: number;
  /** Алерти про старі оцінки не надсилаються (днів). */
  gradeLookbackDays: number;
  notifyNewAssignments: boolean;
  /** Демо-режим: мок-дані замість реальних сервісів. */
  demoMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  badGradeThreshold: 7,
  subjectMap: {},
  matchWindowDays: 14,
  gradeLookbackDays: 7,
  notifyNewAssignments: true,
  demoMode: true,
};

/** Що вже бачили на попередніх перевірках. */
export interface CheckState {
  knownAssignmentIds: string[];
  alertedIds: string[];
  lastRunAt?: string;
}

export const EMPTY_STATE: CheckState = { knownAssignmentIds: [], alertedIds: [] };

export type SubmissionStatus = 'not_submitted' | 'submitted' | 'empty' | 'returned';

/** Рядок стрічки на головному екрані: завдання + здача + оцінки. */
export interface TimelineItem {
  assignment: Assignment;
  submission?: Submission;
  submissionStatus: SubmissionStatus;
  emptyReason?: string;
  grades: (Grade & { numeric: number | null; bad: boolean })[];
}
