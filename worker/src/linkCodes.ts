/**
 * Одноразові коди прив'язки чату до дитини.
 *
 * Код — 10 символів з алфавіту без схожих знаків (0/O, 1/I/L), показується як
 * «ABCDE-FGHJK». У базі зберігається лише hex(SHA-256(нормалізований код)).
 * Код діє 24 години і використовується один раз.
 */
import { sha256Hex } from './crypto';
import { sqlTime } from './time';

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 10;
export const CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Не більше MAX_FAILED_ATTEMPTS невдалих /link з одного чату за ATTEMPT_WINDOW_MS. */
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

/** Випадковий код без зміщення (rejection sampling). */
export function generateCode(random: (n: number) => Uint8Array = defaultRandom): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of random(CODE_LENGTH * 2)) {
      if (b < limit) out += CODE_ALPHABET[b % n];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** «ABCDEFGHJK» → «ABCDE-FGHJK». */
export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Нормалізує введений користувачем код: верхній регістр, без пробілів і дефісів,
 * кирилиця, схожа на латиницю, замінюється. Повертає null, якщо це точно не код.
 */
export function normalizeCode(input: string): string | null {
  const lookalikes: Record<string, string> = {
    А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
  };
  const s = input
    .toUpperCase()
    .replace(/[\s\-–—_.]/g, '')
    .replace(/[АВСЕНКМРТХУ]/g, (ch) => lookalikes[ch] ?? ch);
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export const hashCode = (normalized: string) => sha256Hex(normalized);

export interface CreatedCode {
  code: string; // у форматі ABCDE-FGHJK
  expiresAt: string;
}

export async function createLinkCode(db: D1Database, childId: number, now = new Date()): Promise<CreatedCode> {
  const code = generateCode();
  const expiresAt = sqlTime(new Date(now.getTime() + CODE_TTL_MS));
  await db
    .prepare('INSERT INTO link_codes (code_hash, child_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await hashCode(code), childId, sqlTime(now), expiresAt)
    .run();
  return { code: formatCode(code), expiresAt };
}

export type RedeemResult =
  | { ok: true; childId: number; childName: string; className: string | null }
  | { ok: false; reason: 'invalid' | 'rate_limited' };

/** Скільки невдалих спроб чат зробив у поточному вікні. */
async function recentFailures(db: D1Database, chatId: number, now: Date): Promise<number> {
  const since = sqlTime(new Date(now.getTime() - ATTEMPT_WINDOW_MS));
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM link_attempts WHERE chat_id = ? AND attempted_at > ?')
    .bind(chatId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function recordFailure(db: D1Database, chatId: number, now: Date): Promise<void> {
  const old = sqlTime(new Date(now.getTime() - 24 * ATTEMPT_WINDOW_MS));
  await db.batch([
    db.prepare('INSERT INTO link_attempts (chat_id, attempted_at) VALUES (?, ?)').bind(chatId, sqlTime(now)),
    // Прибирання старих записів, щоб таблиця не росла.
    db.prepare('DELETE FROM link_attempts WHERE attempted_at < ?').bind(old),
  ]);
}

/**
 * Перевіряє код і прив'язує чат до дитини. Чат уже має бути в telegram_chats.
 * Неправильний, прострочений і використаний код дають однакову відповідь 'invalid'.
 */
export async function redeemLinkCode(
  db: D1Database,
  chatId: number,
  input: string,
  now = new Date(),
): Promise<RedeemResult> {
  if ((await recentFailures(db, chatId, now)) >= MAX_FAILED_ATTEMPTS) {
    return { ok: false, reason: 'rate_limited' };
  }
  const normalized = normalizeCode(input);
  if (!normalized) {
    await recordFailure(db, chatId, now);
    return { ok: false, reason: 'invalid' };
  }
  const hash = await hashCode(normalized);
  const ts = sqlTime(now);

  // Обидва запити — в одній транзакції (D1 batch) з однаковою умовою «код
  // дійсний і ще не використаний»: спершу прив'язка, потім позначка про використання.
  const valid = 'code_hash = ? AND used_at IS NULL AND expires_at > ?';
  const [, claimed] = await db.batch<{ child_id: number }>([
    db
      .prepare(`INSERT OR IGNORE INTO chat_children (chat_id, child_id) SELECT ?, child_id FROM link_codes WHERE ${valid}`)
      .bind(chatId, hash, ts),
    db
      .prepare(`UPDATE link_codes SET used_at = ?, used_by_chat_id = ? WHERE ${valid} RETURNING child_id`)
      .bind(ts, chatId, hash, ts),
  ]);
  const childId = claimed?.results?.[0]?.child_id;
  if (childId === undefined) {
    await recordFailure(db, chatId, now);
    return { ok: false, reason: 'invalid' };
  }
  const child = await db
    .prepare('SELECT name, class_name FROM children WHERE id = ?')
    .bind(childId)
    .first<{ name: string; class_name: string | null }>();
  return { ok: true, childId, childName: child?.name ?? '', className: child?.class_name ?? null };
}

/** Знаходить дитину за іменем і класом або створює її. */
export async function findOrCreateChild(
  db: D1Database,
  name: string,
  className: string | null,
): Promise<{ id: number; created: boolean }> {
  const existing = await db
    .prepare('SELECT id FROM children WHERE name = ? AND class_name IS ? ORDER BY id LIMIT 1')
    .bind(name, className)
    .first<{ id: number }>();
  if (existing) return { id: existing.id, created: false };
  const row = await db
    .prepare('INSERT INTO children (name, class_name) VALUES (?, ?) RETURNING id')
    .bind(name, className)
    .first<{ id: number }>();
  if (!row) throw new Error('INSERT children не повернув id');
  return { id: row.id, created: true };
}
