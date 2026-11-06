// Реєструє вебхук Telegram для задеплоєного Worker'а.
// Запускається з GitHub Actions після `wrangler deploy`.
//
//   WORKER_URL          https://lesson-guard.<піддомен>.workers.dev
//   TELEGRAM_BOT_TOKEN  токен бота (лише через env, не через аргументи)
//
// Секрет вебхука = hex(HMAC-SHA256(токен, мітка)) — те саме обчислює Worker.
import { createHmac } from 'node:crypto';

const WEBHOOK_SECRET_LABEL = 'lesson-guard:telegram-webhook';

const token = process.env.TELEGRAM_BOT_TOKEN;
const workerUrl = (process.env.WORKER_URL ?? '').replace(/\/+$/, '');
if (!token) fail('TELEGRAM_BOT_TOKEN порожній.');
if (!/^https:\/\/[^/\s]+$/.test(workerUrl)) fail(`Некоректний WORKER_URL: "${workerUrl}".`);

const secret = createHmac('sha256', token).update(WEBHOOK_SECRET_LABEL).digest('hex');
console.log(`::add-mask::${secret}`);

// 1. Worker живий? Одразу після першого деплою маршрут workers.dev може ще
// кілька секунд віддавати 404, тому повторюємо (до ~90 с).
let lastStatus = '';
for (let attempt = 1; ; attempt++) {
  const res = await fetch(`${workerUrl}/health`).catch((e) => ({ ok: false, status: String(e) }));
  if (res.ok) {
    console.log(`/health: ${await res.text()}`);
    break;
  }
  lastStatus = res.status;
  if (attempt >= 10) fail(`/health не відповідає: ${lastStatus}.`);
  console.log(`/health: ${lastStatus}, повтор через ${attempt * 2} с…`);
  await new Promise((r) => setTimeout(r, attempt * 2000));
}

// 2. Реєстрація вебхука (ідемпотентно).
const webhookUrl = `${workerUrl}/telegram/webhook`;
const set = await telegram('setWebhook', {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ['message', 'my_chat_member'],
});
console.log(`setWebhook: ${set.description ?? 'ok'}`);

// 3. Меню команд бота (кнопка «/» у Telegram).
await telegram('setMyCommands', {
  commands: [
    { command: 'status', description: 'Що з перевірками' },
    { command: 'check', description: 'Перевірити зараз' },
    { command: 'settings', description: 'Налаштування' },
    { command: 'threshold', description: 'Поріг поганої оцінки, напр. /threshold 7' },
    { command: 'new', description: 'Нові завдання: /new on або /new off' },
    { command: 'link', description: 'Прив\'язати дитину кодом' },
    { command: 'children', description: 'Прив\'язані діти' },
    { command: 'stop', description: 'Вимкнути сповіщення в цьому чаті' },
    { command: 'help', description: 'Довідка' },
  ],
});
console.log('setMyCommands: ok');

// 4. Перевірка.
const info = await telegram('getWebhookInfo', {});
const r = info.result ?? {};
console.log(`getWebhookInfo: url=${r.url} pending=${r.pending_update_count}`);
if (r.url !== webhookUrl) fail(`Telegram повернув інший url: ${r.url}`);
if (r.last_error_message) {
  console.log(`::warning::Остання помилка доставки: ${r.last_error_message}`);
}

async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) fail(`${method}: ${res.status} ${data.description ?? ''}`);
  return data;
}

function fail(msg) {
  console.log(`::error::${msg}`);
  process.exit(1);
}
