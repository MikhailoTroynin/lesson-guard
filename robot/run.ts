/**
 * Хмарний робот Lesson Guard.
 *
 * Запускається за розкладом у GitHub Actions (.github/workflows/robot.yml):
 * відкриває справжній браузер (Playwright + Chromium), заходить у «Єдину школу»
 * і Google Клас акаунтом дитини, збирає оцінки, завдання й здані роботи і
 * кладе зашифрований знімок у гілку `robot-data`. Додаток на телефоні його читає.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from 'playwright';

import type { RobotSnapshot } from '../src/core/snapshot';
import { fetchClassroom } from './classroom';
import { kyivDay } from './dates';
import { Debug } from './debug';
import { fetchEschoolGrades } from './eschool';
import { ensureGoogleSession } from './google';
import {
  decodeSessionSecret,
  mergeStorage,
  readEncrypted,
  writeEncrypted,
  type RobotState,
  type StorageState,
} from './state';

const GRADES_DAYS = 30;
const FORGET_DAYS = 120;

const env = (k: string) => process.env[k]?.trim() || undefined;
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

async function main(): Promise<number> {
  const passphrase = env('ROBOT_PASSPHRASE');
  if (!passphrase || passphrase.length < 12) {
    console.error('Задайте секрет ROBOT_PASSPHRASE (щонайменше 12 символів) — ним шифруються дані.');
    return 2;
  }
  const dataDir = env('DATA_DIR') ?? 'robot-data';
  const debug = new Debug(env('DEBUG_DIR'));
  const now = new Date();

  let state: RobotState = { items: {} };
  try {
    state = (await readEncrypted<RobotState>(join(dataDir, 'state.json'), passphrase)) ?? state;
  } catch (e) {
    log(`Стан робота не розшифровано (змінили ROBOT_PASSPHRASE?) — починаю з нуля: ${message(e)}`);
  }

  // GOOGLE_SESSION (з `npm run robot:session`) перекриває збережені cookies, якщо його оновили.
  const sessionSecret = env('GOOGLE_SESSION');
  let storage: StorageState | undefined = state.storageState;
  if (sessionSecret) {
    const hash = createHash('sha256').update(sessionSecret).digest('hex').slice(0, 16);
    if (state.sessionHash !== hash) {
      try {
        storage = mergeStorage(storage, decodeSessionSecret(sessionSecret, passphrase));
        state.sessionHash = hash;
        log('Використовую сесію Google із секрету GOOGLE_SESSION');
      } catch (e) {
        log(`GOOGLE_SESSION не розшифровано (інший ROBOT_PASSPHRASE?): ${message(e)}`);
      }
    }
  }

  const snapshot: RobotSnapshot = {
    version: 1,
    generatedAt: now.toISOString(),
    classroom: null,
    grades: null,
    errors: {},
  };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: storage as never,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    viewport: { width: 1280, height: 900 },
  });
  ctx.setDefaultTimeout(30_000);

  try {
    // ── Єдина школа ──
    const esLogin = env('ESCHOOL_LOGIN');
    const esPassword = env('ESCHOOL_PASSWORD');
    if (esLogin && esPassword) {
      try {
        const from = kyivDay(new Date(now.getTime() - GRADES_DAYS * 86_400_000));
        snapshot.grades = await fetchEschoolGrades(ctx, { login: esLogin, password: esPassword }, from, kyivDay(now), debug);
        log(`Єдина школа: оцінок ${snapshot.grades.length}`);
      } catch (e) {
        snapshot.errors.eschool = message(e);
        log(`Єдина школа: ПОМИЛКА — ${snapshot.errors.eschool}`);
      }
    } else {
      snapshot.errors.eschool = 'робот не налаштований: задайте секрети ESCHOOL_LOGIN і ESCHOOL_PASSWORD';
      log(`Єдина школа: ${snapshot.errors.eschool}`);
    }

    // ── Google Клас ──
    const gEmail = env('GOOGLE_EMAIL');
    if (gEmail || storage) {
      try {
        const page = await ensureGoogleSession(ctx, { email: gEmail, password: env('GOOGLE_PASSWORD') }, debug, log);
        snapshot.classroom = await fetchClassroom(ctx, page, state.items, now, debug, log);
        log(
          `Google Клас: завдань ${snapshot.classroom.assignments.length}, здач ${snapshot.classroom.submissions.length}`,
        );
      } catch (e) {
        snapshot.errors.classroom = message(e);
        log(`Google Клас: ПОМИЛКА — ${snapshot.errors.classroom}`);
      }
    } else {
      snapshot.errors.classroom = 'робот не налаштований: задайте секрет GOOGLE_SESSION (див. README)';
      log(`Google Клас: ${snapshot.errors.classroom}`);
    }

    state.storageState = (await ctx.storageState()) as StorageState;
  } finally {
    await browser.close();
  }

  const forget = now.getTime() - FORGET_DAYS * 86_400_000;
  for (const [id, m] of Object.entries(state.items)) {
    if (Date.parse(m.firstSeen) < forget) delete state.items[id];
  }

  await writeEncrypted(join(dataDir, 'snapshot.json'), snapshot, passphrase);
  await writeEncrypted(join(dataDir, 'state.json'), state, passphrase);
  log(`Збережено в ${dataDir}/ (зашифровано)`);

  // Червоний запуск (і лист від GitHub) — лише коли джерело налаштоване, але не прочиталося.
  const failed = Object.values(snapshot.errors).some((e) => e && !e.startsWith('робот не налаштований'));
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
