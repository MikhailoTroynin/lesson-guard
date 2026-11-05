/** У веб-демо вхід Google не підтримується — дані беруться з демо-сценарію. */
export const googleAuthSupported = false;

const unsupported = () => new Error('Вхід Google доступний лише в Android-додатку.');

export async function signInGoogle(): Promise<string | null> {
  throw unsupported();
}
export async function signOutGoogle(): Promise<void> {}
export function googleEmail(): string | null {
  return null;
}
export function isGoogleConnected(): boolean {
  return false;
}
export async function getGoogleAccessToken(): Promise<string> {
  throw unsupported();
}
export async function invalidateGoogleToken(_token: string): Promise<void> {}
