/**
 * Перевірка на сервері: сам Worker (без робота і без нічого на комп'ютері) читає
 * «Єдину школу» і Google Клас, порівнює з попередньою перевіркою і надсилає
 * нові події в Telegram.
 *
 * Запускається: за розкладом (cron у wrangler.toml), кнопкою «Перевірити зараз»
 * на сторінці, командою /check у боті і після звіту робота.
 *
 * Джерела: пряме підключення (логін Єдиної школи / вхід через Google) має пріоритет;
 * якщо джерело напряму не підключене, беруться свіжі дані робота (robot_snapshot).
 */
import { runCheck } from '../../src/core/checker';
import { isBadGrade } from '../../src/core/rules';
import type { Alert, Assignment, CheckState, Grade, Settings, Submission } from '../../src/core/types';
import { EschoolGradesProvider } from '../../src/providers/eschool/client';
import { Budget, collectClassroom, emptyClassroomCache, type ClassroomCache } from './classroom';
import { GoogleAuthError, googleAccessToken, loadGoogle, PAGE_URL } from './google';
import { getJson, getSettings, setJson } from './settings';
import { sendMessage } from './telegram';
import { Vault } from './vault';

export interface CheckEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /** Ліміт зовнішніх запитів на один запуск (безкоштовний тариф Cloudflare — 50). */
  SUBREQUEST_BUDGET?: string;
}

export type CheckReason = 'cron' | 'manual' | 'bot' | 'robot';
type SourceKind = 'direct' | 'robot' | 'none';

/** Знімок даних у форматі робота (його читає сторінка через /api/snapshot). */
export interface Snapshot {
  version: 1;
  generatedAt: string;
  classroom: { assignments: Assignment[]; submissions: Submission[] } | null;
  grades: Grade[] | null;
  errors: { classroom?: string; eschool?: string };
}

export interface ServerStatus {
  checkedAt: string;
  reason: CheckReason;
  sources: { eschool: SourceKind; classroom: SourceKind };
  errors: { eschool?: string; classroom?: string };
  counts: { assignments: number; submissions: number; grades: number };
  /** Курси Google Класу: скільки оновлено цього разу / всього. */
  courses?: { refreshed: number; total: number };
  alerts: number;
  recipients: number;
  /** Помилки, про які вже написали в Telegram (щоб не повторювати щогодини). */
  notifiedErrors?: { eschool?: string; classroom?: string };
}

interface ServerState {
  check: CheckState;
  /** Джерело вже давало дані — далі його нові події надсилаються. */
  ready: { eschool?: boolean; classroom?: boolean };
}

const GRADES_DAYS = 30;
const ROBOT_STALE_HOURS = 26;
const LOCK_MS = 4 * 60 * 1000;
const DAY_MS = 86_400_000;
/** Скільки запитів лишити на Telegram. */
const TELEGRAM_RESERVE = 8;

const NOT_CONFIGURED = {
  eschool: 'не підключено: введіть логін і пароль Єдиної школи на сторінці налаштувань',
  classroom: 'не підключено: увійдіть через Google на сторінці налаштувань',
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

const ICON: Record<Alert['kind'], string> = { new_assignment: '📘', bad_grade: '⛔', empty_submission: '⚠️' };

/** Текст повідомлення в Telegram для пачки подій. */
export function formatAlerts(alerts: Alert[], links: Map<string, string>): string[] {
  const blocks = alerts.map((a) => {
    const link = a.assignmentId ? links.get(a.assignmentId) : undefined;
    return `${ICON[a.kind]} ${a.title}\n${a.body}${link ? `\n${link}` : ''}`;
  });
  // Telegram приймає до 4096 символів; ділимо з запасом.
  const out: string[] = [];
  let cur = '';
  for (const b of blocks) {
    if (cur && cur.length + b.length + 2 > 3800) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${b}` : b.slice(0, 3800);
  }
  if (cur) out.push(cur);
  return out;
}

/** Хто отримує сповіщення: активні чати, прив'язані до дітей, і адміністратори. */
async function recipients(db: D1Database): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT t.chat_id FROM telegram_chats t
       WHERE t.is_active = 1 AND (
         t.chat_id IN (SELECT chat_id FROM chat_children) OR t.chat_id IN (SELECT chat_id FROM admins)
       )`,
    )
    .all<{ chat_id: number }>();
  return results.map((r) => r.chat_id);
}

async function adminChats(db: D1Database): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT a.chat_id FROM admins a JOIN telegram_chats t ON t.chat_id = a.chat_id WHERE t.is_active = 1')
    .all<{ chat_id: number }>();
  return results.map((r) => r.chat_id);
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const getServerStatus = (db: D1Database) => getJson<ServerStatus>(db, 'server_status');

export interface CheckOptions {
  reason: CheckReason;
  fetch?: typeof fetch;
  now?: Date;
}

/**
 * Одна повна перевірка. Повертає стан (його ж зберігає в app_settings.server_status).
 * Якщо інша перевірка йде прямо зараз, повертає { busy: true } з останнім станом.
 */
export async function runServerCheck(
  env: CheckEnv,
  opts: CheckOptions,
): Promise<{ status: ServerStatus | null; busy?: boolean }> {
  const db = env.DB;
  const now = opts.now ?? new Date();
  const lock = await getJson<{ at: number }>(db, 'check_lock');
  if (lock && now.getTime() - lock.at < LOCK_MS) return { status: await getServerStatus(db), busy: true };
  await setJson(db, 'check_lock', { at: now.getTime() });

  try {
    return { status: await doCheck(env, opts, now) };
  } finally {
    await setJson(db, 'check_lock', { at: 0 });
  }
}

async function doCheck(env: CheckEnv, opts: CheckOptions, now: Date): Promise<ServerStatus> {
  const db = env.DB;
  const vault = new Vault(db, env.TELEGRAM_BOT_TOKEN);
  const budget = new Budget(Number(env.SUBREQUEST_BUDGET) || 45, opts.fetch);
  const tg = { db, botToken: env.TELEGRAM_BOT_TOKEN, fetch: budget.fetch };

  const [appSettings, login, password, google, robotRaw, stateRaw, cacheRaw, prevSnapRaw, prevStatus] = await Promise.all([
    getSettings(db),
    vault.get('eschool_login'),
    vault.get('eschool_password'),
    loadGoogle(vault),
    vault.get('robot_snapshot'),
    vault.get('check_state'),
    vault.get('classroom_cache'),
    vault.get('snapshot'),
    getServerStatus(db),
  ]);
  const settings: Settings = { ...appSettings, demoMode: false };
  const robot = parse<Snapshot>(robotRaw);
  const vaultNames = await vault.list();
  const robotGoogle = !!vaultNames.google_session || (!!vaultNames.google_email && !!vaultNames.google_password);
  const robotFresh = robot && now.getTime() - Date.parse(robot.generatedAt) < ROBOT_STALE_HOURS * 3_600_000 ? robot : null;
  const prev = parse<Snapshot>(prevSnapRaw);
  const state: ServerState = parse<ServerState>(stateRaw) ?? { check: { knownAssignmentIds: [], alertedIds: [] }, ready: {} };

  const errors: ServerStatus['errors'] = {};
  const sources: ServerStatus['sources'] = { eschool: 'none', classroom: 'none' };
  let grades: Grade[] | null = null;
  let classroom: Snapshot['classroom'] = null;
  let courses: ServerStatus['courses'];

  // ── Єдина школа ──
  if (login && password) {
    sources.eschool = 'direct';
    try {
      const provider = new EschoolGradesProvider(
        { login, password },
        budget.fetch,
        {
          get: () => vault.get('eschool_token'),
          set: (t) => vault.set('eschool_token', t || null),
        },
        1500,
      );
      grades = await provider.listGrades(new Date(now.getTime() - GRADES_DAYS * DAY_MS), now);
    } catch (e) {
      errors.eschool = `Єдина школа: ${message(e)}`;
    }
  } else if (robotFresh?.grades) {
    sources.eschool = 'robot';
    grades = robotFresh.grades;
  } else {
    errors.eschool = robotFresh?.errors.eschool ?? NOT_CONFIGURED.eschool;
  }

  // ── Google Клас ──
  if (google?.refresh_token) {
    sources.classroom = 'direct';
    try {
      const token = await googleAccessToken(google, budget.fetch);
      const r = await collectClassroom({
        token,
        budget,
        cache: parse<ClassroomCache>(cacheRaw) ?? emptyClassroomCache(),
        now,
        reserve: TELEGRAM_RESERVE,
      });
      await vault.set('classroom_cache', JSON.stringify(r.cache));
      classroom = { assignments: r.assignments, submissions: r.submissions };
      courses = { refreshed: r.refreshed, total: r.total };
    } catch (e) {
      errors.classroom = e instanceof GoogleAuthError ? e.message : `Google Клас: ${message(e)}`;
    }
  } else if (robotFresh?.classroom) {
    sources.classroom = 'robot';
    classroom = robotFresh.classroom;
  } else if (robotGoogle) {
    // Google Клас читає робот (пароль або сесія на сторінці), але даних немає.
    sources.classroom = 'robot';
    errors.classroom = robotFresh?.errors.classroom
      ? `Робот: ${robotFresh.errors.classroom}`
      : robot
        ? `Робот давно не передавав даних (останній раз ${robot.generatedAt.slice(0, 16).replace('T', ' ')} UTC). Перевірте вкладку Actions → Robot у GitHub.`
        : 'Робот ще не запускався. Запустіть його на сторінці налаштувань (картка «Хмарний робот») або зачекайте до наступної години.';
  } else {
    errors.classroom = robotFresh?.errors.classroom ?? NOT_CONFIGURED.classroom;
  }

  // Джерело не прочиталося — показуємо на сторінці попередні дані (нових подій з них не буде).
  const shownGrades = grades ?? prev?.grades ?? null;
  const shownClassroom = classroom ?? prev?.classroom ?? null;

  const result = runCheck({
    assignments: shownClassroom?.assignments ?? [],
    submissions: shownClassroom?.submissions ?? [],
    grades: shownGrades ?? [],
    settings,
    state: state.check,
    now,
  });

  // Джерело дало дані вперше: старі події не надсилаємо, лише підсумок.
  const firstEschool = !!grades && !state.ready.eschool;
  const firstClassroom = !!classroom && !state.ready.classroom;
  const alerts = result.newAlerts.filter((a) =>
    a.kind === 'bad_grade' ? !firstEschool : !firstClassroom,
  );
  const nextState: ServerState = {
    check: result.state,
    ready: { eschool: state.ready.eschool || !!grades, classroom: state.ready.classroom || !!classroom },
  };

  const snapshot: Snapshot = {
    version: 1,
    generatedAt: now.toISOString(),
    classroom: shownClassroom,
    grades: shownGrades,
    errors,
  };
  await Promise.all([vault.set('snapshot', JSON.stringify(snapshot)), vault.set('check_state', JSON.stringify(nextState))]);

  // ── Telegram ──
  const chats = await recipients(db);
  const messages: string[] = [];
  if (firstEschool) {
    const bad = grades!.filter((g) => isBadGrade(g, settings.badGradeThreshold)).length;
    messages.push(
      `✅ Єдина школа підключена. Оцінок за ${GRADES_DAYS} днів: ${grades!.length}, з них нижче ${settings.badGradeThreshold}: ${bad}.\nДалі я писатиму сюди про кожну нову погану оцінку.`,
    );
  }
  if (firstClassroom) {
    const empty = result.timeline.filter((t) => t.submissionStatus === 'empty').length;
    messages.push(
      `✅ Google Клас підключено. Завдань за 45 днів: ${classroom!.assignments.length}, порожніх здач: ${empty}.\nДалі я писатиму сюди про нові завдання і порожні здачі.`,
    );
  }
  const links = new Map(
    (shownClassroom?.assignments ?? []).filter((a) => a.link).map((a) => [a.id, a.link!] as [string, string]),
  );
  messages.push(...formatAlerts(alerts, links));

  let sentAlerts = 0;
  for (const chatId of chats) {
    let ok = true;
    for (const text of messages) ok = (await sendMessage(tg, chatId, text)).ok && ok;
    if (ok && alerts.length) sentAlerts++;
  }
  if (alerts.length && chats.length) await logAlerts(db, chats, alerts);

  // Помилки й відновлення — лише адміністраторам і лише коли щось змінилось.
  const notified = { ...(prevStatus?.notifiedErrors ?? {}) };
  const admins = await adminChats(db);
  for (const key of ['eschool', 'classroom'] as const) {
    if (sources[key] === 'none') {
      notified[key] = undefined; // не підключено — це не збій, про це видно на сторінці
      continue;
    }
    const err = errors[key];
    if (err === notified[key]) continue;
    const text = err
      ? `❗ ${err}\n\nВиправити: ${PAGE_URL}`
      : `✅ ${key === 'eschool' ? 'Єдина школа' : 'Google Клас'} знову читається.`;
    if (err || notified[key]) for (const chatId of admins) await sendMessage(tg, chatId, text);
    notified[key] = err;
  }

  const status: ServerStatus = {
    checkedAt: now.toISOString(),
    reason: opts.reason,
    sources,
    errors,
    counts: {
      assignments: shownClassroom?.assignments.length ?? 0,
      submissions: shownClassroom?.submissions.length ?? 0,
      grades: shownGrades?.length ?? 0,
    },
    courses,
    alerts: alerts.length,
    recipients: chats.length,
    notifiedErrors: notified,
  };
  await setJson(db, 'server_status', status);
  if (alerts.length && !sentAlerts && chats.length) console.warn('Події є, але жодне повідомлення не надіслано');
  return status;
}

async function logAlerts(db: D1Database, chats: number[], alerts: Alert[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO notifications_log (chat_id, kind, dedupe_key, status, sent_at)
     VALUES (?, ?, ?, 'sent', datetime('now')) ON CONFLICT (chat_id, dedupe_key) DO NOTHING`,
  );
  const rows = chats.flatMap((c) => alerts.map((a) => stmt.bind(c, a.kind, a.id)));
  // Один batch — один запит до D1 (на безкоштовному тарифі їх теж обмежено).
  for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50));
}

/** Короткий опис стану для /status і для сторінки. */
export function describeStatus(s: ServerStatus | null): string {
  if (!s) return 'Перевірок ще не було. Надішліть /check або натисніть «Перевірити зараз» на сторінці.';
  const t = new Date(s.checkedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const src = (k: SourceKind) => (k === 'direct' ? 'напряму' : k === 'robot' ? 'через робота' : 'не підключено');
  const lines = [
    `Остання перевірка: ${t}`,
    `Єдина школа: ${s.errors.eschool ? `❗ ${s.errors.eschool}` : `✅ ${src(s.sources.eschool)}, оцінок ${s.counts.grades}`}`,
    `Google Клас: ${s.errors.classroom ? `❗ ${s.errors.classroom}` : `✅ ${src(s.sources.classroom)}, завдань ${s.counts.assignments}, здач ${s.counts.submissions}`}`,
  ];
  if (s.courses && s.courses.refreshed < s.courses.total) {
    lines.push(`Курсів оновлено ${s.courses.refreshed} з ${s.courses.total} (решта — наступної перевірки).`);
  }
  lines.push(`Нових подій: ${s.alerts}. Отримувачів: ${s.recipients}.`);
  return lines.join('\n');
}
