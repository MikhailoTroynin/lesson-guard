import { formatDay } from './format';
import { dayMs, matchGradeToAssignment } from './matcher';
import { emptySubmissionReason, isBadGrade, parseGrade } from './rules';
import type {
  Alert,
  Assignment,
  CheckState,
  Grade,
  Settings,
  Submission,
  SubmissionStatus,
  TimelineItem,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_LOOKBACK_DAYS = 30;
const MAX_REMEMBERED_IDS = 3000;

export interface CheckInput {
  assignments: Assignment[];
  submissions: Submission[];
  grades: Grade[];
  settings: Settings;
  state: CheckState;
  now: Date;
}

export interface CheckResult {
  /** Алерти, яких ще не надсилали. */
  newAlerts: Alert[];
  state: CheckState;
  timeline: TimelineItem[];
}

function submissionStatus(sub: Submission | undefined): {
  status: SubmissionStatus;
  emptyReason?: string;
} {
  if (!sub) return { status: 'not_submitted' };
  const emptyReason = emptySubmissionReason(sub);
  if (emptyReason) return { status: 'empty', emptyReason };
  if (sub.state === 'RETURNED') return { status: 'returned' };
  if (sub.state === 'TURNED_IN') return { status: 'submitted' };
  return { status: 'not_submitted' };
}

/**
 * Одна перевірка: порівнює свіжі дані з попереднім станом і повертає нові алерти.
 * Чиста функція — усе мережеве й платформне живе поза нею.
 */
export function runCheck(input: CheckInput): CheckResult {
  const { assignments, submissions, grades, settings, state, now } = input;
  const nowIso = now.toISOString();
  const firstRun = !state.lastRunAt;
  const alerted = new Set(state.alertedIds);
  const known = new Set(state.knownAssignmentIds);
  const knownSubjects = [...new Set(grades.map((g) => g.subject))];
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const subByAssignment = new Map(submissions.map((s) => [s.assignmentId, s]));
  const candidates: Alert[] = [];

  // 1. Нові завдання. На першому запуску лише запам'ятовуємо, щоб не засипати батьків старими.
  if (!firstRun && settings.notifyNewAssignments) {
    for (const a of assignments) {
      if (known.has(a.id)) continue;
      const due = a.dueDate ? ` Здати до ${formatDay(a.dueDate)}.` : '';
      candidates.push({
        id: `new:${a.id}`,
        kind: 'new_assignment',
        severity: 'info',
        title: `Нове завдання: ${a.courseName}`,
        body: `«${a.title}» (видано ${formatDay(a.createdAt)}).${due}`,
        createdAt: nowIso,
        assignmentId: a.id,
      });
    }
  }

  // 2. Погані оцінки з Єдиної школи.
  const gradeToAssignment = new Map<string, Assignment | null>();
  for (const g of grades) {
    gradeToAssignment.set(g.id, matchGradeToAssignment(g, assignments, knownSubjects, settings));
  }
  const gradeCutoff = now.getTime() - settings.gradeLookbackDays * DAY_MS;
  for (const g of grades) {
    if (!isBadGrade(g, settings.badGradeThreshold)) continue;
    if (dayMs(g.date) < gradeCutoff) continue;
    const a = gradeToAssignment.get(g.id);
    const link = a
      ? ` Ймовірно за завдання «${a.title}» з Google Класу (видано ${formatDay(a.createdAt)}).`
      : '';
    const topic = g.lessonTopic ? ` Тема: ${g.lessonTopic}.` : '';
    candidates.push({
      id: `grade:${g.id}`,
      kind: 'bad_grade',
      severity: 'critical',
      title: `Погана оцінка: ${g.subject} — ${g.raw}`,
      body: `Оцінка ${g.raw} від ${formatDay(g.date)}.${topic}${link}`,
      createdAt: nowIso,
      gradeId: g.id,
      assignmentId: a?.id,
    });
  }

  // 3. Порожні здані роботи.
  const emptyCutoff = now.getTime() - EMPTY_LOOKBACK_DAYS * DAY_MS;
  for (const s of submissions) {
    const reason = emptySubmissionReason(s);
    if (!reason) continue;
    if (Date.parse(s.updatedAt) < emptyCutoff) continue;
    const a = byId.get(s.assignmentId);
    candidates.push({
      id: `empty:${s.id}`,
      kind: 'empty_submission',
      severity: 'warning',
      title: `Порожня здача: ${a?.courseName ?? 'Google Клас'}`,
      body: `«${a?.title ?? 'Завдання'}» позначено зданим, але ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`,
      createdAt: nowIso,
      assignmentId: s.assignmentId,
    });
  }

  const newAlerts = candidates.filter((c) => !alerted.has(c.id));
  for (const c of newAlerts) alerted.add(c.id);

  // Стрічка для головного екрана.
  const gradesByAssignment = new Map<string, Grade[]>();
  for (const g of grades) {
    const a = gradeToAssignment.get(g.id);
    if (!a) continue;
    const list = gradesByAssignment.get(a.id) ?? [];
    list.push(g);
    gradesByAssignment.set(a.id, list);
  }
  const timeline: TimelineItem[] = [...assignments]
    .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))
    .map((a) => {
      const submission = subByAssignment.get(a.id);
      const { status, emptyReason } = submissionStatus(submission);
      return {
        assignment: a,
        submission,
        submissionStatus: status,
        emptyReason,
        grades: (gradesByAssignment.get(a.id) ?? []).map((g) => ({
          ...g,
          numeric: parseGrade(g.raw),
          bad: isBadGrade(g, settings.badGradeThreshold),
        })),
      };
    });

  const knownIds = [...new Set([...state.knownAssignmentIds, ...assignments.map((a) => a.id)])];
  return {
    newAlerts,
    timeline,
    state: {
      knownAssignmentIds: knownIds.slice(-MAX_REMEMBERED_IDS),
      alertedIds: [...alerted].slice(-MAX_REMEMBERED_IDS),
      lastRunAt: nowIso,
    },
  };
}
