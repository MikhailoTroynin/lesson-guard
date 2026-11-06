// Створює одноразовий код прив'язки чату Telegram до дитини.
// Запускається з GitHub Actions (Deploy Worker → action = link-code).
//
//   CHILD_NAME, CHILD_CLASS   ім'я дитини і клас (клас можна не вказувати)
//   TELEGRAM_BOT_TOKEN        з нього виводиться адмін-токен (HMAC, інша мітка, ніж у вебхука)
//   WORKER_URL                необов'язково; якщо порожньо — адреса визначається через
//                             Cloudflare API (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
//   GITHUB_STEP_SUMMARY       сюди (і лише сюди) записується код
//
// Код не виводиться в лог.
import { createHmac } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const ADMIN_TOKEN_LABEL = 'lesson-guard:admin-api';

const token = process.env.TELEGRAM_BOT_TOKEN;
const name = (process.env.CHILD_NAME ?? '').trim();
const className = (process.env.CHILD_CLASS ?? '').trim();
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (!token) fail('TELEGRAM_BOT_TOKEN порожній.');
if (!name) fail('Вкажіть «Ім\'я дитини» (child_name).');
if (!summaryPath) fail('GITHUB_STEP_SUMMARY не задано: код нікуди показати.');

const admin = createHmac('sha256', token).update(ADMIN_TOKEN_LABEL).digest('hex');
console.log(`::add-mask::${admin}`);

const workerUrl = await resolveWorkerUrl();
console.log(`Worker: ${workerUrl}`);

const res = await fetch(`${workerUrl}/admin/link-code`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
  body: JSON.stringify({ name, class_name: className || null }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok || !data.ok || !data.code) fail(`/admin/link-code: ${res.status} ${data.error ?? ''}`);

const child = data.child;
const label = child.class_name ? `${child.name} (${child.class_name})` : child.name;
console.log(
  `Дитина id=${child.id} ${child.created ? 'створена' : 'вже була'}; код дійсний до ${data.expires_at} UTC. ` +
    'Код — у Job Summary.',
);
appendFileSync(
  summaryPath,
  [
    `## Код прив'язки: ${escapeMd(label)}`,
    '',
    `Надішліть боту в Telegram (у приватному чаті або в групі батьків):`,
    '',
    '```',
    `/link ${data.code}`,
    '```',
    '',
    `- Код одноразовий, дійсний до **${data.expires_at} UTC** (24 години).`,
    `- Дитина: id ${child.id}${child.created ? ' (щойно створена)' : ' (вже була в базі)'}.`,
    '- Для другого батька / іншого чату запустіть link-code ще раз — отримаєте новий код.',
    '',
  ].join('\n'),
);

async function resolveWorkerUrl() {
  const explicit = (process.env.WORKER_URL ?? '').replace(/\/+$/, '');
  if (explicit) {
    if (!/^https:\/\/[^/\s]+$/.test(explicit)) fail(`Некоректний WORKER_URL: "${explicit}".`);
    return explicit;
  }
  const { CLOUDFLARE_API_TOKEN: cfToken, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!cfToken || !account) fail('Немає WORKER_URL і даних Cloudflare, щоб визначити адресу Worker\'а.');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, {
    headers: { authorization: `Bearer ${cfToken}` },
  });
  const d = await r.json().catch(() => ({}));
  const sub = d?.result?.subdomain;
  if (!r.ok || !sub) fail(`Не вдалося отримати піддомен workers.dev: ${r.status}. Задайте змінну WORKER_URL.`);
  const workerName = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'))?.[1];
  if (!workerName) fail('Не знайдено name у wrangler.toml.');
  return `https://${workerName}.${sub}.workers.dev`;
}

function escapeMd(s) {
  return s.replace(/[\\`*_[\]<>#|]/g, (c) => `\\${c}`);
}

function fail(msg) {
  console.log(`::error::${msg}`);
  process.exit(1);
}
