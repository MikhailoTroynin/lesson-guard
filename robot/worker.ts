/**
 * Зв'язок робота з Cloudflare Worker'ом: звідти він бере логіни (їх вводять
 * на сторінці налаштувань), туди ж віддає зібрані дані.
 *
 * Токен робота = hex(HMAC-SHA256(TELEGRAM_BOT_TOKEN, "lesson-guard:robot-api")) —
 * те саме обчислює Worker (worker/src/crypto.ts), окремий секрет не потрібен.
 */
import { createHmac } from 'node:crypto';

import type { RobotSnapshot } from '../src/core/snapshot';
import type { RobotState, StorageState } from './state';

export const ROBOT_TOKEN_LABEL = 'lesson-guard:robot-api';
export const DEFAULT_WORKER_URL = 'https://lesson-guard.mihajlotrojnin.workers.dev';

export interface RobotConfig {
  eschool: { login: string; password: string } | null;
  google_session: StorageState | null;
  /** Email і пароль Google дитини зі сторінки налаштувань. */
  google?: { email: string; password: string } | null;
  google_session_updated_at: string | null;
  /** true — Worker усе читає сам, робот не потрібен. */
  skip?: boolean;
  state: RobotState | null;
}

export class WorkerClient {
  private token: string;

  constructor(
    botToken: string,
    readonly url: string = DEFAULT_WORKER_URL,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.token = createHmac('sha256', botToken).update(ROBOT_TOKEN_LABEL).digest('hex');
    this.url = url.replace(/\/+$/, '');
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(`Worker ${path}: HTTP ${res.status} ${data.error ?? ''}`.trim());
    return data as T;
  }

  config(): Promise<RobotConfig> {
    return this.call<RobotConfig>('GET', '/robot/config');
  }

  /** Повідомлення адміністраторам у Telegram (не кидає помилок). */
  async notify(text: string): Promise<void> {
    await this.call('POST', '/robot/notify', { text }).catch((e) => console.warn(`notify: ${e}`));
  }

  async report(snapshot: RobotSnapshot, state: RobotState): Promise<void> {
    await this.call('POST', '/robot/report', { snapshot, state });
  }
}
