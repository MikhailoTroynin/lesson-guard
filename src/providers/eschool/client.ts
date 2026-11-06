import type { Grade } from '../../core/types';
import { ProviderNotConfiguredError, type GradesProvider } from '../types';
import { appointmentsToGrades, type EsAppointment } from './parse';

export interface EschoolCredentials {
  login: string;
  password: string;
}

/** Де зберігати токен між перевірками, щоб не входити щоразу заново. */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

const SITE = 'https://eschool-ua.com';
const DIARY = 'https://diary.eschool-ua.com';

/**
 * Вхід на eschool-ua.com — це Next.js server action `loginAction`. Його id змінюється
 * з кожним оновленням сайту, тому, якщо відомий id не спрацював, знаходимо новий
 * у JS-файлах сторінки входу.
 */
export const KNOWN_LOGIN_ACTION_ID = '7f664ead4908be6295e3115c2b089b23b98f84af61';

export class EschoolLoginError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'EschoolLoginError';
  }
}

type FetchFn = typeof fetch;

interface ActionResult {
  ok?: boolean;
  error?: { code?: string };
}

/** Розбирає відповідь server action (формат React Flight: рядки `id:json`). */
export function parseActionResponse(text: string): ActionResult | null {
  const rows = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]+):(.*)$/.exec(line);
    if (m && !rows.has(m[1])) rows.set(m[1], m[2]);
  }
  let ref = '1';
  try {
    const head = JSON.parse(rows.get('0') ?? '{}') as { a?: string };
    if (typeof head.a === 'string' && head.a.startsWith('$@')) ref = head.a.slice(2);
  } catch {
    // беремо рядок 1 за замовчуванням
  }
  const row = rows.get(ref);
  if (!row || row.startsWith('E')) return null;
  try {
    const v = JSON.parse(row) as unknown;
    return v && typeof v === 'object' ? (v as ActionResult) : null;
  } catch {
    return null;
  }
}

/** Дістає токен щоденника з заголовків Set-Cookie (кілька cookie склеюються через кому). */
export function tokenFromSetCookie(header: string | null): string | null {
  if (!header) return null;
  const m = /(?:^|[\s,;])application_token=([^;,\s]+)/.exec(header);
  return m && m[1] && m[1] !== 'deleted' ? decodeURIComponent(m[1]) : null;
}

/** Шукає актуальний id `loginAction` у JS-файлах сторінки входу. */
export async function discoverLoginActionId(fetchFn: FetchFn): Promise<string | null> {
  const html = await (await fetchFn(`${SITE}/login`)).text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"'\s]+?\.js/g) ?? [])];
  // Спершу файли сторінки входу — action майже напевно там.
  chunks.sort((a, b) => Number(/login/i.test(b)) - Number(/login/i.test(a)));
  const re = /createServerReference\)?\(\s*"([0-9a-f]{20,})"[^)]*?"loginAction"/;
  for (const c of chunks.slice(0, 50)) {
    try {
      const js = await (await fetchFn(`${SITE}${c}`)).text();
      const m = re.exec(js);
      if (m) return m[1];
    } catch {
      // пропускаємо файл, що не завантажився
    }
  }
  return null;
}

const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: 'неправильний логін або пароль',
  rate_limited: 'забагато спроб входу, зачекайте хвилину',
  validation: 'вкажіть логін і пароль',
};

let cachedActionId: string | null = null;

async function callLoginAction(
  fetchFn: FetchFn,
  actionId: string,
  creds: EschoolCredentials,
): Promise<{ result: ActionResult | null; token: string | null; status: number }> {
  // Поля форми мають іти раніше за кореневий рядок «0» — інакше сервер їх не бачить.
  const body = new FormData();
  body.append('1_username', creds.login.trim());
  body.append('1_password', creds.password);
  body.append('0', JSON.stringify([{ ok: true }, '$K1']));
  const res = await fetchFn(`${SITE}/login`, {
    method: 'POST',
    headers: { 'Next-Action': actionId, Accept: 'text/x-component' },
    body,
  });
  const text = await res.text();
  return { result: parseActionResponse(text), token: tokenFromSetCookie(res.headers.get('set-cookie')), status: res.status };
}

/**
 * Вхід у «Єдину школу». Повертає токен для API щоденника або `''`, якщо сервер
 * поклав його лише в cookie (тоді запити щоденника йдуть із cookie).
 */
export async function eschoolLogin(creds: EschoolCredentials, fetchFn: FetchFn = fetch): Promise<string> {
  if (!creds.login.trim() || !creds.password) throw new EschoolLoginError(LOGIN_ERRORS.validation, 'validation');
  let id = cachedActionId ?? KNOWN_LOGIN_ACTION_ID;
  let r = await callLoginAction(fetchFn, id, creds);
  if (!r.result) {
    // Сайт оновився і старий id більше не існує — шукаємо новий.
    const fresh = await discoverLoginActionId(fetchFn).catch(() => null);
    if (fresh && fresh !== id) {
      id = fresh;
      r = await callLoginAction(fetchFn, id, creds);
    }
  }
  if (!r.result) throw new EschoolLoginError(`сайт Єдиної школи не прийняв вхід (HTTP ${r.status})`, 'unknown');
  cachedActionId = id;
  if (r.result.ok === false) {
    const code = r.result.error?.code ?? 'unknown';
    throw new EschoolLoginError(LOGIN_ERRORS[code] ?? `вхід не вдався (${code})`, code);
  }
  return r.token ?? '';
}

interface Profile {
  Id?: number;
  SchoolId?: number;
}

class AuthExpired extends Error {}

function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Клієнт «Єдиної школи»: вхід логіном і паролем дитини (як на eschool-ua.com),
 * далі — ті самі запити до diary.eschool-ua.com, що робить вебверсія щоденника.
 */
export class EschoolGradesProvider implements GradesProvider {
  constructor(
    private credentials: EschoolCredentials,
    private fetchFn: FetchFn = (input, init) => fetch(input, init),
    private tokens?: TokenStore,
    private retryDelayMs = 2000,
  ) {}

  private async api<T>(token: string, path: string): Promise<{ status: number; body: T | null }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    const res = await this.fetchFn(`${DIARY}${path}`, { headers });
    if (res.status === 401 || res.status === 403) throw new AuthExpired();
    let body: T | null = null;
    try {
      body = (await res.json()) as T;
    } catch {
      // не JSON
    }
    return { status: res.status, body };
  }

  private async read(token: string, from: Date, to: Date): Promise<Grade[]> {
    // Одразу після входу щоденник іноді ще не «бачить» профіль — даємо кілька спроб.
    let profile: Profile | null = null;
    for (let i = 0; i < 3 && !profile?.SchoolId; i++) {
      if (i > 0) await sleep(this.retryDelayMs);
      const r = await this.api<Profile>(token, '/api/profile');
      if (r.status === 200 && r.body) profile = r.body;
    }
    if (!profile?.SchoolId || !profile.Id) {
      throw new Error('цей акаунт не має профілю учня. Потрібен логін дитини (номер телефону 380…), а не батьків.');
    }
    const q = new URLSearchParams({ start: day(from), end: day(to), embed: 'Rate,Topic', fileRole: 'schoolboy' });
    const r = await this.api<{ Items?: EsAppointment[] }>(
      token,
      `/api/v1/${profile.SchoolId}/SchoolBoy/${profile.Id}/Appointment?${q}`,
    );
    if (r.status !== 200 || !r.body) throw new Error(`не вдалося прочитати оцінки (HTTP ${r.status})`);
    return appointmentsToGrades(r.body.Items ?? []);
  }

  async listGrades(from: Date, to: Date): Promise<Grade[]> {
    if (!this.credentials.login || !this.credentials.password) {
      throw new ProviderNotConfiguredError('Вкажіть логін і пароль Єдиної школи в налаштуваннях.');
    }
    const saved = (await this.tokens?.get()) ?? null;
    if (saved) {
      try {
        return await this.read(saved, from, to);
      } catch (e) {
        if (!(e instanceof AuthExpired)) throw e;
        await this.tokens?.set(null);
      }
    }
    const token = await eschoolLogin(this.credentials, this.fetchFn);
    if (token) await this.tokens?.set(token);
    try {
      return await this.read(token, from, to);
    } catch (e) {
      if (e instanceof AuthExpired) throw new Error('увійшли, але щоденник не прийняв сесію. Спробуйте ще раз пізніше.');
      throw e;
    }
  }
}
