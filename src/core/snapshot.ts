import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { Assignment, Grade, Submission } from './types';

/**
 * Що робот (robot/run.ts) зібрав за один запуск у GitHub Actions.
 * `null` у джерела означає, що його не вдалося прочитати — причина в `errors`.
 */
export interface RobotSnapshot {
  version: 1;
  generatedAt: string;
  classroom: { assignments: Assignment[]; submissions: Submission[] } | null;
  grades: Grade[] | null;
  /** Помилки по джерелах: { classroom: '…', eschool: '…' }. */
  errors: { classroom?: string; eschool?: string };
}

/**
 * Зашифрований файл. Репозиторій публічний, тому дані дитини лежать у ньому
 * лише в такому вигляді: AES-256-GCM, ключ — PBKDF2-SHA256 від пароля робота.
 */
export interface Envelope {
  v: 1;
  alg: 'A256GCM-PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

export const PBKDF2_ITERATIONS = 100_000;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : -1));
    out[o++] = (n[0] << 2) | (n[1] >> 4);
    if (n[2] >= 0) out[o++] = ((n[1] & 15) << 4) | (n[2] >> 2);
    if (n[3] >= 0) out[o++] = ((n[2] & 3) << 6) | n[3];
  }
  return out.slice(0, o);
}

const keyCache = new Map<string, Uint8Array>();

function deriveKey(passphrase: string, salt: Uint8Array, iter: number): Uint8Array {
  const cacheKey = `${iter}:${toBase64(salt)}:${passphrase}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = pbkdf2(sha256, new TextEncoder().encode(passphrase), salt, { c: iter, dkLen: 32 });
    keyCache.clear();
    keyCache.set(cacheKey, key);
  }
  return key;
}

export function encryptText(
  plain: string,
  passphrase: string,
  randomBytes: (n: number) => Uint8Array,
  iter = PBKDF2_ITERATIONS,
): Envelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const data = gcm(deriveKey(passphrase, salt, iter), iv).encrypt(new TextEncoder().encode(plain));
  return { v: 1, alg: 'A256GCM-PBKDF2-SHA256', iter, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Не вдалося розшифрувати дані робота: перевірте пароль робота.');
    this.name = 'WrongPassphraseError';
  }
}

export function decryptText(env: Envelope, passphrase: string): string {
  if (env?.v !== 1 || env.alg !== 'A256GCM-PBKDF2-SHA256') {
    throw new Error('Невідомий формат файлу робота.');
  }
  const salt = fromBase64(env.salt);
  try {
    const plain = gcm(deriveKey(passphrase, salt, env.iter), fromBase64(env.iv)).decrypt(fromBase64(env.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}
