/**
 * Вхід на сторінку налаштувань через Telegram.
 *
 *  1. Сторінка: POST /api/auth/start → { request_id, url } (url = t.me/<бот>?start=login_<nonce>).
 *  2. Людина відкриває url, Telegram надсилає боту «/start login_<nonce>».
 *     Бот підтверджує вхід, якщо чат — адміністратор (або адміністраторів ще немає:
 *     тоді цей приватний чат стає першим адміністратором).
 *  3. Сторінка опитує POST /api/auth/poll { request_id } і отримує токен сесії.
 *
 * request_id знає лише сторінка, nonce — лише посилання; у базі — тільки їхні SHA-256.
 */
import { bearer, randomHex, sha256Hex } from './crypto';
import { sqlTime } from './time';

export const LOGIN_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_PREFIX = 'login_';

export async function startLogin(db: D1Database, botUsername: string, now = new Date()) {
  const requestId = randomHex(32);
  const nonce = randomHex(16);
  const expiresAt = sqlTime(new Date(now.getTime() + LOGIN_TTL_MS));
  await db.batch([
    // Прибирання старих запитів.
    db.prepare('DELETE FROM admin_logins WHERE expires_at < ?').bind(sqlTime(new Date(now.getTime() - 86_400_000))),
    db
      .prepare('INSERT INTO admin_logins (request_hash, nonce_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(requestId), await sha256Hex(nonce), sqlTime(now), expiresAt),
  ]);
  return { requestId, url: `https://t.me/${botUsername}?start=${LOGIN_PREFIX}${nonce}`, expiresAt };
}

export type ApproveResult = 'approved' | 'became_admin' | 'not_admin' | 'not_private' | 'invalid';

/** Викликається ботом на «/start login_<nonce>». Чат уже має бути в telegram_chats. */
export async function approveLogin(
  db: D1Database,
  chatId: number,
  chatType: string,
  nonce: string,
  now = new Date(),
): Promise<ApproveResult> {
  if (!/^[0-9a-f]{32}$/.test(nonce)) return 'invalid';
  const login = await db
    .prepare('SELECT id FROM admin_logins WHERE nonce_hash = ? AND approved_at IS NULL AND expires_at > ?')
    .bind(await sha256Hex(nonce), sqlTime(now))
    .first<{ id: number }>();
  if (!login) return 'invalid';
  if (chatType !== 'private') return 'not_private';

  let result: ApproveResult = 'approved';
  const isAdmin = await db.prepare('SELECT 1 AS x FROM admins WHERE chat_id = ?').bind(chatId).first();
  if (!isAdmin) {
    // Перший адміністратор: вставка лише якщо таблиця порожня (атомарно).
    const ins = await db
      .prepare('INSERT INTO admins (chat_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM admins)')
      .bind(chatId)
      .run();
    if (!ins.meta.changes) return 'not_admin';
    result = 'became_admin';
  }
  await db
    .prepare('UPDATE admin_logins SET approved_chat_id = ?, approved_at = ? WHERE id = ? AND approved_at IS NULL')
    .bind(chatId, sqlTime(now), login.id)
    .run();
  return result;
}

export type PollResult = { status: 'pending' } | { status: 'expired' } | { status: 'ok'; token: string; chatId: number };

export async function pollLogin(db: D1Database, requestId: unknown, now = new Date()): Promise<PollResult> {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{64}$/.test(requestId)) return { status: 'expired' };
  const row = await db
    .prepare(
      'SELECT id, expires_at, approved_chat_id, consumed_at FROM admin_logins WHERE request_hash = ?',
    )
    .bind(await sha256Hex(requestId))
    .first<{ id: number; expires_at: string; approved_chat_id: number | null; consumed_at: string | null }>();
  if (!row || row.consumed_at) return { status: 'expired' };
  if (row.approved_chat_id === null) {
    return row.expires_at > sqlTime(now) ? { status: 'pending' } : { status: 'expired' };
  }
  // Одноразово: лише один опит забирає підтверджений вхід.
  const consumed = await db
    .prepare('UPDATE admin_logins SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL RETURNING id')
    .bind(sqlTime(now), row.id)
    .first();
  if (!consumed) return { status: 'expired' };
  const token = randomHex(32);
  const ins = await db
    .prepare(
      `INSERT INTO admin_sessions (token_hash, chat_id, created_at, expires_at)
       SELECT ?, chat_id, ?, ? FROM admins WHERE chat_id = ?`,
    )
    .bind(await sha256Hex(token), sqlTime(now), sqlTime(new Date(now.getTime() + SESSION_TTL_MS)), row.approved_chat_id)
    .run();
  return ins.meta.changes ? { status: 'ok', token, chatId: row.approved_chat_id } : { status: 'expired' };
}

export interface Session {
  chatId: number;
  tokenHash: string;
}

/** Перевіряє Bearer-токен сесії. */
export async function authenticate(db: D1Database, request: Request, now = new Date()): Promise<Session | null> {
  const token = bearer(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.chat_id FROM admin_sessions s JOIN admins a ON a.chat_id = s.chat_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, sqlTime(now))
    .first<{ chat_id: number }>();
  if (!row) return null;
  await db.prepare('UPDATE admin_sessions SET last_used_at = ? WHERE token_hash = ?').bind(sqlTime(now), tokenHash).run();
  return { chatId: row.chat_id, tokenHash };
}

export async function logout(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function logoutChat(db: D1Database, chatId: number): Promise<number> {
  const r = await db.prepare('DELETE FROM admin_sessions WHERE chat_id = ?').bind(chatId).run();
  return r.meta.changes ?? 0;
}
