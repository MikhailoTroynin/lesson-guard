import type { ItemMemo } from './classroom';

/** Cookies браузера у форматі Playwright `storageState`. */
export type StorageState = { cookies: unknown[]; origins: unknown[] };

/** Пам'ять робота між запусками — зберігається зашифрованою у Worker'і (D1). */
export interface RobotState {
  storageState?: StorageState;
  /** Коли збережену на сторінці сесію Google уже застосовано (updated_at із Worker'а). */
  sessionAppliedAt?: string;
  /** Google відхилив вхід паролем для цих даних (google_updated_at) — не пробуємо знову, поки їх не змінять. */
  googleRejected?: { for: string; error: string };
  items: Record<string, ItemMemo>;
}

/**
 * Рядок для сторінки налаштувань, який друкує `npm run robot:session`:
 * «lgs1:<base64 JSON storageState>». Шифрує його вже Worker при збереженні.
 */
export function encodeSessionString(state: StorageState): string {
  return `lgs1:${Buffer.from(JSON.stringify(state)).toString('base64')}`;
}

/** Об'єднує cookies: свіжіші (з `b`) перекривають старі з тим самим name+domain+path. */
export function mergeStorage(a: StorageState | undefined, b: StorageState | undefined): StorageState | undefined {
  if (!a) return b;
  if (!b) return a;
  const key = (c: any) => `${c.name}|${c.domain}|${c.path}`;
  const map = new Map<string, unknown>();
  for (const c of a.cookies) map.set(key(c), c);
  for (const c of b.cookies) map.set(key(c), c);
  return { cookies: [...map.values()], origins: b.origins.length ? b.origins : a.origins };
}
