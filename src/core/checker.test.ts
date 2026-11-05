import { describe, expect, it } from 'vitest';

import { DEMO_LAST_STEP, demoData } from '../providers/demo';
import { runCheck } from './checker';
import { DEFAULT_SETTINGS, EMPTY_STATE, type CheckState } from './types';

const now = new Date('2026-11-05T12:00:00');

function check(step: number, state: CheckState) {
  return runCheck({ ...demoData(step, now), settings: DEFAULT_SETTINGS, state, now });
}

describe('runCheck on the demo week', () => {
  it('first run only seeds known assignments', () => {
    const r = check(0, EMPTY_STATE);
    expect(r.newAlerts).toEqual([]);
    expect(r.state.knownAssignmentIds).toHaveLength(3);
    expect(r.timeline).toHaveLength(3);
  });

  it('walks Monday → Tuesday → Wednesday', () => {
    let state = check(0, EMPTY_STATE).state;

    const mon = check(1, state);
    expect(mon.newAlerts.map((a) => a.id)).toEqual(['new:a-math']);
    state = mon.state;

    const tue = check(2, state);
    expect(tue.newAlerts.map((a) => a.id).sort()).toEqual(['empty:s-math', 'new:a-bio']);
    state = tue.state;

    const wed = check(DEMO_LAST_STEP, state);
    expect(wed.newAlerts.map((a) => a.id)).toEqual(['grade:g-math']);
    const alert = wed.newAlerts[0];
    expect(alert.severity).toBe('critical');
    expect(alert.assignmentId).toBe('a-math');
    expect(alert.body).toContain('Задачі № 112–118');

    const math = wed.timeline.find((t) => t.assignment.id === 'a-math');
    expect(math?.submissionStatus).toBe('empty');
    expect(math?.grades.map((g) => [g.raw, g.bad])).toEqual([['5', true]]);
  });

  it('does not repeat alerts', () => {
    let state = check(0, EMPTY_STATE).state;
    state = check(DEMO_LAST_STEP, state).state;
    expect(check(DEMO_LAST_STEP, state).newAlerts).toEqual([]);
  });

  it('skips new-assignment alerts when disabled', () => {
    const state = check(0, EMPTY_STATE).state;
    const r = runCheck({
      ...demoData(1, now),
      settings: { ...DEFAULT_SETTINGS, notifyNewAssignments: false },
      state,
      now,
    });
    expect(r.newAlerts).toEqual([]);
  });

  it('honours a custom threshold', () => {
    const state = check(0, EMPTY_STATE).state;
    const r = runCheck({
      ...demoData(0, now),
      settings: { ...DEFAULT_SETTINGS, badGradeThreshold: 11 },
      state,
      now,
    });
    expect(r.newAlerts.map((a) => a.id).sort()).toEqual(['grade:g-pe', 'grade:g-ukr']);
  });
});
