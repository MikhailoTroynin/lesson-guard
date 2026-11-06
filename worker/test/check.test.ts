import { beforeEach, describe, expect, it } from 'vitest';
import { handleUpdateSafe } from '../src/bot';
import { describeStatus, runServerCheck } from '../src/check';
import { handleGoogleCallback, saveGoogle, startGoogleLogin } from '../src/google';
import { Vault } from '../src/vault';
import { FakeD1 } from './d1';

const TOKEN = '123:TEST';
const ADMIN = 777;
const PARENT = -100;

/** Підроблений інтернет: Єдина школа, Google, Telegram. */
function fakeNet() {
  const sent: { chat_id: number; text: string }[] = [];
  const calls: string[] = [];
  const world = {
    eschoolPassword: 'right',
    rates: [] as { Id: number; Rate: number; Date: string }[],
    assignments: [] as { id: string; title: string; creationTime: string }[],
    submissions: [] as unknown[],
    googleRevoked: false,
  };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  const fetch: typeof globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.telegram.org')) {
      sent.push(JSON.parse(String(init?.body)));
      return json({ ok: true, result: { message_id: 1 } });
    }
    if (url === 'https://eschool-ua.com/login') {
      const body = init?.body as FormData;
      const ok = body.get('1_password') === world.eschoolPassword;
      return new Response(
        `0:{"a":"$@1"}\n1:${JSON.stringify(ok ? { ok: true } : { ok: false, error: { code: 'invalid_credentials' } })}\n`,
        { headers: ok ? { 'set-cookie': 'application_token=TKN; Path=/' } : {} },
      );
    }
    if (url.startsWith('https://diary.eschool-ua.com/api/profile')) return json({ Id: 5, SchoolId: 9 });
    if (url.startsWith('https://diary.eschool-ua.com/api/v1/9/SchoolBoy/5/Appointment')) {
      return json({
        Items: world.rates.map((r) => ({ Id: r.Id, Subject: 'Алгебра', Date: r.Date, Embed: { Rates: [r] } })),
      });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init?.body));
      if (p.get('grant_type') === 'authorization_code') {
        return json({
          access_token: 'AT',
          refresh_token: 'RT',
          scope:
            'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/drive.readonly',
        });
      }
      return world.googleRevoked ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'AT' });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) return json({ email: 'kid@school.ua' });
    if (url.startsWith('https://classroom.googleapis.com/v1/courses?')) return json({ courses: [{ id: 'c1', name: 'Алгебра' }] });
    if (url.includes('/courseWork?')) return json({ courseWork: world.assignments });
    if (url.includes('/studentSubmissions?')) return json({ studentSubmissions: world.submissions });
    if (url.includes('/drive/v3/files/f1?')) return json({ mimeType: 'application/vnd.google-apps.document' });
    if (url.includes('/drive/v3/files/f1/export?mimeType=text%2Fplain')) return new Response('   ');
    if (url.includes('/drive/v3/files/f1/export?mimeType=text%2Fhtml')) return new Response('<p></p>');
    return json({ error: { message: `unexpected ${url}` } }, 404);
  }) as typeof globalThis.fetch;
  return { sent, calls, world, fetch };
}

describe('перевірка на сервері → Telegram', () => {
  let db: FakeD1;
  let net: ReturnType<typeof fakeNet>;
  const env = () => ({ DB: db.d1, TELEGRAM_BOT_TOKEN: TOKEN });
  const vault = () => new Vault(db.d1, TOKEN);
  const now = (h: number) => new Date(Date.UTC(2026, 10, 6, h, 0, 0));

  beforeEach(async () => {
    db = new FakeD1();
    net = fakeNet();
    for (const [id, title] of [
      [ADMIN, 'Мама'],
      [PARENT, 'Батьки 7-А'],
    ] as const) {
      await db.d1.prepare('INSERT INTO telegram_chats (chat_id, title) VALUES (?, ?)').bind(id, title).run();
    }
    await db.d1.prepare('INSERT INTO admins (chat_id) VALUES (?)').bind(ADMIN).run();
    await db.d1.prepare("INSERT INTO children (id, name) VALUES (1, 'Олена')").run();
    await db.d1.prepare('INSERT INTO chat_children (chat_id, child_id) VALUES (?, 1)').bind(PARENT).run();
  });

  async function connectGoogle() {
    await saveGoogle(vault(), { client_id: 'x.apps.googleusercontent.com', client_secret: 's' });
    const g = (await vault().get('google_oauth'))!;
    const authUrl = new URL(await startGoogleLogin(db.d1, JSON.parse(g), 'https://w', now(8)));
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://w/oauth/google/callback');
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    const cb = new URL(`https://w/oauth/google/callback?code=CODE&state=${authUrl.searchParams.get('state')}`);
    return handleGoogleCallback(cb, db.d1, vault(), net.fetch, now(8));
  }

  it('нічого не підключено — без повідомлень, але стан видно', async () => {
    const { status } = await runServerCheck(env(), { reason: 'manual', fetch: net.fetch, now: now(9) });
    expect(status!.sources).toEqual({ eschool: 'none', classroom: 'none' });
    expect(net.sent).toEqual([]);
    expect(describeStatus(status)).toContain('не підключено');
  });

  it('вхід через Google: state одноразовий', async () => {
    expect(await connectGoogle()).toMatch(/google=ok$/);
    const g = JSON.parse((await vault().get('google_oauth'))!);
    expect(g).toMatchObject({ refresh_token: 'RT', email: 'kid@school.ua' });
    // Повторне використання того самого state не проходить.
    const again = await handleGoogleCallback(new URL('https://w/oauth/google/callback?code=C&state=zzz'), db.d1, vault(), net.fetch);
    expect(again).toMatch(/google=expired$/);
  });

  it('перше підключення — підсумок; далі — нові події в усі чати; помилка — адміну один раз', async () => {
    await vault().set('eschool_login', '380671234567');
    await vault().set('eschool_password', 'right');
    await connectGoogle();
    net.world.rates = [{ Id: 1, Rate: 4, Date: '2026-11-05T00:00:00' }]; // стара погана оцінка
    net.world.assignments = [{ id: 'w1', title: 'Задачі 1–5', creationTime: '2026-11-03T08:00:00Z' }];

    let r = await runServerCheck(env(), { reason: 'cron', fetch: net.fetch, now: now(9) });
    expect(r.status!.errors).toEqual({});
    // Старі події не шлемо — лише «підключено».
    expect(net.sent.map((m) => m.text).join('\n')).not.toContain('Погана оцінка');
    expect(net.sent.filter((m) => m.chat_id === ADMIN).map((m) => m.text)).toEqual([
      expect.stringContaining('Єдина школа підключена. Оцінок за 30 днів: 1, з них нижче 7: 1'),
      expect.stringContaining('Google Клас підключено. Завдань за 45 днів: 1'),
    ]);
    expect(net.sent.some((m) => m.chat_id === PARENT)).toBe(true);

    // Нове завдання, нова погана оцінка і порожня здача.
    net.sent.length = 0;
    net.world.rates.push({ Id: 2, Rate: 5, Date: '2026-11-06T00:00:00' });
    net.world.assignments.push({ id: 'w2', title: 'Твір', creationTime: '2026-11-06T09:30:00Z' });
    net.world.submissions = [
      {
        id: 's1',
        courseId: 'c1',
        courseWorkId: 'w1',
        state: 'TURNED_IN',
        updateTime: '2026-11-06T09:40:00Z',
        assignmentSubmission: { attachments: [{ driveFile: { id: 'f1', title: 'Робота' } }] },
      },
    ];
    r = await runServerCheck(env(), { reason: 'cron', fetch: net.fetch, now: now(10) });
    expect(r.status!.alerts).toBe(3);
    for (const chat of [ADMIN, PARENT]) {
      const text = net.sent.filter((m) => m.chat_id === chat).map((m) => m.text).join('\n');
      expect(text).toContain('📘 Нове завдання: Алгебра');
      expect(text).toContain('⛔ Погана оцінка: Алгебра — 5');
      expect(text).toContain('⚠️ Порожня здача');
    }
    expect(db.rows('SELECT * FROM notifications_log')).toHaveLength(6);

    // Той самий стан — нічого нового; файл узято з кешу.
    net.sent.length = 0;
    net.calls.length = 0;
    await runServerCheck(env(), { reason: 'cron', fetch: net.fetch, now: now(11) });
    expect(net.sent).toEqual([]);
    expect(net.calls.some((u) => u.includes('/drive/'))).toBe(false);

    // Пароль змінили: адміну одне повідомлення, а не щогодини.
    net.world.eschoolPassword = 'new';
    await vault().set('eschool_token', null);
    await runServerCheck(env(), { reason: 'cron', fetch: net.fetch, now: now(12) });
    await runServerCheck(env(), { reason: 'cron', fetch: net.fetch, now: now(13) });
    const errs = net.sent.filter((m) => m.text.includes('неправильний логін'));
    expect(errs.map((m) => m.chat_id)).toEqual([ADMIN]);
  });

  it('Google через робота: без даних від робота — помилка адміністратору', async () => {
    await vault().set('google_email', 'kid@school.ua');
    await vault().set('google_password', 'p');
    const { status } = await runServerCheck(env(), { reason: 'cron', fetch: net.fetch, now: now(9) });
    expect(status!.sources.classroom).toBe('robot');
    expect(status!.errors.classroom).toContain('Робот ще не запускався');
    expect(net.sent.filter((m) => m.text.includes('Робот ще не запускався')).map((m) => m.chat_id)).toEqual([ADMIN]);

    // Робот передав дані → «знову читається» і перший підсумок.
    net.sent.length = 0;
    await vault().set(
      'robot_snapshot',
      JSON.stringify({
        version: 1,
        generatedAt: now(10).toISOString(),
        classroom: { assignments: [{ id: 'a1', courseId: 'c', courseName: 'Фізика', title: 'Лаб 1', createdAt: now(8).toISOString() }], submissions: [] },
        grades: null,
        errors: {},
      }),
    );
    await runServerCheck(env(), { reason: 'robot', fetch: net.fetch, now: now(10) });
    const texts = net.sent.filter((m) => m.chat_id === ADMIN).map((m) => m.text);
    expect(texts.some((t) => t.includes('Google Клас підключено'))).toBe(true);
    expect(texts.some((t) => t.includes('Google Клас знову читається'))).toBe(true);
  });

  it('ліміт запитів: курси оновлюються по черзі, дані не губляться', async () => {
    await connectGoogle();
    net.world.assignments = [{ id: 'w1', title: 'T', creationTime: '2026-11-05T08:00:00Z' }];
    // token + courses + (courseWork + submissions) на курс; Telegram-резерв 8.
    const r = await runServerCheck(
      { ...env(), SUBREQUEST_BUDGET: '11' },
      { reason: 'cron', fetch: net.fetch, now: now(9) },
    );
    expect(r.status!.courses).toEqual({ refreshed: 0, total: 1 });
    const r2 = await runServerCheck(
      { ...env(), SUBREQUEST_BUDGET: '20' },
      { reason: 'cron', fetch: net.fetch, now: now(10) },
    );
    expect(r2.status!.courses).toEqual({ refreshed: 1, total: 1 });
    expect(r2.status!.counts.assignments).toBe(1);
  });

  it('бот: /check, /status, /threshold', async () => {
    let settings = { badGradeThreshold: 7, notifyNewAssignments: true, subjectMap: {}, matchWindowDays: 14, gradeLookbackDays: 7 };
    const deps = {
      db: db.d1,
      botToken: TOKEN,
      fetch: net.fetch,
      check: async () => describeStatus((await runServerCheck(env(), { reason: 'bot', fetch: net.fetch })).status),
      getSettings: async () => settings,
      saveSettings: async (s: typeof settings) => {
        settings = s;
      },
    };
    const say = (chatId: number, text: string, type: 'private' | 'group' = 'private') =>
      handleUpdateSafe({ update_id: 1, message: { message_id: 1, chat: { id: chatId, type }, text } }, deps);

    await say(ADMIN, '/check');
    expect(net.sent.at(-1)!.text).toContain('Остання перевірка');
    await say(PARENT, '/status', 'group');
    expect(net.sent.at(-1)!.text).toContain('Єдина школа');
    await say(999, '/status');
    expect(net.sent.at(-1)!.text).toContain('доступна адміністратору');
    await say(PARENT, '/threshold 8', 'group');
    expect(settings.badGradeThreshold).toBe(7);
    await say(ADMIN, '/threshold 8');
    expect(settings.badGradeThreshold).toBe(8);
    await say(ADMIN, '/new off');
    expect(settings.notifyNewAssignments).toBe(false);
  });
});
