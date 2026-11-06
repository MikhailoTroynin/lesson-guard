/**
 * Клієнт API Cloudflare Worker'а для сторінки налаштувань.
 * Сесія — Bearer-токен, який видається після підтвердження входу в Telegram;
 * зберігається лише в цьому браузері.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RobotSnapshot } from '../core/snapshot';

export const WORKER_URL = (process.env.EXPO_PUBLIC_WORKER_URL || 'https://lesson-guard.mihajlotrojnin.workers.dev').replace(
  /\/+$/,
  '',
);

const TOKEN_KEY = 'lg.session';

export interface ServerSettings {
  badGradeThreshold: number;
  notifyNewAssignments: boolean;
  subjectMap: Record<string, string>;
  matchWindowDays: number;
  gradeLookbackDays: number;
}

export interface RobotStatus {
  generatedAt: string;
  receivedAt: string;
  errors: { classroom?: string; eschool?: string };
  counts: { assignments: number; submissions: number; grades: number };
}

export interface ServerStatus {
  checkedAt: string;
  reason: 'cron' | 'manual' | 'bot' | 'robot';
  sources: { eschool: 'direct' | 'robot' | 'none'; classroom: 'direct' | 'robot' | 'none' };
  errors: { classroom?: string; eschool?: string };
  counts: { assignments: number; submissions: number; grades: number };
  courses?: { refreshed: number; total: number };
  alerts: number;
  recipients: number;
}

export interface GoogleInfo {
  client_id: string | null;
  /** 'server' — клієнт із секретів Worker'а (нічого вводити не треба), 'page' — введений на сторінці. */
  client_source?: 'server' | 'page' | null;
  has_secret: boolean;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  redirect_uri: string;
}

export interface Overview {
  me: { chat_id: number };
  settings: ServerSettings;
  children: { id: number; name: string; class_name: string | null; chat_ids: number[] }[];
  chats: {
    chat_id: number;
    title: string | null;
    username: string | null;
    is_active: boolean;
    is_group: boolean;
    is_admin: boolean;
  }[];
  credentials: {
    eschool_login: string | null;
    eschool_password: boolean;
    google_session_updated_at: string | null;
  };
  google: GoogleInfo;
  server: ServerStatus | null;
  robot: RobotStatus | null;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Сеанс завершився — увійдіть через Telegram ще раз.');
    this.name = 'UnauthorizedError';
  }
}

let tokenCache: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (tokenCache === undefined) tokenCache = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  return tokenCache ?? null;
}

export async function setToken(token: string | null): Promise<void> {
  tokenCache = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (!token) throw new UnauthorizedError();
    headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Немає зв’язку із сервером Lesson Guard. Перевірте інтернет і спробуйте ще раз.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (res.status === 401 && auth) {
    await setToken(null);
    throw new UnauthorizedError();
  }
  if (!res.ok || data.ok === false) throw new Error(data.error ? `Помилка: ${data.error}` : `Помилка сервера (${res.status})`);
  return data;
}

export const api = {
  startLogin: () => call<{ request_id: string; url: string; expires_at: string }>('POST', '/api/auth/start', undefined, false),
  pollLogin: (requestId: string) =>
    call<{ status: 'pending' | 'expired' | 'ok'; token?: string }>('POST', '/api/auth/poll', { request_id: requestId }, false),
  logout: () => call('POST', '/api/auth/logout'),
  overview: () => call<Overview & { ok: true }>('GET', '/api/overview'),
  putSettings: (patch: Partial<ServerSettings>) => call<{ settings: ServerSettings }>('PUT', '/api/settings', patch),
  putCredentials: (patch: {
    eschool_login?: string | null;
    eschool_password?: string | null;
    google_session?: string | null;
  }) => call<{ warning?: string }>('PUT', '/api/credentials', patch),
  check: () => call<{ busy: boolean; server: ServerStatus | null; text: string }>('POST', '/api/check'),
  putGoogleClient: (clientId: string, clientSecret: string) =>
    call('PUT', '/api/google/client', { client_id: clientId, client_secret: clientSecret }),
  googleStart: () => call<{ url: string }>('POST', '/api/google/start'),
  googleDisconnect: () => call('DELETE', '/api/google'),
  /** Запустити workflow GitHub; started=false — треба натиснути «Run workflow» за url. */
  runWorkflow: (workflow: 'google-login' | 'robot') =>
    call<{ started: boolean; url: string; error?: string }>('POST', '/api/actions/run', { workflow }),
  addChild: (name: string, className: string) =>
    call<{ id: number; created: boolean }>('POST', '/api/children', { name, class_name: className || null }),
  deleteChild: (id: number) => call('DELETE', `/api/children/${id}`),
  linkCode: (childId: number) => call<{ code: string; expires_at: string }>('POST', `/api/children/${childId}/link-code`),
  unlink: (chatId: number, childId: number) => call('DELETE', `/api/chats/${chatId}/children/${childId}`),
  setAdmin: (chatId: number, admin: boolean) => call('PUT', `/api/chats/${chatId}/admin`, { admin }),
  snapshot: () =>
    call<{ snapshot: RobotSnapshot | null; settings: ServerSettings; robot: RobotStatus | null }>('GET', '/api/snapshot'),
};

/**
 * Повний вхід: відкриває бота в Telegram і чекає підтвердження.
 * onLink викликається з посиланням (якщо вікно не відкрилося — показати кнопку).
 */
export async function loginWithTelegram(
  onLink: (url: string) => void,
  signal: { cancelled: boolean },
): Promise<boolean> {
  const { request_id, url } = await api.startLogin();
  onLink(url);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline && !signal.cancelled) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await api.pollLogin(request_id);
    if (r.status === 'ok' && r.token) {
      await setToken(r.token);
      return true;
    }
    if (r.status === 'expired') return false;
  }
  return false;
}
