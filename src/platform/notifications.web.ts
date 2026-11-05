import type { Alert } from '../core/types';

/** У браузері системних сповіщень не показуємо — алерти видно на екрані «Сповіщення». */
export const notificationsSupported = false;

export async function initNotifications(): Promise<void> {}

export async function ensurePermission(): Promise<boolean> {
  return false;
}

export async function showAlertNotifications(_alerts: Alert[]): Promise<void> {}
