import type { Alert } from '../core/types';

/**
 * У браузері — стандартні сповіщення Notification API. Вони показуються,
 * поки вкладка з сайтом відкрита (без service worker).
 */
export const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

export async function ensurePermission(): Promise<boolean> {
  if (!notificationsSupported) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export async function showAlertNotifications(alerts: Alert[]): Promise<void> {
  if (!notificationsSupported || Notification.permission !== 'granted') return;
  for (const a of alerts.slice(0, 5)) {
    try {
      new Notification(a.title, { body: a.body, tag: a.id, icon: '/lesson-guard/favicon.ico' });
    } catch {
      // деякі мобільні браузери дозволяють сповіщення лише через service worker
    }
  }
}
