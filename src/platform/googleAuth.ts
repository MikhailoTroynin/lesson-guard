import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { GOOGLE_SCOPES } from '../providers/classroom/google';

export const googleAuthSupported = true;

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({
    scopes: GOOGLE_SCOPES,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
  });
  configured = true;
}

/** Вхід у Google-акаунт дитини. Повертає email або null, якщо вхід скасовано. */
export async function signInGoogle(): Promise<string | null> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    const res = await GoogleSignin.signIn();
    return isSuccessResponse(res) ? res.data.user.email : null;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) return null;
    throw e;
  }
}

export async function signOutGoogle(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut();
}

export function googleEmail(): string | null {
  ensureConfigured();
  return GoogleSignin.getCurrentUser()?.user.email ?? null;
}

export function isGoogleConnected(): boolean {
  ensureConfigured();
  return GoogleSignin.hasPreviousSignIn();
}

/** Свіжий access token; працює й у фоновій задачі (тихий вхід). */
export async function getGoogleAccessToken(): Promise<string> {
  ensureConfigured();
  if (!GoogleSignin.getCurrentUser()) {
    const res = await GoogleSignin.signInSilently();
    if (res.type !== 'success') throw new Error('Потрібно знову увійти в Google-акаунт дитини.');
  }
  return (await GoogleSignin.getTokens()).accessToken;
}

export async function invalidateGoogleToken(token: string): Promise<void> {
  await GoogleSignin.clearCachedAccessToken(token);
}

// Веб-специфічні налаштування (client ID вводиться лише у браузері).
export const webClientIdFromBuild = true;
export function getWebClientId(): string {
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
}
export function setWebClientId(_id: string): void {}
export function googleTokenExpiresAt(): number | null {
  return null;
}
