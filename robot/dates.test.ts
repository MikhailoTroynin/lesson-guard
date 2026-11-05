import { describe, expect, it } from 'vitest';

import { findDueDate, findPostedDate, parseHumanDate } from './dates';

const now = new Date('2026-11-05T10:00:00Z');

describe('parseHumanDate', () => {
  it.each([
    ['3 лист.', '2026-11-03'],
    ['3 листопада 2025 р.', '2025-11-03'],
    ['Nov 3', '2026-11-03'],
    ['Nov 3, 2025', '2025-11-03'],
    ['Сьогодні', '2026-11-05'],
    ['Yesterday, 10:15', '2026-11-04'],
    ['10:15', '2026-11-05'],
    ['20 груд.', '2026-12-20'],
    ['1 вер.', '2026-09-01'],
  ])('%s → %s', (input, out) => {
    expect(parseHumanDate(input, now)).toBe(out);
  });

  it('puts far-future months into last year', () => {
    expect(parseHumanDate('3 лист.', new Date('2027-02-10T10:00:00Z'))).toBe('2026-11-03');
  });

  it('returns undefined for garbage', () => {
    expect(parseHumanDate('Без терміну', now)).toBeUndefined();
  });
});

describe('page text', () => {
  it('finds posted and due dates', () => {
    const text = 'Задачі № 112–118\nОльга Петрівна • Опубліковано: 3 лист.\nТермін: 5 лист., 23:59\n100 балів';
    expect(findPostedDate(text, now)).toBe('2026-11-03');
    expect(findDueDate(text, now)).toBe('2026-11-05');
  });

  it('handles English and no due date', () => {
    expect(findPostedDate('Mr. Smith • Posted Nov 2', now)).toBe('2026-11-02');
    expect(findDueDate('No due date', now)).toBeUndefined();
    expect(findDueDate('Due Nov 7, 11:59 PM', now)).toBe('2026-11-07');
  });
});
