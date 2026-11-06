/**
 * Хмарний робот Lesson Guard.
 *
 * Запускається за розкладом у GitHub Actions (.github/workflows/robot.yml):
 * відкриває справжній браузер (Playwright + Chromium), заходить у «Єдину школу»
 * і Google Клас акаунтом дитини, збирає оцінки, завдання й здані роботи і
 * віддає їх Cloudflare Worker'у. Логіни й сесію Google він бере звідти ж —
 * їх вводять на сторінці налаштувань (GitHub Pages).
 */
import { chromium } from 'playwright';

import type { RobotSnapshot } from '../src/core/snapshot';
import { fetchClassroom } from './classroom';
import { kyivDay } from './dates';
import { Debug } from './debug';
import { fetchEschoolGrades } from './eschool';
import { ensureGoogleSession, GoogleLoginError } from './google';
import { mergeStorage, type RobotState, type StorageState } from './state';
import { DEFAULT_WORKER_URL, WorkerClient } from './worker';

const GRADES_DAYS = 30;
const FORGET_DAYS = 120;

const env = (k: string) => process.env[k]?.trim() || undefined;
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

async function main(): Promise<number> {
  const botToken = env('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    console.error('Немає секрету TELEGRAM_BOT_TOKEN — без нього робот не може звернутися до Worker\'а.');
    return 2;
  }
  const worker = new WorkerClient(botToken, env('WORKER_URL') ?? DEFAULT_WORKER_URL);
  const debug = new Debug(env('DEBUG_DIR'));
  const now = new Date();

  const config = await worker.config();
  if (config.skip) {
    log('Робот не потрібен: Єдину школу і Google Клас Worker читає сам (вхід через Google на сторінці). Завершую.');
    return 0;
  }
  const state: RobotState = config.state ?? { items: {} };
  state.items ??= {};

  // Сесія Google зі сторінки налаштувань перекриває збережені cookies, якщо її оновили.
  let storage: StorageState | undefined = state.storageState;
  if (config.google_session && config.google_session_updated_at !== state.sessionAppliedAt) {
    storage = mergeStorage(storage, config.google_session);
    state.sessionAppliedAt = config.google_session_updated_at ?? undefined;
    log('Використовую нову сесію Google зі сторінки налаштувань');
  }

  const snapshot: RobotSnapshot = {
    version: 1,
    generatedAt: now.toISOString(),
    classroom: null,
    grades: null,
    errors: {},
  };

  // ROBOT_CHANNEL=chrome — справжній Google Chrome (є на раннерах GitHub), той самий, що й під час входу.
  const browser = await chromium.launch({ channel: env('ROBOT_CHANNEL') });
  const ctx = await browser.newContext({
    storageState: storage as never,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    viewport: { width: 1280, height: 900 },
  });
  ctx.setDefaultTimeout(30_000);

  try {
    // ── Єдина школа ──
    const esLogin = config.eschool?.login ?? env('ESCHOOL_LOGIN');
    const esPassword = config.eschool?.password ?? env('ESCHOOL_PASSWORD');
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
      snapshot.errors.eschool = 'робот не налаштований: введіть логін і пароль Єдиної школи на сторінці налаштувань';
      log(`Єдина школа: ${snapshot.errors.eschool}`);
    }

    // ── Google Клас ──
    const gEmail = config.google?.email ?? env('GOOGLE_EMAIL');
    const gPassword = config.google?.password ?? env('GOOGLE_PASSWORD');
    const rejected =
      !storage && state.googleRejected && state.googleRejected.for === (config.google_updated_at ?? 'env')
        ? state.googleRejected
        : undefined;
    if (rejected) {
      // Google уже відхилив вхід цими даними — не стукаємо щогодини (і не шлемо лист про червоний запуск).
      snapshot.errors.classroom = `${rejected.error} (не пробую знову, поки не зміните email/пароль на сторінці)`;
      log(`Google Клас: ${snapshot.errors.classroom}`);
    } else if (gEmail || storage) {
      try {
        const page = await ensureGoogleSession(ctx, { email: gEmail, password: gPassword }, debug, log, (text) =>
          worker.notify(text),
        );
        snapshot.classroom = await fetchClassroom(ctx, page, state.items, now, debug, log);
        log(
          `Google Клас: завдань ${snapshot.classroom.assignments.length}, здач ${snapshot.classroom.submissions.length}`,
        );
      } catch (e) {
        snapshot.errors.classroom = message(e);
        log(`Google Клас: ПОМИЛКА — ${snapshot.errors.classroom}`);
        if (e instanceof GoogleLoginError && e.final) {
          state.googleRejected = { for: config.google_updated_at ?? 'env', error: snapshot.errors.classroom };
        }
      }
    } else {
      snapshot.errors.classroom = 'робот не налаштований: введіть email і пароль Google дитини на сторінці налаштувань';
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

  await worker.report(snapshot, state);
  log(`Дані передано у Worker (${worker.url})`);

  // Червоний запуск (і лист від GitHub) — лише коли джерело налаштоване, але не прочиталося.
  const failed = Object.values(snapshot.errors).some(
    (e) => e && !e.startsWith('робот не налаштований') && !e.includes('не пробую знову'),
  );
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
