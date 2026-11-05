import { describe, expect, it } from 'vitest';

import { GoogleClassroomProvider, meaningfulLength } from './google';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('meaningfulLength', () => {
  it('ignores whitespace and empty CSV cells', () => {
    expect(meaningfulLength('﻿ \n\r\n  ')).toBe(0);
    expect(meaningfulLength(',,,\n,,,')).toBe(0);
    expect(meaningfulLength('Відповідь: 42')).toBe(12);
  });
});

describe('GoogleClassroomProvider', () => {
  it('maps courses, coursework and submissions, reading Drive content', async () => {
    const calls: string[] = [];
    const routes: [RegExp, () => Response][] = [
      [/\/courses\?studentId=me/, () => json({ courses: [{ id: 'c1', name: 'Математика', section: '7-А' }] })],
      [
        /\/courses\/c1\/courseWork\?/,
        () =>
          json({
            courseWork: [
              {
                id: 'w1',
                courseId: 'c1',
                title: 'Задачі',
                creationTime: '2026-11-03T08:00:00Z',
                dueDate: { year: 2026, month: 11, day: 4 },
              },
              { id: 'old', courseId: 'c1', title: 'Старе', creationTime: '2025-01-01T08:00:00Z' },
            ],
          }),
      ],
      [
        /studentSubmissions/,
        () =>
          json({
            studentSubmissions: [
              {
                id: 's1',
                courseId: 'c1',
                courseWorkId: 'w1',
                state: 'TURNED_IN',
                updateTime: '2026-11-04T19:00:00Z',
                assignmentSubmission: { attachments: [{ driveFile: { id: 'd1', title: 'Розв’язки' } }] },
              },
            ],
          }),
      ],
      [/\/files\/d1\/export/, () => new Response('  \n ')],
      [/\/files\/d1\?/, () => json({ mimeType: 'application/vnd.google-apps.document' })],
    ];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      const route = routes.find(([re]) => re.test(url));
      return route ? route[1]() : json({ error: { message: 'nope' } }, 404);
    }) as unknown as typeof fetch;

    const p = new GoogleClassroomProvider({
      getAccessToken: async () => 't',
      fetchFn,
      now: () => new Date('2026-11-05T12:00:00Z'),
    });
    const data = await p.fetch();
    expect(data.assignments).toEqual([
      {
        id: 'w1',
        courseId: 'c1',
        courseName: 'Математика 7-А',
        title: 'Задачі',
        createdAt: '2026-11-03T08:00:00Z',
        dueDate: '2026-11-04',
        link: undefined,
      },
    ]);
    expect(data.submissions[0].attachments[0]).toMatchObject({ kind: 'driveFile', textLength: 0 });
  });

  it('retries once after 401 with a fresh token', async () => {
    let tokens = 0;
    let invalidated = '';
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer t1' ? json({}, 401) : json({ courses: [] });
    }) as unknown as typeof fetch;
    const p = new GoogleClassroomProvider({
      getAccessToken: async () => `t${++tokens}`,
      invalidateToken: async (t) => {
        invalidated = t;
      },
      fetchFn,
    });
    expect(await p.fetch()).toEqual({ assignments: [], submissions: [] });
    expect(invalidated).toBe('t1');
  });
});
