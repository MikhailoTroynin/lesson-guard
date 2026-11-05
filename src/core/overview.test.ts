import { describe, expect, it } from 'vitest';

import { chainFor, groupByDay, summarize } from './overview';
import type { Alert, TimelineItem } from './types';

const item = (over: Partial<TimelineItem>): TimelineItem => ({
  assignment: { id: 'a', courseId: 'c', courseName: 'Математика 7-А', title: 'Задачі', createdAt: '2026-11-02T09:00:00Z' },
  submissionStatus: 'not_submitted',
  grades: [],
  ...over,
});

const grade = (raw: string, bad: boolean) => ({
  id: 'g' + raw,
  subject: 'Математика',
  raw,
  date: '2026-11-04',
  numeric: Number(raw),
  bad,
});

describe('summarize', () => {
  it('shows the worst bad grade on the coin', () => {
    const s = summarize([item({ grades: [grade('5', true), grade('3', true)] }), item({ submissionStatus: 'empty' })], []);
    expect(s.hero).toEqual({ text: '3', tone: 'bad' });
    expect(s.badCount).toBe(2);
    expect(s.emptyCount).toBe(1);
    expect(s.attention).toBe(3);
  });

  it('falls back to ∅ for an empty submission and ✓ when nothing happened', () => {
    expect(summarize([item({ submissionStatus: 'empty' })], []).hero.tone).toBe('empty');
    expect(summarize([item({})], []).hero).toEqual({ text: '✓', tone: 'ok' });
  });

  it('counts only unread new-assignment alerts', () => {
    const alerts = [
      { id: '1', kind: 'new_assignment', read: false },
      { id: '2', kind: 'new_assignment', read: true },
      { id: '3', kind: 'bad_grade' },
    ] as Alert[];
    expect(summarize([], alerts).newCount).toBe(1);
  });
});

describe('groupByDay', () => {
  it('labels today and yesterday', () => {
    const now = new Date('2026-11-05T15:00:00');
    const alerts = [
      { id: '1', createdAt: new Date('2026-11-05T10:00:00').toISOString() },
      { id: '2', createdAt: new Date('2026-11-04T10:00:00').toISOString() },
    ] as Alert[];
    expect(groupByDay(alerts, now).map((g) => g.label)).toEqual(['Сьогодні', 'Учора']);
  });
});

describe('chainFor', () => {
  it('builds issued → submitted → grade steps', () => {
    const steps = chainFor(item({ submissionStatus: 'empty', emptyReason: 'Документ порожній', grades: [grade('5', true)] }));
    expect(steps.map((s) => s.tone)).toEqual(['issued', 'empty', 'bad']);
    expect(steps[1].note).toBe('Документ порожній.');
  });
});
