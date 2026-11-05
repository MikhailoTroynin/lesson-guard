import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, EMPTY_STATE } from '../core/types';
import { demoClassroom, demoGrades } from '../providers/demo';
import { collectAndCheck } from './collect';

const now = new Date('2026-11-05T12:00:00');

describe('collectAndCheck', () => {
  it('keeps going when grades source fails', async () => {
    const r = await collectAndCheck({
      classroom: demoClassroom(3, now),
      grades: { listGrades: async () => Promise.reject(new Error('timeout')) },
      settings: DEFAULT_SETTINGS,
      state: EMPTY_STATE,
      now,
    });
    expect(r.errors).toEqual(['Єдина школа: timeout']);
    expect(r.timeline.length).toBeGreaterThan(0);
  });

  it('does not forget known assignments when Classroom fails', async () => {
    const seeded = await collectAndCheck({
      classroom: demoClassroom(0, now),
      grades: demoGrades(0, now),
      settings: DEFAULT_SETTINGS,
      state: EMPTY_STATE,
      now,
    });
    const failed = await collectAndCheck({
      classroom: { fetch: async () => Promise.reject(new Error('401')) },
      grades: demoGrades(0, now),
      settings: DEFAULT_SETTINGS,
      state: seeded.state,
      now,
    });
    expect(failed.state.knownAssignmentIds).toEqual(seeded.state.knownAssignmentIds);
    const after = await collectAndCheck({
      classroom: demoClassroom(0, now),
      grades: demoGrades(0, now),
      settings: DEFAULT_SETTINGS,
      state: failed.state,
      now,
    });
    expect(after.newAlerts).toEqual([]);
  });
});
