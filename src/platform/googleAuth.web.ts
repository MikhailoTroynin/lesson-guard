/**
 * Вхід Google у браузері (GitHub Pages) через Google Identity Services, token flow.
 *
 * Потрібен OAuth client ID типу «Web application» з Authorized JavaScript origin
 * https://mikhailotroynin.github.io (або іншим доменом, де відкрито сайт).
 * ID береться зі збірки (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) або вводиться в налаштуваннях.
 *
 * Access token живе ~1 год і зберігається лише в цьому браузері (localStorage).
 * Коли він спливає, новий отримуємо через коротке спливаюче вікно Google — це можливо
 * лише після дії користувача (натискання кнопки), тому автоматична перевірка
 * у фоні тоді попросить натиснути «Перевірити зараз».
 */
import { GOOGLE_SCOPES } from '../providers/classroom/google';

export const googleAuthSupported = true;

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SESSION_KEY = 'lg.google.session';
const CLIENT_ID_KEY = 'lg.google.clientId';
const WEB_SCOPES = [...GOOGLE_SCOPES, 'https://www.googleapis.com/auth/userinfo.email'];

interface Session {
  email: string | null;
  accessToken: string | null;
  /** epoch ms */
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readSession(): Session | null {
  try {
    const raw = ls()?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null): void {
  try {
    if (s) ls()?.setItem(SESSION_KEY, JSON.stringify(s));
    else ls()?.removeItem(SESSION_KEY);
  } catch {
    // приватний режим тощо — працюємо без збереження
  }
}

/** Client ID: зі збірки або введений вручну в налаштуваннях. */
export function getWebClientId(): string {
  const built = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  if (built) return built;
  try {
    return ls()?.getItem(CLIENT_ID_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Чи client ID зашитий у збірку (тоді поле вводу не показуємо). */
export const webClientIdFromBuild = !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();

export function setWebClientId(id: string): void {
  try {
    if (id.trim()) ls()?.setItem(CLIENT_ID_KEY, id.trim());
    else ls()?.removeItem(CLIENT_ID_KEY);
  } catch {
    // ignore
  }
}

let gisPromise: Promise<GoogleOAuth2> | null = null;

/** Завантажує скрипт Google Identity Services (один раз). */
export function loadGoogleIdentity(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('Google Identity Services не завантажився.'));
    };
    script.onerror = () => {
      gisPromise = null;
      reject(new Error('Не вдалося завантажити скрипт входу Google. Перевірте інтернет або блокувальник реклами.'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

function popupError(type: string): Error {
  switch (type) {
    case 'popup_closed':
      return new Error('Вікно входу Google закрито.');
    case 'popup_failed_to_open':
      return new Error('Браузер заблокував вікно входу Google. Дозвольте спливаючі вікна для цього сайту.');
    default:
      return new Error(`Помилка входу Google: ${type}`);
  }
}

/** Відкриває вікно Google і повертає токен. Викликати лише після дії користувача. */
async function requestToken(prompt: string, loginHint?: string | null): Promise<{ token: string; expiresAt: number }> {
  const clientId = getWebClientId();
  if (!clientId) throw new Error('Вкажіть OAuth Client ID (Web) у налаштуваннях Google Класу.');
  const oauth2 = await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: WEB_SCOPES.join(' '),
      include_granted_scopes: true,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(`Google: ${r.error_description || r.error || 'немає токена'}`));
          return;
        }
        if (!oauth2.hasGrantedAllScopes(r, ...GOOGLE_SCOPES)) {
          reject(
            new Error('Потрібно дозволити доступ до Google Класу та Google Диска (поставте всі галочки у вікні Google).'),
          );
          return;
        }
        resolve({ token: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 });
      },
      error_callback: (e) => reject(popupError(e.type)),
    });
    client.requestAccessToken({ prompt, ...(loginHint ? { login_hint: loginHint } : {}) });
  });
}

async function fetchEmail(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

/** Вхід у Google-акаунт дитини. Повертає email або null, якщо вхід скасовано. */
export async function signInGoogle(): Promise<string | null> {
  let res: { token: string; expiresAt: number };
  try {
    res = await requestToken('consent', readSession()?.email);
  } catch (e) {
    if (e instanceof Error && e.message === 'Вікно входу Google закрито.') return null;
    throw e;
  }
  const email = await fetchEmail(res.token);
  writeSession({ email, accessToken: res.token, expiresAt: res.expiresAt });
  return email ?? 'акаунт Google';
}

export async function signOutGoogle(): Promise<void> {
  const s = readSession();
  writeSession(null);
  if (s?.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(s.accessToken);
  }
}

export function googleEmail(): string | null {
  return readSession()?.email ?? null;
}

export function isGoogleConnected(): boolean {
  return !!readSession();
}

/** Коли спливає поточний токен (epoch ms) або null. */
export function googleTokenExpiresAt(): number | null {
  const s = readSession();
  return s?.accessToken ? s.expiresAt : null;
}

function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  // Старі браузери без API: пробуємо — у гіршому разі вікно буде заблоковане.
  return ua ? ua.isActive : true;
}

/** Дійсний access token. Якщо спливає — тихо оновлює через вікно Google (лише після натискання). */
export async function getGoogleAccessToken(): Promise<string> {
  const s = readSession();
  if (!s) throw new Error('Google-акаунт не підключено.');
  if (s.accessToken && s.expiresAt - 60_000 > Date.now()) return s.accessToken;
  if (!hasUserActivation()) {
    throw new Error('Сесія Google завершилась (діє 1 год). Натисніть «Перевірити зараз», щоб оновити її.');
  }
  try {
    const res = await requestToken('', s.email);
    writeSession({ ...s, accessToken: res.token, expiresAt: res.expiresAt });
    return res.token;
  } catch (e) {
    throw new Error(
      `Сесія Google завершилась, оновити не вдалося: ${e instanceof Error ? e.message : String(e)} ` +
        'Увійдіть знову в налаштуваннях.',
    );
  }
}

export async function invalidateGoogleToken(token: string): Promise<void> {
  const s = readSession();
  if (s && s.accessToken === token) writeSession({ ...s, accessToken: null, expiresAt: 0 });
}
