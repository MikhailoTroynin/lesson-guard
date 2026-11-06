import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi, maskLogin, parseGoogleSession } from '../src/api';
import { TEXTS, handleUpdateSafe, type TgUpdate } from '../src/bot';
import { robotToken } from '../src/crypto';
import { resetBotUsernameCache } from '../src/telegram';
import { Vault } from '../src/vault';
import { FakeD1 } from './d1';

const TOKEN = '123:TEST';
const ORIGIN = 'https://mikhailotroynin.github.io';
const ME = 777;

function telegramFetch() {
  const sent: { chat_id: number; text: string }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/getMe')) {
      return new Response(JSON.stringify({ ok: true, result: { username: 'LessonGuardBot' } }));
    }
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
  return { sent, fetch: f as unknown as typeof fetch };
}

let seq = 0;
const startMsg = (chatId: number, args: string, type: 'private' | 'group' = 'private'): TgUpdate => ({
  update_id: ++seq,
  message: { message_id: seq, chat: { id: chatId, type, first_name: `Chat${chatId}` }, text: `/start ${args}` },
});

describe('API сторінки налаштувань', () => {
  let db: FakeD1;
  let tg: ReturnType<typeof telegramFetch>;
  const env = () => ({ DB: db.d1, TELEGRAM_BOT_TOKEN: TOKEN });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await handleApi(
      new Request(`https://w${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env(),
      tg.fetch,
    );
    if (!res) throw new Error('not an api path');
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  };
  const bot = (u: TgUpdate) => handleUpdateSafe(u, { db: db.d1, botToken: TOKEN, fetch: tg.fetch });

  /** Повний вхід: start → Telegram → poll. */
  async function login(chatId = ME): Promise<{ token?: string; reply?: string }> {
    const s = await call('POST', '/api/auth/start');
    const nonce = /start=login_([0-9a-f]+)$/.exec(s.body.url)![1];
    await bot(startMsg(chatId, `login_${nonce}`));
    const p = await call('POST', '/api/auth/poll', { request_id: s.body.request_id });
    return { token: p.body.token, reply: tg.sent.at(-1)?.text };
  }

  beforeEach(() => {
    db = new FakeD1();
    tg = telegramFetch();
    resetBotUsernameCache();
  });

  it('CORS лише для GitHub Pages', async () => {
    const ok = await handleApi(new Request('https://w/api/overview', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env());
    expect(ok!.status).toBe(204);
    expect(ok!.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const bad = await handleApi(
      new Request('https://w/api/overview', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
      env(),
    );
    expect(bad!.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('без сесії — 401', async () => {
    expect((await call('GET', '/api/overview')).status).toBe(401);
    expect((await call('GET', '/api/overview', undefined, 'f'.repeat(64))).status).toBe(401);
  });

  it('вхід: посилання на бота, поки не підтверджено — pending', async () => {
    const s = await call('POST', '/api/auth/start');
    expect(s.body.url).toMatch(/^https:\/\/t\.me\/LessonGuardBot\?start=login_[0-9a-f]{32}$/);
    expect((await call('POST', '/api/auth/poll', { request_id: s.body.request_id })).body.status).toBe('pending');
    expect((await call('POST', '/api/auth/poll', { request_id: 'x' })).body.status).toBe('expired');
  });

  it('перший чат стає адміністратором, другий — ні, поки його не додадуть', async () => {
    const first = await login(ME);
    expect(first.reply).toBe(TEXTS.loginBecameAdmin);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);

    const other = await login(888);
    expect(other.reply).toBe(TEXTS.loginNotAdmin);
    expect(other.token).toBeUndefined();

    // Адмін додає 888 → тепер можна.
    expect((await call('PUT', '/api/chats/888/admin', { admin: true }, first.token)).status).toBe(200);
    const again = await login(888);
    expect(again.reply).toBe(TEXTS.loginApproved);
    expect(again.token).toBeDefined();

    // Забрати доступ: сесії 888 перестають працювати.
    await call('PUT', '/api/chats/888/admin', { admin: false }, first.token);
    expect((await call('GET', '/api/overview', undefined, again.token)).status).toBe(401);
    // У себе забрати не можна.
    expect((await call('PUT', `/api/chats/${ME}/admin`, { admin: false }, first.token)).status).toBe(400);
  });

  it('вхід з групи не приймається; посилання одноразове', async () => {
    const s = await call('POST', '/api/auth/start');
    const nonce = /login_([0-9a-f]+)$/.exec(s.body.url)![1];
    await bot(startMsg(-100, `login_${nonce}`, 'group'));
    expect(tg.sent.at(-1)?.text).toBe(TEXTS.loginNotPrivate);
    await bot(startMsg(ME, `login_${nonce}`));
    const p1 = await call('POST', '/api/auth/poll', { request_id: s.body.request_id });
    expect(p1.body.status).toBe('ok');
    const p2 = await call('POST', '/api/auth/poll', { request_id: s.body.request_id });
    expect(p2.body.status).toBe('expired');
    await bot(startMsg(ME, `login_${nonce}`));
    expect(tg.sent.at(-1)?.text).toBe(TEXTS.loginInvalid);
  });

  it('/logout у боті і /api/auth/logout завершують сесії', async () => {
    const { token } = await login();
    await bot({ update_id: ++seq, message: { message_id: 1, chat: { id: ME, type: 'private' }, text: '/logout' } });
    expect(tg.sent.at(-1)?.text).toBe(TEXTS.loggedOut(1));
    expect((await call('GET', '/api/overview', undefined, token)).status).toBe(401);
    const t2 = (await login()).token;
    expect((await call('POST', '/api/auth/logout', undefined, t2)).status).toBe(200);
    expect((await call('GET', '/api/overview', undefined, t2)).status).toBe(401);
  });

  it('налаштування, діти, коди, облікові дані, огляд', async () => {
    const { token } = await login();

    expect((await call('PUT', '/api/settings', { badGradeThreshold: 1 }, token)).status).toBe(400);
    expect((await call('PUT', '/api/settings', { foo: 1 }, token)).status).toBe(400);
    const s = await call('PUT', '/api/settings', { badGradeThreshold: 8, subjectMap: { c1: ' Алгебра ' } }, token);
    expect(s.body.settings).toMatchObject({ badGradeThreshold: 8, subjectMap: { c1: 'Алгебра' }, notifyNewAssignments: true });

    const child = await call('POST', '/api/children', { name: 'Олена', class_name: '7-А' }, token);
    expect(child.body).toMatchObject({ ok: true, created: true });
    const code = await call('POST', `/api/children/${child.body.id}/link-code`, undefined, token);
    expect(code.body.code).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}$/);
    expect((await call('POST', '/api/children/999/link-code', undefined, token)).status).toBe(404);

    // Батько прив'язується кодом.
    await bot({ update_id: ++seq, message: { message_id: 1, chat: { id: 555, type: 'private', first_name: 'Тато' }, text: `/link ${code.body.code}` } });

    const cred = await call(
      'PUT',
      '/api/credentials',
      {
        eschool_login: '+380 67 123 4567',
        eschool_password: 'secret-pass',
        google_session: `lgs1:${btoa(JSON.stringify({ cookies: [{ name: 'SID' }], origins: [] }))}`,
      },
      token,
    );
    expect(cred.status).toBe(200);
    // Паролі в базі лише зашифровані.
    expect(JSON.stringify(db.rows('SELECT * FROM vault'))).not.toContain('secret-pass');

    const o = (await call('GET', '/api/overview', undefined, token)).body;
    expect(o.settings.badGradeThreshold).toBe(8);
    expect(o.children).toEqual([{ id: child.body.id, name: 'Олена', class_name: '7-А', chat_ids: [555] }]);
    expect(o.chats.find((c: any) => c.chat_id === ME)).toMatchObject({ is_admin: true });
    expect(o.chats.find((c: any) => c.chat_id === 555)).toMatchObject({ is_admin: false, title: 'Тато' });
    expect(o.credentials).toMatchObject({ eschool_login: '38067•••4567', eschool_password: true });
    expect(o.credentials.google_session_updated_at).toBeTruthy();
    expect(JSON.stringify(o)).not.toContain('secret-pass');

    // Відв'язати і видалити.
    await call('DELETE', `/api/chats/555/children/${child.body.id}`, undefined, token);
    await call('DELETE', `/api/children/${child.body.id}`, undefined, token);
    const o2 = (await call('GET', '/api/overview', undefined, token)).body;
    expect(o2.children).toEqual([]);

    // Очистити пароль.
    await call('PUT', '/api/credentials', { eschool_password: null }, token);
    expect((await call('GET', '/api/overview', undefined, token)).body.credentials.eschool_password).toBe(false);
  });

  it('робот: токен, конфіг і звіт; сторінка бачить знімок', async () => {
    const { token } = await login();
    await call('PUT', '/api/credentials', { eschool_login: '380671234567', eschool_password: 'p' }, token);

    const robot = async (method: string, path: string, body?: unknown, auth?: string) => {
      const res = await handleApi(
        new Request(`https://w${path}`, {
          method,
          headers: auth ? { authorization: `Bearer ${auth}` } : {},
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env(),
      );
      return { status: res!.status, body: (await res!.json()) as any };
    };
    expect((await robot('GET', '/robot/config')).status).toBe(401);
    expect((await robot('GET', '/robot/config', undefined, token)).status).toBe(401); // сесія сторінки не підходить
    const rt = await robotToken(TOKEN);
    const cfg = await robot('GET', '/robot/config', undefined, rt);
    expect(cfg.body).toMatchObject({ eschool: { login: '380671234567', password: 'p' }, google_session: null, state: null });

    const snapshot = {
      version: 1,
      generatedAt: '2026-11-06T10:00:00Z',
      classroom: { assignments: [{ id: 'a' }], submissions: [] },
      grades: [{ id: 'g1' }, { id: 'g2' }],
      errors: {},
    };
    expect((await robot('POST', '/robot/report', { snapshot, state: { items: {} } }, rt)).status).toBe(200);
    expect((await robot('GET', '/robot/config', undefined, rt)).body.state).toEqual({ items: {} });

    const o = (await call('GET', '/api/overview', undefined, token)).body;
    expect(o.robot).toMatchObject({ generatedAt: '2026-11-06T10:00:00Z', counts: { assignments: 1, submissions: 0, grades: 2 } });
    expect((await call('GET', '/api/snapshot', undefined, token)).body.snapshot).toEqual(snapshot);
  });
});

describe('допоміжне', () => {
  it('maskLogin', () => {
    expect(maskLogin('380671234567')).toBe('38067•••4567');
    expect(maskLogin('123')).toBe('•••');
  });

  it('parseGoogleSession', () => {
    const json = JSON.stringify({ cookies: [{ name: 'SID' }], origins: [{ x: 1 }] });
    expect(JSON.parse(parseGoogleSession(`lgs1:${btoa(json)}`))).toEqual({ cookies: [{ name: 'SID' }], origins: [] });
    expect(JSON.parse(parseGoogleSession(json)).cookies).toHaveLength(1);
    expect(() => parseGoogleSession('lgs1:%%%')).toThrow();
    expect(() => parseGoogleSession('{"cookies":[]}')).toThrow();
  });

  it('vault: інший токен — запис не читається', async () => {
    const db = new FakeD1();
    await new Vault(db.d1, 'a').set('eschool_password', 'x');
    expect(await new Vault(db.d1, 'a').get('eschool_password')).toBe('x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await new Vault(db.d1, 'b').get('eschool_password')).toBeNull();
    warn.mockRestore();
  });
});
