import { describe, expect, it } from 'vitest';

import { emptySubmissionReason, isBadGrade, normalizeName, parseGrade } from './rules';
import type { Submission } from './types';

const base: Submission = {
  id: 's',
  assignmentId: 'a',
  courseId: 'c',
  state: 'TURNED_IN',
  updatedAt: '2026-11-03T10:00:00Z',
  attachments: [],
};

describe('parseGrade', () => {
  it('parses 12-point grades', () => {
    expect(parseGrade('10')).toBe(10);
    expect(parseGrade(' 7+ ')).toBe(7);
    expect(parseGrade('12')).toBe(12);
  });
  it('returns null for non-numeric marks', () => {
    expect(parseGrade('н')).toBeNull();
    expect(parseGrade('зар.')).toBeNull();
    expect(parseGrade('13')).toBeNull();
    expect(parseGrade('0')).toBeNull();
  });
});

describe('isBadGrade', () => {
  it('uses strict threshold', () => {
    expect(isBadGrade({ raw: '6' }, 7)).toBe(true);
    expect(isBadGrade({ raw: '7' }, 7)).toBe(false);
    expect(isBadGrade({ raw: 'н' }, 7)).toBe(false);
  });
});

describe('emptySubmissionReason', () => {
  it('ignores work that is not turned in', () => {
    expect(emptySubmissionReason({ ...base, state: 'CREATED' })).toBeNull();
  });
  it('flags turned-in work without anything attached', () => {
    expect(emptySubmissionReason(base)).toMatch(/без жодного/);
  });
  it('accepts a short answer', () => {
    expect(emptySubmissionReason({ ...base, shortAnswer: '42' })).toBeNull();
    expect(emptySubmissionReason({ ...base, shortAnswer: '   ' })).not.toBeNull();
  });
  it('flags empty Google Docs and zero-size files', () => {
    expect(
      emptySubmissionReason({
        ...base,
        attachments: [
          { kind: 'driveFile', title: 'Doc', textLength: 0 },
          { kind: 'driveFile', title: 'photo.jpg', sizeBytes: 0 },
        ],
      }),
    ).toMatch(/«Doc», «photo.jpg»/);
  });
  it('does not flag when one file has content or content is unknown', () => {
    expect(
      emptySubmissionReason({
        ...base,
        attachments: [
          { kind: 'driveFile', textLength: 0 },
          { kind: 'driveFile', textLength: 12 },
        ],
      }),
    ).toBeNull();
    expect(emptySubmissionReason({ ...base, attachments: [{ kind: 'driveFile', textLength: null }] })).toBeNull();
    expect(emptySubmissionReason({ ...base, attachments: [{ kind: 'link', url: 'https://x' }] })).toBeNull();
  });
});

describe('normalizeName', () => {
  it('strips class numbers without eating words', () => {
    expect(normalizeName('Математика 7-А')).toBe('математика');
    expect(normalizeName('5-Б клас Українська мова')).toBe('українська мова');
    expect(normalizeName('Історія 9 України')).toBe('історія україни');
    expect(normalizeName('Англійська мова 7б')).toBe('англійська мова');
  });
});
