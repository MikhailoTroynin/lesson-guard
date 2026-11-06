/**
 * Lesson Guard — Cloudflare Worker (скелет).
 *
 *   GET  /health            перевірка, що Worker живий
 *   POST /telegram/webhook  вебхук Telegram; приймає запит лише з правильним
 *                           заголовком X-Telegram-Bot-Api-Secret-Token
 *
 * Бізнес-логіки поки немає: вебхук лише перевіряє секрет і відповідає 200.
 */

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

const WEBHOOK_PATH = '/telegram/webhook';
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Порівняння рядків за сталий час (через SHA-256, щоб довжина не впливала). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    // Секрет не налаштовано — не приймаємо нічого, щоб не відкрити вебхук для всіх.
    return json({ ok: false, error: 'webhook not configured' }, 503);
  }
  const received = request.headers.get(SECRET_HEADER) ?? '';
  if (!(await safeEqual(received, expected))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // TODO: обробка оновлень Telegram (поза межами скелета).
  // Telegram чекає 2xx, інакше повторює доставку.
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

    return json({ ok: false, error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
