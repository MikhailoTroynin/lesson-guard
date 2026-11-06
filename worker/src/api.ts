/**
 * API для сторінки налаштувань (GitHub Pages) і для робота (GitHub Actions).
 *
 * Сторінка (CORS лише з ALLOWED_ORIGINS, Authorization: Bearer <токен сесії>):
 *   POST   /api/auth/start                      → { request_id, url, expires_at }
 *   POST   /api/auth/poll    { request_id }      → { status, token? }
 *   POST   /api/auth/logout
 *   GET    /api/overview                         налаштування, діти, чати, стан робота
 *   PUT    /api/settings     { …часткові… }
 *   PUT    /api/credentials  { eschool_login?, eschool_password?, google_session?, google_email?, google_password? }  (null — видалити)
 *   POST   /api/children     { name, class_name }
 *   DELETE /api/children/:id
 *   POST   /api/children/:id/link-code           → { code, expires_at }
 *   DELETE /api/chats/:chatId/children/:childId
 *   PUT    /api/chats/:chatId/admin  { admin: true|false }
 *   GET    /api/snapshot                         останні дані (оцінки, завдання) і стан перевірки
 *   POST   /api/check                            перевірити зараз (Єдина школа, Google Клас → Telegram)
 *   PUT    /api/google/client { client_id, client_secret }   OAuth-клієнт з Google Cloud Console
 *   POST   /api/google/start                     → { url } вхід через Google (повернення на /oauth/google/callback)
 *   DELETE /api/google                           відключити Google-акаунт
 *
 * Робот (Authorization: Bearer hex(HMAC(TELEGRAM_BOT_TOKEN, ROBOT_TOKEN_LABEL))):
 *   GET    /robot/config                         логіни, сесія Google, пам'ять, налаштування
 *   POST   /robot/report     { snapshot, state }
 *   POST   /robot/notify     { text }            повідомлення адміністраторам (наприклад, «підтвердіть вхід у Google»)
 */
import { EschoolLoginError, eschoolLogin } from '../../src/providers/eschool/client';
import { authenticate, logout, pollLogin, startLogin, type Session } from './auth';
import { describeStatus, getServerStatus, runServerCheck, type CheckEnv } from './check';
import { Budget } from './classroom';
import { callbackUrl, loadGoogle, saveGoogle, startGoogleLogin } from './google';
import { bearerMatches, robotToken } from './crypto';
import { createLinkCode, findOrCreateChild } from './linkCodes';
import { getJson, getSettings, setJson, validateSettingsPatch, type RobotStatus } from './settings';
import { getBotUsername, sendMessage } from './telegram';
import { Vault } from './vault';

export type ApiEnv = CheckEnv;

export const ALLOWED_ORIGINS = ['https://mikhailotroynin.github.io', 'http://localhost:8081'];

const MAX_BODY = 1_500_000;
const MAX_SESSION = 300_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function reply(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request) },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'завеликий запит');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'завеликий запит');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // нижче
  }
  throw new HttpError(400, 'очікується JSON-об\'єкт');
}

const clean = (v: unknown, max: number, field: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${field}: очікується рядок`);
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new HttpError(400, `${field}: до ${max} символів`);
  return s || null;
};

const intParam = (s: string): number => {
  if (!/^-?\d{1,20}$/.test(s)) throw new HttpError(400, 'некоректний id');
  return Number(s);
};

/** Маскує логін: 380671234567 → 38067•••4567. */
export function maskLogin(login: string): string {
  return login.length <= 6 ? '•••' : `${login.slice(0, 5)}•••${login.slice(-4)}`;
}

/** Обробляє /api/* і /robot/*. Повертає null для інших шляхів. */
export async function handleApi(request: Request, env: ApiEnv, fetchImpl?: typeof fetch): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/') && !path.startsWith('/robot/')) return null;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!env.TELEGRAM_BOT_TOKEN) return reply(request, { ok: false, error: 'not configured' }, 503);

  try {
    if (path.startsWith('/robot/')) return await robotRoutes(request, env, path, fetchImpl);
    return await pageRoutes(request, env, path, fetchImpl);
  } catch (e) {
    if (e instanceof HttpError) return reply(request, { ok: false, error: e.message }, e.status);
    console.error(`${request.method} ${path}:`, e);
    return reply(request, { ok: false, error: 'internal error' }, 500);
  }
}

async function pageRoutes(request: Request, env: ApiEnv, path: string, fetchImpl?: typeof fetch): Promise<Response> {
  const db = env.DB;
  const m = request.method;

  // ── Вхід ──
  if (path === '/api/auth/start' && m === 'POST') {
    const username = await getBotUsername({ botToken: env.TELEGRAM_BOT_TOKEN, fetch: fetchImpl });
    const r = await startLogin(db, username);
    return reply(request, { ok: true, request_id: r.requestId, url: r.url, expires_at: r.expiresAt });
  }
  if (path === '/api/auth/poll' && m === 'POST') {
    const body = await readBody(request);
    const r = await pollLogin(db, body.request_id);
    return reply(request, r.status === 'ok' ? { ok: true, status: 'ok', token: r.token } : { ok: true, status: r.status });
  }

  // ── Далі — лише з сесією ──
  const session = await authenticate(db, request);
  if (!session) return reply(request, { ok: false, error: 'unauthorized' }, 401);

  if (path === '/api/auth/logout' && m === 'POST') {
    await logout(db, session.tokenHash);
    return reply(request, { ok: true });
  }
  if (path === '/api/overview' && m === 'GET') return reply(request, await overview(env, session, new URL(request.url).origin));

  if (path === '/api/settings' && m === 'PUT') {
    const next = validateSettingsPatch(await getSettings(db), await readBody(request));
    if (typeof next === 'string') throw new HttpError(400, next);
    await setJson(db, 'settings', next);
    return reply(request, { ok: true, settings: next });
  }

  if (path === '/api/credentials' && m === 'PUT') {
    const body = await readBody(request);
    const vault = new Vault(db, env.TELEGRAM_BOT_TOKEN);
    let login: string | null | undefined;
    let password: string | null | undefined;
    for (const [k, v] of Object.entries(body)) {
      if (k === 'eschool_login') {
        const l = clean(v, 100, k);
        login = l ? l.replace(/[\s()+-]/g, '') : null;
      } else if (k === 'eschool_password') {
        if (v !== null && (typeof v !== 'string' || v.length > 200)) throw new HttpError(400, `${k}: до 200 символів`);
        password = (v as string | null) || null;
      } else if (k === 'google_session') {
        await vault.set('google_session', v === null || v === '' ? null : parseGoogleSession(v));
      } else if (k === 'google_email') {
        const email = clean(v, 200, k);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'google_email: некоректний email');
        await vault.set('google_email', email ? email.toLowerCase() : null);
      } else if (k === 'google_password') {
        if (v !== null && (typeof v !== 'string' || v.length > 200)) throw new HttpError(400, `${k}: до 200 символів`);
        await vault.set('google_password', (v as string | null) || null);
      } else {
        throw new HttpError(400, `невідоме поле ${k}`);
      }
    }
    let warning: string | undefined;
    if (login !== undefined || password !== undefined) {
      const finalLogin = login === undefined ? await vault.get('eschool_login') : login;
      const finalPassword = password === undefined ? await vault.get('eschool_password') : password;
      let token: string | null = null;
      if (finalLogin && finalPassword) {
        // Одразу пробуємо увійти: неправильний пароль видно на сторінці, а не через годину.
        try {
          token = (await eschoolLogin({ login: finalLogin, password: finalPassword }, new Budget(10, fetchImpl).fetch)) || null;
        } catch (e) {
          if (e instanceof EschoolLoginError && ['invalid_credentials', 'validation', 'rate_limited'].includes(e.code)) {
            throw new HttpError(400, `Єдина школа: ${e.message}`);
          }
          warning = `Збережено, але перевірити вхід зараз не вдалося: ${e instanceof Error ? e.message : e}`;
        }
      }
      if (login !== undefined) await vault.set('eschool_login', login);
      if (password !== undefined) await vault.set('eschool_password', password);
      await vault.set('eschool_token', token);
    }
    return reply(request, { ok: true, warning });
  }

  if (path === '/api/check' && m === 'POST') {
    const r = await runServerCheck(env, { reason: 'manual', fetch: fetchImpl });
    return reply(request, { ok: true, busy: !!r.busy, server: r.status, text: describeStatus(r.status) });
  }

  if (path === '/api/google/client' && m === 'PUT') {
    const body = await readBody(request);
    const clientId = clean(body.client_id, 200, 'client_id');
    const secret = typeof body.client_secret === 'string' ? body.client_secret.trim() : '';
    if (!clientId || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new HttpError(400, 'Client ID має закінчуватися на .apps.googleusercontent.com');
    }
    const vault = new Vault(db, env.TELEGRAM_BOT_TOKEN);
    const cur = await loadGoogle(vault);
    if (!secret && cur?.client_id !== clientId) throw new HttpError(400, 'вкажіть Client secret');
    if (secret.length > 200) throw new HttpError(400, 'Client secret: до 200 символів');
    const same = cur?.client_id === clientId;
    await saveGoogle(vault, {
      ...(same ? cur : {}),
      client_id: clientId,
      client_secret: secret || cur!.client_secret,
    });
    return reply(request, { ok: true });
  }

  if (path === '/api/google/start' && m === 'POST') {
    const g = await loadGoogle(new Vault(db, env.TELEGRAM_BOT_TOKEN));
    if (!g) throw new HttpError(400, 'спершу збережіть Client ID і Client secret');
    return reply(request, { ok: true, url: await startGoogleLogin(db, g, new URL(request.url).origin) });
  }

  if (path === '/api/google' && m === 'DELETE') {
    const vault = new Vault(db, env.TELEGRAM_BOT_TOKEN);
    const g = await loadGoogle(vault);
    if (g?.refresh_token) {
      // Відкликаємо доступ у Google (не страшно, якщо не вдалося).
      await (fetchImpl ?? fetch)(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refresh_token)}`, {
        method: 'POST',
      }).catch(() => null);
    }
    if (g) await saveGoogle(vault, { client_id: g.client_id, client_secret: g.client_secret });
    await vault.set('classroom_cache', null);
    return reply(request, { ok: true });
  }

  if (path === '/api/children' && m === 'POST') {
    const body = await readBody(request);
    const name = clean(body.name, 100, 'name');
    if (!name) throw new HttpError(400, 'вкажіть ім\'я дитини');
    const child = await findOrCreateChild(db, name, clean(body.class_name, 20, 'class_name'));
    return reply(request, { ok: true, id: child.id, created: child.created });
  }

  let mm = /^\/api\/children\/(\d+)$/.exec(path);
  if (mm && m === 'DELETE') {
    await db.prepare('DELETE FROM children WHERE id = ?').bind(intParam(mm[1])).run();
    return reply(request, { ok: true });
  }

  mm = /^\/api\/children\/(\d+)\/link-code$/.exec(path);
  if (mm && m === 'POST') {
    const id = intParam(mm[1]);
    const exists = await db.prepare('SELECT 1 AS x FROM children WHERE id = ?').bind(id).first();
    if (!exists) throw new HttpError(404, 'дитину не знайдено');
    const { code, expiresAt } = await createLinkCode(db, id);
    return reply(request, { ok: true, code, expires_at: expiresAt });
  }

  mm = /^\/api\/chats\/(-?\d+)\/children\/(\d+)$/.exec(path);
  if (mm && m === 'DELETE') {
    await db
      .prepare('DELETE FROM chat_children WHERE chat_id = ? AND child_id = ?')
      .bind(intParam(mm[1]), intParam(mm[2]))
      .run();
    return reply(request, { ok: true });
  }

  mm = /^\/api\/chats\/(-?\d+)\/admin$/.exec(path);
  if (mm && m === 'PUT') {
    const chatId = intParam(mm[1]);
    const { admin } = await readBody(request);
    if (typeof admin !== 'boolean') throw new HttpError(400, 'admin: true/false');
    if (admin) {
      const chat = await db.prepare('SELECT chat_id FROM telegram_chats WHERE chat_id = ? AND chat_id > 0').bind(chatId).first();
      if (!chat) throw new HttpError(400, 'адміністратором може бути лише особистий чат, який писав боту');
      await db.prepare('INSERT OR IGNORE INTO admins (chat_id) VALUES (?)').bind(chatId).run();
    } else {
      if (chatId === session.chatId) throw new HttpError(400, 'не можна забрати доступ у себе');
      await db.prepare('DELETE FROM admins WHERE chat_id = ?').bind(chatId).run();
    }
    return reply(request, { ok: true });
  }

  if (path === '/api/snapshot' && m === 'GET') {
    const raw = await new Vault(db, env.TELEGRAM_BOT_TOKEN).get('snapshot');
    return reply(request, {
      ok: true,
      snapshot: raw ? JSON.parse(raw) : null,
      settings: await getSettings(db),
      robot: await getJson<RobotStatus>(db, 'robot_status'),
      server: await getServerStatus(db),
    });
  }

  return reply(request, { ok: false, error: 'not found' }, 404);
}

/**
 * Рядок з `npm run robot:session` («lgs1:<base64 JSON>») або сам JSON storageState.
 * Повертає нормалізований JSON для сховища.
 */
export function parseGoogleSession(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_SESSION) throw new HttpError(400, 'google_session: некоректний рядок');
  let text = v.trim();
  if (text.startsWith('lgs1:')) {
    try {
      text = new TextDecoder().decode(Uint8Array.from(atob(text.slice(5)), (c) => c.charCodeAt(0)));
    } catch {
      throw new HttpError(400, 'google_session: рядок пошкоджено — скопіюйте його повністю');
    }
  }
  let state: { cookies?: unknown };
  try {
    state = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'google_session: це не рядок з npm run robot:session');
  }
  if (!state || !Array.isArray(state.cookies) || state.cookies.length === 0) {
    throw new HttpError(400, 'google_session: у рядку немає cookies Google');
  }
  return JSON.stringify({ cookies: state.cookies, origins: [] });
}

async function overview(env: ApiEnv, session: Session, origin: string) {
  const db = env.DB;
  const vault = new Vault(db, env.TELEGRAM_BOT_TOKEN);
  const [settings, children, chats, links, admins, vaultList, robot, server, google] = await Promise.all([
    getSettings(db),
    db.prepare('SELECT id, name, class_name FROM children ORDER BY name, id').all<{ id: number; name: string; class_name: string | null }>(),
    db
      .prepare('SELECT chat_id, title, username, is_active FROM telegram_chats ORDER BY created_at')
      .all<{ chat_id: number; title: string | null; username: string | null; is_active: number }>(),
    db.prepare('SELECT chat_id, child_id FROM chat_children').all<{ chat_id: number; child_id: number }>(),
    db.prepare('SELECT chat_id FROM admins').all<{ chat_id: number }>(),
    vault.list(),
    getJson<RobotStatus>(db, 'robot_status'),
    getServerStatus(db),
    loadGoogle(vault),
  ]);
  const login = vaultList.eschool_login ? await vault.get('eschool_login') : null;
  const adminSet = new Set(admins.results.map((a) => a.chat_id));
  return {
    ok: true,
    me: { chat_id: session.chatId },
    settings,
    children: children.results.map((c) => ({
      ...c,
      chat_ids: links.results.filter((l) => l.child_id === c.id).map((l) => l.chat_id),
    })),
    chats: chats.results.map((c) => ({
      chat_id: c.chat_id,
      title: c.title,
      username: c.username,
      is_active: c.is_active === 1,
      is_group: c.chat_id < 0,
      is_admin: adminSet.has(c.chat_id),
    })),
    credentials: {
      eschool_login: login ? maskLogin(login) : null,
      eschool_password: !!vaultList.eschool_password,
      google_session_updated_at: vaultList.google_session ?? null,
      google_email: vaultList.google_email ? await vault.get('google_email') : null,
      google_password: !!vaultList.google_password,
    },
    google: {
      client_id: google?.client_id ?? null,
      has_secret: !!google?.client_secret,
      connected: !!google?.refresh_token,
      email: google?.email ?? null,
      connected_at: google?.connected_at ?? null,
      redirect_uri: callbackUrl(origin),
    },
    server,
    robot,
  };
}

async function robotRoutes(request: Request, env: ApiEnv, path: string, fetchImpl?: typeof fetch): Promise<Response> {
  if (!(await bearerMatches(request, await robotToken(env.TELEGRAM_BOT_TOKEN)))) {
    return reply(request, { ok: false, error: 'unauthorized' }, 401);
  }
  const db = env.DB;
  const vault = new Vault(db, env.TELEGRAM_BOT_TOKEN);

  if (path === '/robot/config' && request.method === 'GET') {
    const [login, password, google, state, list, oauth, gEmail, gPassword] = await Promise.all([
      vault.get('eschool_login'),
      vault.get('eschool_password'),
      vault.get('google_session'),
      vault.get('robot_state'),
      vault.list(),
      loadGoogle(vault),
      vault.get('google_email'),
      vault.get('google_password'),
    ]);
    // Робот потрібен лише для Google Класу через браузер (пароль або сесія).
    // Єдину школу і Google (через вхід Google на сторінці) Worker читає сам.
    const skip = !!oauth?.refresh_token || (!google && !(gEmail && gPassword));
    return reply(request, {
      ok: true,
      skip,
      google: gEmail && gPassword ? { email: gEmail, password: gPassword } : null,
      google_updated_at: gPassword ? (list.google_password ?? null) : null,
      eschool: login && password ? { login, password } : null,
      google_session: google ? JSON.parse(google) : null,
      google_session_updated_at: list.google_session ?? null,
      state: state ? JSON.parse(state) : null,
      settings: await getSettings(db),
    });
  }

  if (path === '/robot/report' && request.method === 'POST') {
    const body = await readBody(request);
    const snap = body.snapshot as {
      generatedAt?: unknown;
      errors?: RobotStatus['errors'];
      classroom?: { assignments?: unknown[]; submissions?: unknown[] } | null;
      grades?: unknown[] | null;
    };
    if (!snap || typeof snap !== 'object' || typeof snap.generatedAt !== 'string') {
      throw new HttpError(400, 'snapshot: некоректний');
    }
    const status: RobotStatus = {
      generatedAt: snap.generatedAt,
      receivedAt: new Date().toISOString(),
      errors: snap.errors && typeof snap.errors === 'object' ? snap.errors : {},
      counts: {
        assignments: snap.classroom?.assignments?.length ?? 0,
        submissions: snap.classroom?.submissions?.length ?? 0,
        grades: snap.grades?.length ?? 0,
      },
    };
    await vault.set('robot_snapshot', JSON.stringify(snap));
    if (body.state && typeof body.state === 'object') await vault.set('robot_state', JSON.stringify(body.state));
    await setJson(db, 'robot_status', status);
    // Нові дані робота → перевірка і сповіщення в Telegram.
    const r = await runServerCheck(env, { reason: 'robot', fetch: fetchImpl });
    return reply(request, { ok: true, alerts: r.status?.alerts ?? 0 });
  }

  if (path === '/robot/notify' && request.method === 'POST') {
    const text = clean((await readBody(request)).text, 1000, 'text');
    if (!text) throw new HttpError(400, 'text: порожньо');
    const { results } = await db
      .prepare('SELECT a.chat_id FROM admins a JOIN telegram_chats t ON t.chat_id = a.chat_id WHERE t.is_active = 1')
      .all<{ chat_id: number }>();
    for (const r of results) await sendMessage({ db, botToken: env.TELEGRAM_BOT_TOKEN, fetch: fetchImpl }, r.chat_id, `🤖 ${text}`);
    return reply(request, { ok: true, sent: results.length });
  }

  return reply(request, { ok: false, error: 'not found' }, 404);
}
