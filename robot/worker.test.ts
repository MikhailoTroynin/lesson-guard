import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { encodeSessionString } from './state';
import { ROBOT_TOKEN_LABEL, WorkerClient } from './worker';

describe('WorkerClient', () => {
  it('ходить у Worker з токеном, виведеним із токена бота', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, eschool: null, google_session: null, state: null }));
    }) as unknown as typeof fetch;
    const c = new WorkerClient('123:T', 'https://w.example/', fetchFn);
    await c.config();
    const expected = createHmac('sha256', '123:T').update(ROBOT_TOKEN_LABEL).digest('hex');
    expect(calls[0].url).toBe('https://w.example/robot/config');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(`Bearer ${expected}`);
  });

  it('помилка Worker’а — виняток з поясненням', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 })) as unknown as typeof fetch;
    await expect(new WorkerClient('x', 'https://w', fetchFn).config()).rejects.toThrow(/401 unauthorized/);
  });

  it('рядок сесії lgs1 розбирається Worker’ом (той самий формат)', () => {
    const s = encodeSessionString({ cookies: [{ name: 'SID' }], origins: [] });
    expect(s.startsWith('lgs1:')).toBe(true);
    expect(JSON.parse(Buffer.from(s.slice(5), 'base64').toString())).toEqual({ cookies: [{ name: 'SID' }], origins: [] });
  });
});
