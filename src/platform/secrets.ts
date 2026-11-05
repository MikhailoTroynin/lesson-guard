import * as SecureStore from 'expo-secure-store';

/** Секрети (логін/пароль Єдиної школи) — у зашифрованому сховищі Android. */
export const secrets = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
