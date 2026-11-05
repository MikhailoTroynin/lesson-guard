import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { decryptText, encryptText, type Envelope } from '../src/core/snapshot';
import type { ItemMemo } from './classroom';

/** Cookies браузера у форматі Playwright `storageState`. */
export type StorageState = { cookies: unknown[]; origins: unknown[] };

/** Пам'ять робота між запусками — зашифрована, лежить поруч зі знімком у гілці robot-data. */
export interface RobotState {
  storageState?: StorageState;
  /** Відбиток GOOGLE_SESSION, який уже застосовано. */
  sessionHash?: string;
  items: Record<string, ItemMemo>;
}

export const rnd = (n: number) => new Uint8Array(randomBytes(n));

export async function writeEncrypted(path: string, data: unknown, passphrase: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(encryptText(JSON.stringify(data), passphrase, rnd)));
}

export async function readEncrypted<T>(path: string, passphrase: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  return JSON.parse(decryptText(JSON.parse(raw) as Envelope, passphrase)) as T;
}

/** GOOGLE_SESSION: зашифрований storageState, який друкує `npm run robot:session`. */
export function decodeSessionSecret(secret: string, passphrase: string): StorageState {
  const env = JSON.parse(Buffer.from(secret.trim(), 'base64').toString('utf8')) as Envelope;
  return JSON.parse(decryptText(env, passphrase)) as StorageState;
}

export function encodeSessionSecret(state: StorageState, passphrase: string): string {
  return Buffer.from(JSON.stringify(encryptText(JSON.stringify(state), passphrase, rnd))).toString('base64');
}

/** Об'єднує cookies: свіжіші (з `b`) перекривають старі з тим самим name+domain+path. */
export function mergeStorage(a: StorageState | undefined, b: StorageState | undefined): StorageState | undefined {
  if (!a) return b;
  if (!b) return a;
  const key = (c: any) => `${c.name}|${c.domain}|${c.path}`;
  const map = new Map<string, unknown>();
  for (const c of a.cookies) map.set(key(c), c);
  for (const c of b.cookies) map.set(key(c), c);
  return { cookies: [...map.values()], origins: b.origins.length ? b.origins : a.origins };
}
