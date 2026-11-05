import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { encryptText, type RobotSnapshot } from '../core/snapshot';
import { RobotSource } from './robot';

const now = new Date('2026-11-05T10:00:00Z');

function serve(snap: RobotSnapshot, passphrase = 'robot-passphrase'): typeof fetch {
  const body = JSON.stringify(encryptText(JSON.stringify(snap), passphrase, (n) => new Uint8Array(randomBytes(n)), 1000));
  return (async () => new Response(body, { status: 200 })) as typeof fetch;
}

const base: RobotSnapshot = {
  version: 1,
  generatedAt: '2026-11-05T09:00:00Z',
  classroom: { assignments: [], submissions: [] },
  grades: [
    { id: 'g1', subject: 'Математика', raw: '5', date: '2026-11-04' },
    { id: 'g2', subject: 'Математика', raw: '9', date: '2026-09-01' },
  ],
  errors: {},
};

describe('RobotSource', () => {
  it('decrypts the snapshot and filters grades by period', async () => {
    const src = new RobotSource('https://x/snapshot.json', 'robot-passphrase', serve(base), () => now);
    const grades = await src.grades().listGrades(new Date('2026-10-06T00:00:00Z'), now);
    expect(grades.map((g) => g.id)).toEqual(['g1']);
    expect(await src.classroom().fetch()).toEqual({ assignments: [], submissions: [] });
  });

  it('surfaces the robot error for a failed source', async () => {
    const snap = { ...base, classroom: null, errors: { classroom: 'Google відхилив вхід' } };
    const src = new RobotSource('https://x', 'robot-passphrase', serve(snap), () => now);
    await expect(src.classroom().fetch()).rejects.toThrow('Google відхилив вхід');
  });

  it('flags stale data and a wrong passphrase', async () => {
    const old = { ...base, generatedAt: '2026-11-01T00:00:00Z' };
    await expect(new RobotSource('https://x', 'robot-passphrase', serve(old), () => now).load()).rejects.toThrow(
      /застарілі/,
    );
    await expect(new RobotSource('https://x', 'wrong', serve(base), () => now).load()).rejects.toThrow(/пароль/);
  });
});
