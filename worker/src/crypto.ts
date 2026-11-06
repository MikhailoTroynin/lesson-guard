/** Криптографічні допоміжні функції (Web Crypto, працюють і в Worker'і, і в Node). */

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** hex(HMAC-SHA256(key, message)). */
export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toHex(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

/** hex(SHA-256(text)). */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Порівняння рядків за сталий час (через SHA-256, щоб довжина не впливала). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Мітки, з яких виводяться секрети з токена бота. Мають збігатися з
 * scripts/set-webhook.mjs і scripts/link-code.mjs.
 */
export const WEBHOOK_SECRET_LABEL = 'lesson-guard:telegram-webhook';
export const ADMIN_TOKEN_LABEL = 'lesson-guard:admin-api';
export const ROBOT_TOKEN_LABEL = 'lesson-guard:robot-api';
export const VAULT_KEY_LABEL = 'lesson-guard:vault-key';

export const webhookSecret = (botToken: string) => hmacHex(botToken, WEBHOOK_SECRET_LABEL);
export const adminToken = (botToken: string) => hmacHex(botToken, ADMIN_TOKEN_LABEL);
export const robotToken = (botToken: string) => hmacHex(botToken, ROBOT_TOKEN_LABEL);

/** Випадковий токен: hex з n байтів. */
export function randomHex(n: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(n)).buffer as ArrayBuffer);
}

/** Перевіряє «Authorization: Bearer <expected>» за сталий час. */
export async function bearerMatches(request: Request, expected: string): Promise<boolean> {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return !!m && (await safeEqual(m[1], expected));
}

/** Токен з «Authorization: Bearer …» або null. */
export function bearer(request: Request): string | null {
  return /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
}
