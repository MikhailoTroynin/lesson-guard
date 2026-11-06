/**
 * `npm run robot:remote-login` — вхід у Google через віддалений браузер (GitHub Actions).
 *
 * Запускається з workflow «Google login» (.github/workflows/google-login.yml), який
 * уже підняв віртуальний екран (Xvfb), VNC з паролем, noVNC і тунель Cloudflare.
 *
 * 1. Відкриваємо ЗВИЧАЙНИЙ Google Chrome (не керований роботом) на віртуальному екрані.
 * 2. Бот надсилає адміністраторам у Telegram посилання на цей екран.
 * 3. Людина сама входить у Google акаунтом дитини (з підтвердженням на телефоні, якщо треба).
 * 4. Коли відкрився Google Клас — забираємо cookies і зберігаємо сесію на сервері (зашифровано).
 *
 * Поки людина входить, до сторінок Chrome ніхто не підключається: стан перевіряємо лише
 * через список вкладок (http://127.0.0.1:<порт>/json/list).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { CLASSROOM } from './google';
import type { StorageState } from './state';
import { DEFAULT_WORKER_URL, WorkerClient } from './worker';

const PORT = 9333;
const WAIT_MS = Number(process.env.REMOTE_LOGIN_WAIT_MS) || 15 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = (k: string) => process.env[k]?.trim() || undefined;
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

/** Адреса тунелю з логу cloudflared. */
export function tunnelUrlFrom(text: string): string | null {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0] ?? null;
}

/** Чи відкрито Google Клас в одній із вкладок (відповідь /json/list). */
export function classroomOpen(tabs: { type?: string; url?: string }[]): boolean {
  return tabs.some((t) => {
    if (t.type && t.type !== 'page') return false;
    try {
      return new URL(t.url ?? '').hostname === 'classroom.google.com';
    } catch {
      return false;
    }
  });
}

async function waitForTunnel(file: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const url = existsSync(file) ? tunnelUrlFrom(readFileSync(file, 'utf8')) : null;
    if (url) return url;
    await sleep(1000);
  }
  throw new Error('Тунель Cloudflare не запустився.');
}

async function main(): Promise<number> {
  const botToken = env('TELEGRAM_BOT_TOKEN');
  const password = env('VNC_PASSWORD');
  if (!botToken || !password) {
    console.error('Потрібні TELEGRAM_BOT_TOKEN і VNC_PASSWORD.');
    return 2;
  }
  const worker = new WorkerClient(botToken, env('WORKER_URL') ?? DEFAULT_WORKER_URL);
  const tunnel = await waitForTunnel(env('TUNNEL_LOG') ?? 'cloudflared.log');
  // Репозиторій публічний: адреса не повинна потрапити в лог.
  console.log(`::add-mask::${tunnel}`);
  const link = `${tunnel}/vnc.html?autoconnect=1&resize=scale&password=${encodeURIComponent(password)}`;
  console.log(`::add-mask::${link}`);

  const profile = await mkdtemp(join(tmpdir(), 'lg-google-'));
  const chrome = spawn(
    env('CHROME_PATH') ?? '/usr/bin/google-chrome',
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      '--window-position=0,0',
      '--window-size=1280,860',
      '--lang=uk',
      `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(`${CLASSROOM}/u/0/h`)}`,
    ],
    { stdio: 'ignore', env: { ...process.env, DISPLAY: env('DISPLAY') ?? ':99' } },
  );
  log('Chrome запущено на віртуальному екрані');

  try {
    await worker.notify(
      [
        'Вхід у Google для робота. Відкрийте посилання (можна з телефону):',
        link,
        '',
        'Побачите вікно Chrome — увійдіть акаунтом ДИТИНИ, як звичайно (підтвердіть на телефоні, якщо Google попросить). Коли відкриється Google Клас, усе збережеться саме.',
        'Посилання діє 15 хвилин і лише для вас — нікому його не пересилайте.',
      ].join('\n'),
    );
    log('Посилання надіслано в Telegram. Чекаю на вхід (до 15 хв)…');

    const deadline = Date.now() + WAIT_MS;
    // Без входу classroom.google.com на мить відкривається і перенаправляє далі,
    // тому чекаємо, щоб Клас був відкритий дві перевірки поспіль.
    let hits = 0;
    while (hits < 2 && Date.now() < deadline) {
      await sleep(3000);
      const tabs = (await fetch(`http://127.0.0.1:${PORT}/json/list`)
        .then((r) => r.json())
        .catch(() => [])) as { type?: string; url?: string }[];
      hits = classroomOpen(tabs) ? hits + 1 : 0;
    }
    const ready = hits >= 2;
    if (!ready) {
      await worker.notify('⏱ Час на вхід у Google вийшов. Запустіть «Вхід у Google» на сторінці налаштувань ще раз.');
      log('Не дочекалися входу');
      return 1;
    }
    log('Google Клас відкрито — зберігаю сесію');
    await sleep(5000); // дати сторінці дописати cookies

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const state = (await browser.contexts()[0].storageState()) as StorageState;
    await browser.close().catch(() => {});
    const cookies = state.cookies.filter((c) => /(^|\.)google\.com$/.test((c as { domain: string }).domain));
    if (!cookies.some((c) => /^(SID|__Secure-1PSID|__Secure-3PSID)$/.test((c as { name: string }).name))) {
      throw new Error('вхід у Google не завершено (немає cookie сесії)');
    }
    await worker.saveSession({ cookies, origins: [] });
    await worker.notify('✅ Вхід у Google збережено. Робот зараз прочитає Google Клас, а далі робитиме це щогодини.');
    log(`Сесію збережено (${cookies.length} cookies)`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await worker.notify(`❗ Не вдалося зберегти вхід у Google: ${msg}. Спробуйте ще раз.`);
    log(`ПОМИЛКА: ${msg}`);
    return 1;
  } finally {
    chrome.kill();
    await sleep(1000);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1]?.endsWith('remote-login.ts')) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
