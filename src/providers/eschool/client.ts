import type { Grade } from '../../core/types';
import { ProviderNotConfiguredError, type GradesProvider } from '../types';

export interface EschoolCredentials {
  login: string;
  password: string;
}

/**
 * Клієнт «Єдиної школи» через логін батьків.
 *
 * Офіційного API в сервісу немає, тому клієнт має повторювати запити, які робить
 * вебверсія щоденника: вхід → вибір дитини → оцінки за період.
 *
 * TODO(eschool): реалізувати після запису HAR-файлу з DevTools (див. README,
 * розділ «Підключення Єдиної школи»). Потрібні: URL і тіло запиту входу,
 * як передається сесія (cookie/токен), запит списку дітей і запит оцінок.
 */
export class EschoolGradesProvider implements GradesProvider {
  constructor(
    private credentials: EschoolCredentials,
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async listGrades(_from: Date, _to: Date): Promise<Grade[]> {
    if (!this.credentials.login || !this.credentials.password) {
      throw new ProviderNotConfiguredError('Вкажіть логін і пароль Єдиної школи в налаштуваннях.');
    }
    void this.fetchFn;
    throw new ProviderNotConfiguredError(
      'Підключення до Єдиної школи ще не реалізоване. Поки що оцінки доступні лише в демо-режимі.',
    );
  }
}
