/**
 * Lesson Guard — Cloudflare Worker.
 *
 *   GET  /health            перевірка, що Worker живий
 *   POST /telegram/webhook  вебхук Telegram (лише з правильним
 *                           X-Telegram-Bot-Api-Secret-Token) → src/bot.ts
 *   POST /admin/link-code   створити код прив'язки (лише з GitHub Actions) → src/admin.ts
 *
 * Окремих секретів, крім токена бота, немає: секрет вебхука й адмін-токен
 * виводяться з TELEGRAM_BOT_TOKEN через HMAC-SHA256 з різними мітками
 * (src/crypto.ts). Те саме обчислюють scripts/set-webhook.mjs і scripts/link-code.mjs.
 */
import { ADMIN_LINK_CODE_PATH, handleAdminLinkCode } from './admin';
import { handleUpdateSafe, type TgUpdate } from './bot';
import { safeEqual, webhookSecret } from './crypto';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
}

const WEBHOOK_PATH = '/telegram/webhook';
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    // Токен не налаштовано — не приймаємо нічого, щоб не відкрити вебхук для всіх.
    return json({ ok: false, error: 'webhook not configured' }, 503);
  }
  const expected = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
  const received = request.headers.get(SECRET_HEADER) ?? '';
  if (!(await safeEqual(received, expected))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Далі завжди 200: інакше Telegram без кінця повторює доставку того самого оновлення.
  let update: TgUpdate;
  try {
    update = await request.json();
  } catch (e) {
    console.error('Вебхук: некоректний JSON:', e);
    return json({ ok: true });
  }
  await handleUpdateSafe(update, { db: env.DB, botToken: env.TELEGRAM_BOT_TOKEN, fetch: fetchImpl });
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      return json({ ok: true, service: 'lesson-guard' });
    }

    if (pathname === WEBHOOK_PATH) {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      return handleTelegramWebhook(request, env);
    }

    if (pathname === ADMIN_LINK_CODE_PATH) {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      try {
        return await handleAdminLinkCode(request, env.DB, env.TELEGRAM_BOT_TOKEN);
      } catch (e) {
        console.error('admin/link-code:', e);
        return json({ ok: false, error: 'internal error' }, 500);
      }
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
