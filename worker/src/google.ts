/**
 * Підключення Google-акаунта дитини через OAuth (без робота і без нічого на комп'ютері).
 *
 * 1. На сторінці налаштувань вводяться Client ID і Client secret OAuth-клієнта
 *    типу «Web application» з Google Cloud Console (зберігаються у vault).
 * 2. «Увійти через Google» → POST /api/google/start → посилання на accounts.google.com
 *    з state (одноразовий, 15 хв) і redirect_uri = <Worker>/oauth/google/callback.
 * 3. Google повертає на callback код → обмінюємо на refresh token, запам'ятовуємо email
 *    і повертаємо людину на сторінку налаштувань.
 * 4. Далі перевірка (src/check.ts) сама отримує access token з refresh token.
 */
import { randomHex, sha256Hex } from './crypto';
import { getJson, setJson } from './settings';
import type { Vault } from './vault';

export const GOOGLE_CALLBACK_PATH = '/oauth/google/callback';
export const PAGE_URL = 'https://mikhailotroynin.github.io/lesson-guard/settings';

/** Лише читання: курси, свої завдання й здачі, вміст прикріплених файлів, email. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const STATE_KEY = 'google_oauth_state';
const STATE_TTL_MS = 15 * 60 * 1000;

export interface GoogleOAuth {
  client_id: string;
  client_secret: string;
  refresh_token?: string;
  email?: string | null;
  connected_at?: string;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** true — refresh token більше не діє, треба увійти заново. */
    readonly revoked = false,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export async function loadGoogle(vault: Vault): Promise<GoogleOAuth | null> {
  const raw = await vault.get('google_oauth');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleOAuth;
  } catch {
    return null;
  }
}

export const saveGoogle = (vault: Vault, g: GoogleOAuth | null) =>
  vault.set('google_oauth', g ? JSON.stringify(g) : null);

export function callbackUrl(workerOrigin: string): string {
  return `${workerOrigin}${GOOGLE_CALLBACK_PATH}`;
}

/** Створює одноразовий state і повертає адресу входу Google. */
export async function startGoogleLogin(db: D1Database, g: GoogleOAuth, workerOrigin: string, now = new Date()): Promise<string> {
  const state = randomHex(24);
  await setJson(db, STATE_KEY, { hash: await sha256Hex(state), expires: now.getTime() + STATE_TTL_MS });
  const q = new URLSearchParams({
    client_id: g.client_id,
    redirect_uri: callbackUrl(workerOrigin),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    // consent — щоб Google щоразу видавав refresh token (інакше лише при першому вході).
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type Fetch = typeof fetch;

async function tokenRequest(doFetch: Fetch, params: Record<string, string>) {
  const res = await doFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  return { status: res.status, data };
}

/** Обробляє повернення з Google. Повертає адресу, куди перенаправити людину. */
export async function handleGoogleCallback(
  url: URL,
  db: D1Database,
  vault: Vault,
  doFetch: Fetch = fetch,
  now = new Date(),
): Promise<string> {
  const back = (status: string) => `${PAGE_URL}?google=${encodeURIComponent(status)}`;
  const state = url.searchParams.get('state') ?? '';
  const saved = await getJson<{ hash: string; expires: number }>(db, STATE_KEY);
  if (!state || !saved || saved.expires < now.getTime() || saved.hash !== (await sha256Hex(state))) {
    return back('expired');
  }
  await setJson(db, STATE_KEY, { hash: '', expires: 0 }); // одноразовий

  const err = url.searchParams.get('error');
  if (err) return back(err === 'access_denied' ? 'denied' : `error:${err}`);
  const code = url.searchParams.get('code');
  const g = await loadGoogle(vault);
  if (!code || !g) return back('error:no_code');

  const { status, data } = await tokenRequest(doFetch, {
    code,
    client_id: g.client_id,
    client_secret: g.client_secret,
    redirect_uri: callbackUrl(url.origin),
    grant_type: 'authorization_code',
  });
  if (status !== 200 || !data.access_token) {
    console.error('Google token exchange:', status, data.error, data.error_description);
    return back(`error:${data.error ?? status}`);
  }
  const granted = new Set((data.scope ?? '').split(/\s+/));
  const missing = GOOGLE_SCOPES.filter((s) => s !== 'openid' && !s.endsWith('userinfo.email') && !granted.has(s));
  if (missing.length) return back('scopes');
  const refresh = data.refresh_token ?? g.refresh_token;
  if (!refresh) return back('error:no_refresh_token');

  let email: string | null = null;
  try {
    const r = await doFetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${data.access_token}` },
    });
    if (r.ok) email = ((await r.json()) as { email?: string }).email ?? null;
  } catch {
    // email необов'язковий
  }
  await saveGoogle(vault, { ...g, refresh_token: refresh, email, connected_at: now.toISOString() });
  return back('ok');
}

/** Новий access token з refresh token. */
export async function googleAccessToken(g: GoogleOAuth, doFetch: Fetch = fetch): Promise<string> {
  if (!g.refresh_token) throw new GoogleAuthError('Google-акаунт не підключено', true);
  const { status, data } = await tokenRequest(doFetch, {
    client_id: g.client_id,
    client_secret: g.client_secret,
    refresh_token: g.refresh_token,
    grant_type: 'refresh_token',
  });
  if (status === 200 && data.access_token) return data.access_token;
  if (data.error === 'invalid_grant') {
    throw new GoogleAuthError(
      'Google відкликав доступ (змінено пароль, доступ скасовано або застосунок у режимі Testing довше 7 днів). Увійдіть через Google на сторінці налаштувань ще раз.',
      true,
    );
  }
  if (data.error === 'invalid_client' || data.error === 'unauthorized_client') {
    throw new GoogleAuthError('Google не прийняв Client ID / Client secret. Перевірте їх на сторінці налаштувань.', true);
  }
  throw new GoogleAuthError(`Google: не вдалося оновити токен (${data.error ?? status})`);
}
