import type { Assignment, Grade, Submission } from '../core/types';
import type { ClassroomProvider, GradesProvider } from './types';

/**
 * Демо-сценарій тижня. Кожен крок — «наступний день», що додає події:
 * нове завдання → порожня здача → погана оцінка за це завдання.
 */
export const DEMO_STEPS = [
  'Початок тижня',
  'Понеділок: нове завдання з математики',
  'Вівторок: робота «здана» порожньою',
  'Середа: оцінка 5 у Єдиній школі',
] as const;

export const DEMO_LAST_STEP = DEMO_STEPS.length - 1;

const DAY = 24 * 60 * 60 * 1000;

function iso(now: Date, daysAgo: number, hour = 9): string {
  const d = new Date(now.getTime() - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function date(now: Date, daysAgo: number): string {
  const d = new Date(now.getTime() - daysAgo * DAY);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface DemoData {
  assignments: Assignment[];
  submissions: Submission[];
  grades: Grade[];
}

export function demoData(step: number, now: Date): DemoData {
  const assignments: Assignment[] = [
    {
      id: 'a-ukr',
      courseId: 'c-ukr',
      courseName: 'Українська мова 7-А',
      title: 'Вправа 245 (письмово)',
      createdAt: iso(now, 6),
      dueDate: date(now, 4),
    },
    {
      id: 'a-hist',
      courseId: 'c-hist',
      courseName: 'Історія України 7-А',
      title: 'Презентація «Козацька доба»',
      createdAt: iso(now, 5),
      dueDate: date(now, 3),
    },
    {
      id: 'a-eng',
      courseId: 'c-eng',
      courseName: 'Англійська мова 7-А',
      title: 'Workbook p. 34, ex. 1–4',
      createdAt: iso(now, 3),
      dueDate: date(now, -1),
    },
  ];
  const submissions: Submission[] = [
    {
      id: 's-ukr',
      assignmentId: 'a-ukr',
      courseId: 'c-ukr',
      state: 'RETURNED',
      updatedAt: iso(now, 5, 18),
      attachments: [
        {
          kind: 'driveFile',
          id: 'f1',
          title: 'Вправа 245.docx',
          mimeType: 'application/vnd.google-apps.document',
          textLength: 840,
        },
      ],
    },
    {
      id: 's-hist',
      assignmentId: 'a-hist',
      courseId: 'c-hist',
      state: 'TURNED_IN',
      updatedAt: iso(now, 4, 20),
      attachments: [
        {
          kind: 'driveFile',
          id: 'f2',
          title: 'Козацька доба',
          mimeType: 'application/vnd.google-apps.presentation',
          textLength: 1530,
        },
      ],
    },
    {
      id: 's-eng',
      assignmentId: 'a-eng',
      courseId: 'c-eng',
      state: 'CREATED',
      updatedAt: iso(now, 3),
      attachments: [],
    },
  ];
  const grades: Grade[] = [
    { id: 'g-ukr', subject: 'Українська мова', raw: '9', date: date(now, 4), workType: 'Домашнє завдання' },
    { id: 'g-hist', subject: 'Історія України', raw: '11', date: date(now, 2), workType: 'Проєкт' },
    { id: 'g-pe', subject: 'Фізична культура', raw: '10', date: date(now, 3) },
    { id: 'g-eng-abs', subject: 'Англійська мова', raw: 'н', date: date(now, 1) },
  ];

  if (step >= 1) {
    assignments.push({
      id: 'a-math',
      courseId: 'c-math',
      courseName: 'Математика 7-А',
      title: 'Задачі № 112–118',
      createdAt: iso(now, 2),
      dueDate: date(now, 1),
    });
    submissions.push({
      id: 's-math',
      assignmentId: 'a-math',
      courseId: 'c-math',
      state: step >= 2 ? 'TURNED_IN' : 'CREATED',
      updatedAt: step >= 2 ? iso(now, 1, 21) : iso(now, 2),
      attachments:
        step >= 2
          ? [
              {
                kind: 'driveFile',
                id: 'f3',
                title: 'Задачі 112-118',
                mimeType: 'application/vnd.google-apps.document',
                textLength: 0,
              },
            ]
          : [],
    });
  }
  if (step >= 2) {
    assignments.push({
      id: 'a-bio',
      courseId: 'c-bio',
      courseName: 'Біологія 7-А',
      title: 'Лабораторна робота № 3',
      createdAt: iso(now, 1),
      dueDate: date(now, -2),
    });
  }
  if (step >= 3) {
    grades.push({
      id: 'g-math',
      subject: 'Математика',
      raw: '5',
      date: date(now, 0),
      workType: 'Домашнє завдання',
      lessonTopic: 'Лінійні рівняння',
    });
    submissions.push({
      id: 's-bio',
      assignmentId: 'a-bio',
      courseId: 'c-bio',
      state: 'TURNED_IN',
      updatedAt: iso(now, 0, 8),
      attachments: [
        { kind: 'driveFile', id: 'f4', title: 'IMG_2041.jpg', mimeType: 'image/jpeg', sizeBytes: 245_000 },
      ],
    });
  }
  return { assignments, submissions, grades };
}

export function demoClassroom(step: number, now: Date): ClassroomProvider {
  return {
    async fetch() {
      const { assignments, submissions } = demoData(step, now);
      return { assignments, submissions };
    },
  };
}

export function demoGrades(step: number, now: Date): GradesProvider {
  return {
    async listGrades(from, to) {
      const f = from.getTime() - DAY;
      const t = to.getTime() + DAY;
      return demoData(step, now).grades.filter((g) => {
        const ms = Date.parse(g.date + 'T12:00:00');
        return ms >= f && ms <= t;
      });
    },
  };
}
