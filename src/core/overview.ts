import { formatDay } from './format';
import type { Alert, AlertKind, TimelineItem } from './types';

/** Що показує монета над щоденником. */
export type CoinTone = 'bad' | 'good' | 'empty' | 'ok' | 'pending';
export interface CoinFace {
  text: string;
  tone: CoinTone;
}

export interface OverviewSummary {
  newCount: number;
  emptyCount: number;
  badCount: number;
  attention: number;
  hero: CoinFace;
}

const DAY = 24 * 60 * 60 * 1000;

function toDate(isoOrDay: string): Date {
  return new Date(isoOrDay.length === 10 ? isoOrDay + 'T12:00:00' : isoOrDay);
}

export function summarize(timeline: TimelineItem[], alerts: Alert[]): OverviewSummary {
  const emptyCount = timeline.filter((t) => t.submissionStatus === 'empty').length;
  const grades = timeline.flatMap((t) => t.grades);
  const badCount = grades.filter((g) => g.bad).length;
  const newCount = alerts.filter((a) => a.kind === 'new_assignment' && !a.read).length;

  const worst = grades
    .filter((g) => g.bad)
    .sort((a, b) => (a.numeric ?? 0) - (b.numeric ?? 0))[0];
  const latest = [...grades]
    .filter((g) => g.numeric !== null)
    .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime())[0];

  let hero: CoinFace;
  if (worst) hero = { text: worst.raw, tone: 'bad' };
  else if (emptyCount) hero = { text: '∅', tone: 'empty' };
  else if (latest) hero = { text: latest.raw, tone: latest.bad ? 'bad' : 'good' };
  else hero = { text: '✓', tone: 'ok' };

  return { newCount, emptyCount, badCount, attention: emptyCount + badCount, hero };
}

/** Монета для конкретного завдання (панель деталей). */
export function coinForItem(item: TimelineItem): CoinFace {
  const g = item.grades[0];
  if (g) return { text: g.raw, tone: g.bad ? 'bad' : 'good' };
  if (item.submissionStatus === 'empty') return { text: '∅', tone: 'empty' };
  return { text: '·', tone: 'pending' };
}

export type AlertFilter = 'all' | 'bad' | 'empty' | 'new';
export const FILTER_KIND: Record<AlertFilter, AlertKind | null> = {
  all: null,
  bad: 'bad_grade',
  empty: 'empty_submission',
  new: 'new_assignment',
};

/** Групує сповіщення за днями: «Сьогодні», «Учора», далі дата. */
export function groupByDay(alerts: Alert[], now = new Date()): { label: string; items: Alert[] }[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const groups: { label: string; items: Alert[] }[] = [];
  for (const a of alerts) {
    const d = new Date(a.createdAt);
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / DAY);
    const label = diff <= 0 ? 'Сьогодні' : diff === 1 ? 'Учора' : formatDay(a.createdAt);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(a);
  }
  return groups;
}

export type StepTone = 'issued' | 'todo' | 'bad' | 'good' | 'empty';
export interface ChainStep {
  label: string;
  when: string;
  value: string;
  note: string;
  tone: StepTone;
}

/** Ланцюжок «видано → здано → оцінка» для панелі деталей. */
export function chainFor(item: TimelineItem): ChainStep[] {
  const { assignment: a, submission: s, submissionStatus: st } = item;
  const files = (s?.attachments ?? []).map((x) => x.title).filter(Boolean).join(', ');
  const steps: ChainStep[] = [
    {
      label: 'Видано',
      when: formatDay(a.createdAt),
      value: 'Вчитель опублікував завдання',
      note: a.dueDate ? `Термін здачі: ${formatDay(a.dueDate)}.` : '',
      tone: 'issued',
    },
  ];
  if (st === 'not_submitted') {
    steps.push({
      label: 'Здача',
      when: a.dueDate ? `до ${formatDay(a.dueDate)}` : 'очікується',
      value: 'Ще не здано',
      note: 'Робота в статусі «Призначено».',
      tone: 'todo',
    });
  } else {
    steps.push({
      label: 'Здача',
      when: s ? formatDay(s.updatedAt) : '',
      value: st === 'empty' ? 'Здано порожнім' : st === 'returned' ? 'Здано й перевірено' : 'Здано',
      note:
        st === 'empty'
          ? (item.emptyReason ?? 'Робота порожня').replace(/\.?$/, '.')
          : files
            ? `Вкладення: «${files}».`
            : s?.shortAnswer
              ? 'Відповідь текстом.'
              : '',
      tone: st === 'empty' ? 'empty' : 'good',
    });
  }
  if (item.grades.length) {
    for (const g of item.grades) {
      const days = Math.max(0, Math.round((toDate(g.date).getTime() - toDate(a.createdAt).getTime()) / DAY));
      steps.push({
        label: 'Оцінка · Єдина школа',
        when: formatDay(g.date),
        value: `${g.raw} з 12${g.bad ? ' — нижче порогу' : ''}`,
        note:
          `Прив’язано до цього завдання: той самий предмет, видано за ${days} дн. до оцінки.` +
          (g.lessonTopic ? ` Тема: ${g.lessonTopic.toLowerCase()}.` : ''),
        tone: g.bad ? 'bad' : 'good',
      });
    }
  } else {
    steps.push({
      label: 'Оцінка',
      when: 'очікується',
      value: 'Оцінки ще немає',
      note: 'З’явиться після уроку з цього предмета.',
      tone: 'todo',
    });
  }
  return steps;
}
