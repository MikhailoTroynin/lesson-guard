/**
 * `npm run robot:session` — одноразове збереження сесії Google для робота.
 *
 * Google не пускає автоматизований браузер входити паролем. Тому вхід робить людина:
 * скрипт відкриває ЗВИЧАЙНИЙ Chrome (без керування роботом) з окремим тимчасовим профілем.
 * Ви входите акаунтом дитини, як завжди (з підтвердженням на телефоні, якщо Google попросить),
 * відкривається Google Клас — і скрипт забирає cookies цього профілю, шифрує їх паролем робота
 * й зберігає рядок для секрету GOOGLE_SESSION. Тимчасовий профіль потім видаляється.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from 'playwright';

import { CLASSROOM } from './google';
import { encodeSessionSecret, type StorageState } from './state';

const PORT = 9333;

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Не знайшов Google Chrome. Встановіть його або вкажіть шлях у змінній CHROME_PATH.');
  return found;
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const passphrase =
    process.env.ROBOT_PASSPHRASE?.trim() ||
    (await rl.question('Пароль робота (той самий, що в секреті ROBOT_PASSPHRASE): ')).trim();
  rl.close();
  if (passphrase.length < 12) throw new Error('Пароль робота має бути щонайменше 12 символів.');

  const profile = await mkdtemp(join(tmpdir(), 'lesson-guard-'));
  const chrome = spawn(
    findChrome(),
    [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `${CLASSROOM}/u/0/h`],
    { stdio: 'ignore' },
  );
  console.log('\nВідкрився Chrome. Увійдіть акаунтом дитини — скрипт чекає, поки відкриється Google Клас (до 10 хв)…');

  try {
    let browser = null;
    for (let i = 0; i < 30 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
      if (!browser) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!browser) throw new Error('Не вдалося підключитися до Chrome.');
    const ctx = browser.contexts()[0];

    const deadline = Date.now() + 10 * 60_000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      ready = ctx.pages().some((p) => {
        try {
          return new URL(p.url()).hostname === 'classroom.google.com';
        } catch {
          return false;
        }
      });
    }
    if (!ready) throw new Error('Google Клас так і не відкрився. Спробуйте ще раз.');
    await new Promise((r) => setTimeout(r, 3000));

    const state = (await ctx.storageState()) as StorageState;
    const google = state.cookies.filter((c) => /google\.com$/.test((c as { domain: string }).domain));
    if (google.length === 0) throw new Error('Cookies Google не знайдено — схоже, вхід не завершився.');
    await writeFile('google-session.txt', encodeSessionSecret({ cookies: google, origins: [] }, passphrase));
    await browser.close().catch(() => {});
    console.log(
      '\nГотово! Відкрийте файл google-session.txt, скопіюйте весь рядок і додайте в GitHub:\n' +
        'Settings → Secrets and variables → Actions → New repository secret, назва GOOGLE_SESSION.\n' +
        'Після цього видаліть файл google-session.txt.',
    );
  } finally {
    chrome.kill();
    await new Promise((r) => setTimeout(r, 1000));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
