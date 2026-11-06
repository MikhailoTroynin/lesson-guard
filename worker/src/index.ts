/**
 * Lesson Guard — Cloudflare Worker (скелет).
 *
 *   GET  /health            перевірка, що Worker живий
 *   POST /telegram/webhook  вебхук Telegram; приймає запит лише з правильним
 *                           заголовком X-Telegram-Bot-Api-Secret-Token
 *
 * Бізнес-логіки поки немає: вебхук лише перевіряє секрет і відповідає 200.
 *
 * Секрет вебхука окремо не зберігається: він виводиться з токена бота
 * (HMAC-SHA256, див. webhookSecret). Те саме обчислює scripts/set-webhook.mjs,
 * коли реєструє вебхук у Telegram після деплою.
 */

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

/** Мітка, з якої виводиться секрет вебхука. Має збігатися з scripts/set-webhook.mjs. */
const WEBHOOK_SECRET_LABEL = 'lesson-guard:telegram-webhook';

/** hex(HMAC-SHA256(key = токен бота, message = WEBHOOK_SECRET_LABEL)). */
async function webhookSecret(botToken: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(botToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(WEBHOOK_SECRET_LABEL));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  if (!env.TELEGRAM_BOT_TOKEN) {
    // Токен не налаштовано — не приймаємо нічого, щоб не відкрити вебхук для всіх.
    return json({ ok: false, error: 'webhook not configured' }, 503);
  }
  const expected = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
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
