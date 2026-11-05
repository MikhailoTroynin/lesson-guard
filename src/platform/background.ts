import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { performSync } from '../services/sync';

export const SYNC_TASK = 'lesson-guard-sync';
/** Хвилини між фоновими перевірками (Android сам вирішує точний час). */
const INTERVAL_MINUTES = 4 * 60;

// defineTask має виконатися на верхньому рівні модуля, ще до рендеру.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await performSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
  if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) {
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: INTERVAL_MINUTES });
  }
}

/** На Android екран оновлюється при поверненні в додаток (AppState 'active'). */
export function onBackgroundSync(_fn: () => void): () => void {
  return () => {};
}
