/**
 * Lesson Guard — Cloudflare Worker.
 *
 *   GET  /health            перевірка, що Worker живий
 *   POST /telegram/webhook  вебхук Telegram (лише з правильним
 *                           X-Telegram-Bot-Api-Secret-Token) → src/bot.ts
 *   POST /admin/link-code   створити код прив'язки (лише з GitHub Actions) → src/admin.ts
 *   /api/*                  сторінка налаштувань на GitHub Pages → src/api.ts
 *   /robot/*                хмарний робот (GitHub Actions) → src/api.ts
 *   GET  /oauth/google/callback  повернення після входу через Google → src/google.ts
 *   cron (wrangler.toml)    перевірка Єдиної школи й Google Класу → Telegram (src/check.ts)
 *
 * Окремих секретів, крім токена бота, немає: секрет вебхука й адмін-токен
 * виводяться з TELEGRAM_BOT_TOKEN через HMAC-SHA256 з різними мітками
 * (src/crypto.ts). Те саме обчислюють scripts/set-webhook.mjs і scripts/link-code.mjs.
 */
import { ADMIN_LINK_CODE_PATH, handleAdminLinkCode } from './admin';
import { handleApi } from './api';
import { handleUpdateSafe, type TgUpdate } from './bot';
import { describeStatus, runServerCheck, type CheckEnv } from './check';
import { safeEqual, webhookSecret } from './crypto';
import { GOOGLE_CALLBACK_PATH, handleGoogleCallback } from './google';
import { getSettings, setJson } from './settings';
import { Vault } from './vault';

export type Env = CheckEnv;

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
  waitUntil?: (p: Promise<unknown>) => void,
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
  await handleUpdateSafe(update, {
    db: env.DB,
    botToken: env.TELEGRAM_BOT_TOKEN,
    fetch: fetchImpl,
    defer: waitUntil,
    check: async () => describeStatus((await runServerCheck(env, { reason: 'bot', fetch: fetchImpl })).status),
    getSettings: () => getSettings(env.DB),
    saveSettings: (s) => setJson(env.DB, 'settings', s),
  });
  return json({ ok: true });
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runServerCheck(env, { reason: 'cron' }).then(
        (r) => console.log(`cron: ${r.busy ? 'вже йде' : `подій ${r.status?.alerts ?? 0}`}`),
        (e) => console.error('cron: перевірка впала:', e),
      ),
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
      return handleTelegramWebhook(request, env, undefined, (p) => ctx.waitUntil(p));
    }

    if (pathname === GOOGLE_CALLBACK_PATH && request.method === 'GET') {
      try {
        const to = await handleGoogleCallback(new URL(request.url), env.DB, new Vault(env.DB, env.TELEGRAM_BOT_TOKEN));
        // Одразу перевіряємо, щоб у Telegram прийшло «Google Клас підключено».
        if (to.endsWith('google=ok')) ctx.waitUntil(runServerCheck(env, { reason: 'manual' }).catch((e) => console.error(e)));
        return Response.redirect(to, 302);
      } catch (e) {
        console.error('google callback:', e);
        return json({ ok: false, error: 'internal error' }, 500);
      }
    }

    const api = await handleApi(request, env);
    if (api) return api;

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
