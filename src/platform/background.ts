import { storage } from './storage';
import { performSync } from '../services/sync';

/** Як часто перевіряти, поки вкладка відкрита. */
const INTERVAL_MS = 30 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/** Підписка на завершення автоматичної перевірки (щоб оновити екран). */
export function onBackgroundSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * У браузері справжніх фонових задач немає: перевіряємо раз на 30 хв, поки сторінка відкрита.
 * У демо-режимі нічого не робимо — там дні гортаються вручну.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      if ((await storage.getSettings()).demoMode) return;
      await performSync();
    } catch {
      // помилка вже записана в meta або буде показана при наступній ручній перевірці
    }
    listeners.forEach((fn) => fn());
  }, INTERVAL_MS);
}
