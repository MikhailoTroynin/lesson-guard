/**
 * Адмін-API (викликається лише з GitHub Actions).
 *
 *   POST /admin/link-code  { "name": "Олена", "class_name": "7-А" }
 *     Authorization: Bearer <hex(HMAC-SHA256(TELEGRAM_BOT_TOKEN, ADMIN_TOKEN_LABEL))>
 *   → { ok, child: { id, name, class_name, created }, code, expires_at }
 *
 * Створює дитину, якщо її ще немає (збіг за іменем і класом), і новий одноразовий код.
 */
import { adminToken, safeEqual } from './crypto';
import { createLinkCode, findOrCreateChild } from './linkCodes';

export const ADMIN_LINK_CODE_PATH = '/admin/link-code';
const MAX_NAME = 100;
const MAX_CLASS = 20;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function isAdmin(request: Request, botToken: string): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return !!m && (await safeEqual(m[1], await adminToken(botToken)));
}

const clean = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : '');

export async function handleAdminLinkCode(request: Request, db: D1Database, botToken: string): Promise<Response> {
  if (!botToken) return json({ ok: false, error: 'not configured' }, 503);
  if (!(await isAdmin(request, botToken))) return json({ ok: false, error: 'unauthorized' }, 401);

  const body = (await request.json().catch(() => null)) as { name?: unknown; class_name?: unknown } | null;
  const name = clean(body?.name);
  const className = clean(body?.class_name) || null;
  if (!name || name.length > MAX_NAME) {
    return json({ ok: false, error: `name: обов'язкове, до ${MAX_NAME} символів` }, 400);
  }
  if (className && className.length > MAX_CLASS) {
    return json({ ok: false, error: `class_name: до ${MAX_CLASS} символів` }, 400);
  }

  const child = await findOrCreateChild(db, name, className);
  const { code, expiresAt } = await createLinkCode(db, child.id);
  console.log(`link-code: створено код для child_id=${child.id} (нова дитина: ${child.created})`);
  return json({
    ok: true,
    child: { id: child.id, name, class_name: className, created: child.created },
    code,
    expires_at: expiresAt,
  });
}
