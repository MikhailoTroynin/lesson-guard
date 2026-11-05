import { describe, expect, it } from 'vitest';

import { matchGradeToAssignment, subjectForCourse } from './matcher';
import type { Assignment, Grade } from './types';

const subjects = ['Українська мова', 'Українська література', 'Математика', 'Алгебра'];

describe('subjectForCourse', () => {
  it('prefers manual mapping', () => {
    expect(subjectForCourse('c1', 'Мова', subjects, { c1: 'Українська мова' })).toBe('Українська мова');
  });
  it('matches by name ignoring class number', () => {
    expect(subjectForCourse('c', 'Математика 7-А', subjects, {})).toBe('Математика');
    expect(subjectForCourse('c', 'Українська література 7-А', subjects, {})).toBe('Українська література');
  });
  it('returns null when nothing matches', () => {
    expect(subjectForCourse('c', 'Хімія', subjects, {})).toBeNull();
  });
});

describe('matchGradeToAssignment', () => {
  const settings = { subjectMap: {}, matchWindowDays: 14 };
  const a = (id: string, createdAt: string, courseName = 'Математика 7-А'): Assignment => ({
    id,
    courseId: 'c-' + courseName,
    courseName,
    title: id,
    createdAt,
  });
  const grade: Grade = { id: 'g', subject: 'Математика', raw: '5', date: '2026-11-05' };

  it('picks the closest earlier assignment of the same subject', () => {
    const list = [
      a('old', '2026-10-27T09:00:00Z'),
      a('monday', '2026-11-03T09:00:00Z'),
      a('future', '2026-11-06T09:00:00Z'),
      a('other', '2026-11-04T09:00:00Z', 'Алгебра'),
    ];
    expect(matchGradeToAssignment(grade, list, subjects, settings)?.id).toBe('monday');
  });
  it('respects the window', () => {
    expect(matchGradeToAssignment(grade, [a('old', '2026-10-01T09:00:00Z')], subjects, settings)).toBeNull();
  });
});
