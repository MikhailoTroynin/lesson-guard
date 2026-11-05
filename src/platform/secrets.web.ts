/**
 * У веб-демо зашифрованого сховища немає. Справжні паролі в браузері не зберігаємо —
 * значення живуть лише до перезавантаження сторінки.
 */
const memory = new Map<string, string>();

export const secrets = {
  get: async (key: string) => memory.get(key) ?? null,
  set: async (key: string, value: string) => {
    memory.set(key, value);
  },
  remove: async (key: string) => {
    memory.delete(key);
  },
};
