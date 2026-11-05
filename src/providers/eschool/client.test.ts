import { describe, expect, it } from 'vitest';

import {
  EschoolGradesProvider,
  KNOWN_LOGIN_ACTION_ID,
  eschoolLogin,
  parseActionResponse,
  tokenFromSetCookie,
  type TokenStore,
} from './client';

const FLIGHT_HEAD = '0:{"a":"$@1","f":"","b":"x","q":"","i":true}';

function flight(result: string, headers: Record<string, string> = {}): Response {
  return new Response(`${FLIGHT_HEAD}\n1:${result}\n`, { status: 200, headers: { 'Content-Type': 'text/x-component', ...headers } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const APPOINTMENTS = {
  Items: [
    {
      Id: 1,
      Subject: 'Математика',
      Date: '2026-11-04T00:00:00',
      Embed: { Rates: [{ Id: 10, RateValue: '5', RateType: 'Самостійна' }] },
    },
  ],
};

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  const s = {
    value: initial,
    get: async () => s.value,
    set: async (t: string | null) => {
      s.value = t;
    },
  };
  return s;
}

describe('parseActionResponse', () => {
  it('reads the action result row', () => {
    expect(parseActionResponse(`${FLIGHT_HEAD}\n1:{"ok":false,"error":{"code":"invalid_credentials"}}\n`)).toEqual({
      ok: false,
      error: { code: 'invalid_credentials' },
    });
  });
  it('returns null for server errors and unknown responses', () => {
    expect(parseActionResponse(`${FLIGHT_HEAD}\n1:E{"digest":"1"}`)).toBeNull();
    expect(parseActionResponse('<html>404</html>')).toBeNull();
  });
});

describe('tokenFromSetCookie', () => {
  it('finds application_token among joined cookies', () => {
    expect(
      tokenFromSetCookie('es_auth=1; Path=/; Secure, application_token=aaa.bbb.ccc; Domain=.eschool-ua.com; Path=/'),
    ).toBe('aaa.bbb.ccc');
    expect(tokenFromSetCookie('es_auth=0; Path=/')).toBeNull();
    expect(tokenFromSetCookie(null)).toBeNull();
  });
});

describe('eschoolLogin', () => {
  it('sends form fields before the root row and maps errors', async () => {
    let sent: FormData | null = null;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      sent = init?.body as FormData;
      expect((init?.headers as Record<string, string>)['Next-Action']).toBe(KNOWN_LOGIN_ACTION_ID);
      return flight('{"ok":false,"error":{"code":"invalid_credentials"}}');
    }) as typeof fetch;
    await expect(eschoolLogin({ login: '380000000000', password: 'x' }, fetchFn)).rejects.toThrow(
      'неправильний логін або пароль',
    );
    expect([...sent!.keys()]).toEqual(['1_username', '1_password', '0']);
    expect(sent!.get('0')).toBe('[{"ok":true},"$K1"]');
  });

  it('finds a new action id when the site was updated', async () => {
    const ids: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const id = (init.headers as Record<string, string>)['Next-Action'];
        ids.push(id);
        if (id !== 'abcdef0123456789abcdef') return new Response('Server action not found', { status: 404 });
        return flight('{"ok":true}', { 'set-cookie': 'application_token=tok123; Path=/' });
      }
      if (url.endsWith('/login')) return new Response('<script src="/_next/static/chunks/app/login/page-1.js"></script>');
      return new Response(
        'let f=(0,u.createServerReference)("abcdef0123456789abcdef",u.callServer,void 0,u.findSourceMapURL,"loginAction");',
      );
    }) as typeof fetch;
    expect(await eschoolLogin({ login: 'a', password: 'b' }, fetchFn)).toBe('tok123');
    expect(ids).toEqual([KNOWN_LOGIN_ACTION_ID, 'abcdef0123456789abcdef']);
  });
});

describe('EschoolGradesProvider', () => {
  it('logs in, reads profile and grades, and keeps the token', async () => {
    const store = memoryStore();
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (init?.method === 'POST') return flight('{"ok":true}', { 'set-cookie': 'application_token=T1; Path=/' });
      expect((init?.headers as Record<string, string>)['X-Auth-Token']).toBe('T1');
      if (url.endsWith('/api/profile')) return json({ Id: 7, SchoolId: 3 });
      return json(APPOINTMENTS);
    }) as typeof fetch;
    const p = new EschoolGradesProvider({ login: 'a', password: 'b' }, fetchFn, store, 0);
    const grades = await p.listGrades(new Date(2026, 10, 1), new Date(2026, 10, 5));
    expect(grades).toMatchObject([{ id: 'es:10', subject: 'Математика', raw: '5', date: '2026-11-04' }]);
    expect(store.value).toBe('T1');
    expect(calls[2]).toContain('/api/v1/3/SchoolBoy/7/Appointment?start=2026-11-01&end=2026-11-05');
  });

  it('re-logs in when the saved token expired', async () => {
    const store = memoryStore('OLD');
    let logins = 0;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        logins++;
        return flight('{"ok":true}', { 'set-cookie': 'application_token=NEW; Path=/' });
      }
      const tok = (init?.headers as Record<string, string>)['X-Auth-Token'];
      if (tok === 'OLD') return json({ code: 'unauthenticated' }, 403);
      if (url.endsWith('/api/profile')) return json({ Id: 7, SchoolId: 3 });
      return json(APPOINTMENTS);
    }) as typeof fetch;
    const p = new EschoolGradesProvider({ login: 'a', password: 'b' }, fetchFn, store, 0);
    expect(await p.listGrades(new Date(2026, 10, 1), new Date(2026, 10, 5))).toHaveLength(1);
    expect(logins).toBe(1);
    expect(store.value).toBe('NEW');
  });

  it('explains when the account is a parent account', async () => {
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return flight('{"ok":true}', { 'set-cookie': 'application_token=T; Path=/' });
      return json({ Id: 7 });
    }) as typeof fetch;
    const p = new EschoolGradesProvider({ login: 'a', password: 'b' }, fetchFn, memoryStore(), 0);
    await expect(p.listGrades(new Date(), new Date())).rejects.toThrow('логін дитини');
  });
});
