import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';

import type { Alert, AlertKind } from '../core/types';

const CHANNELS: Record<AlertKind, { id: string; name: string; importance: AndroidImportance }> = {
  bad_grade: { id: 'bad-grade', name: 'Погані оцінки', importance: AndroidImportance.HIGH },
  empty_submission: {
    id: 'empty-submission',
    name: 'Порожні здані роботи',
    importance: AndroidImportance.HIGH,
  },
  new_assignment: {
    id: 'new-assignment',
    name: 'Нові завдання',
    importance: AndroidImportance.DEFAULT,
  },
};

export const notificationsSupported = true;

export async function initNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  // На Android 13+ запит дозволу з'являється лише після створення каналу.
  for (const c of Object.values(CHANNELS)) {
    await Notifications.setNotificationChannelAsync(c.id, { name: c.name, importance: c.importance });
  }
}

export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function showAlertNotifications(alerts: Alert[]): Promise<void> {
  for (const a of alerts) {
    await Notifications.scheduleNotificationAsync({
      content: { title: a.title, body: a.body, data: { alertId: a.id } },
      trigger: { channelId: CHANNELS[a.kind].id },
    });
  }
}
