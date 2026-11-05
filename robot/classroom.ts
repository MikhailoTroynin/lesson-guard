import type { BrowserContext, Page } from 'playwright';

import type { Assignment, Attachment, Submission, SubmissionState } from '../src/core/types';
import { meaningfulLength } from '../src/providers/classroom/google';
import { findDueDate, findPostedDate } from './dates';
import type { Debug } from './debug';
import { CLASSROOM } from './google';

/** Скільки днів назад дивитися на завдання (як і прямий клієнт Classroom API). */
const LOOKBACK_DAYS = 45;
/** Скільки останніх зданих робіт відкривати й перевіряти на порожнечу за запуск. */
const MAX_DETAILS = 15;
/** Здану роботу перевіряємо повторно, якщо минуло стільки годин. */
const RECHECK_HOURS = 36;

/** Що робот пам'ятає про завдання між запусками (лежить у зашифрованому стані). */
export interface ItemMemo {
  firstSeen: string;
  createdAt?: string;
  dueDate?: string;
  title?: string;
  courseName?: string;
  submission?: Submission;
  checkedAt?: string;
}

interface ListItem {
  id: string;
  courseId: string;
  lines: string[];
  list: 'not-turned-in' | 'missing' | 'turned-in';
}

interface Card {
  text: string;
  links: { href: string; text: string }[];
}

interface Details {
  title: string;
  text: string;
  card: Card | null;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function collectCourses(page: Page): Promise<Map<string, string>> {
  await page.goto(`${CLASSROOM}/u/0/h`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const pairs = await page.evaluate(() => {
    const out: [string, string][] = [];
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'))) {
      const m = /\/c\/([^/?#]+)\/?$/.exec(new URL(a.href).pathname);
      const name = (a.innerText || a.getAttribute('aria-label') || '').split('\n').map((s) => s.trim()).find(Boolean);
      if (m && name) out.push([m[1], name]);
    }
    return out;
  });
  const map = new Map<string, string>();
  for (const [id, name] of pairs) if (!map.has(id)) map.set(id, name);
  return map;
}

async function collectList(page: Page, list: ListItem['list']): Promise<ListItem[]> {
  await page.goto(`${CLASSROOM}/u/0/a/${list}/all`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  // Розгортаємо згорнуті групи («Цього тижня», «Раніше»…) і докручуємо список.
  for (let i = 0; i < 8; i++) {
    const closed = page.locator('main [aria-expanded="false"], [role="main"] [aria-expanded="false"]');
    if ((await closed.count()) === 0) break;
    await closed.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(700);
  }
  const raw = await page.evaluate(() => {
    const out: { id: string; courseId: string; lines: string[] }[] = [];
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/a/"]'))) {
      const m = /\/c\/([^/?#]+)\/a\/([^/?#]+)/.exec(new URL(a.href).pathname);
      if (!m) continue;
      const lines = (a.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      out.push({ courseId: m[1], id: m[2], lines });
    }
    return out;
  });
  const seen = new Set<string>();
  return raw
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({ ...r, list }));
}

async function readDetails(page: Page, item: ListItem): Promise<Details> {
  await page.goto(`${CLASSROOM}/u/0/c/${item.courseId}/a/${item.id}/details`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  return page.evaluate(() => {
    const HEAD = /^(ваша робота|your work|моя робота)$/i;
    const ACTION =
      /(здати|turn in|hand in|скасувати здачу|unsubmit|позначити як виконане|mark as done|додати або створити|add or create|надіслати повторно|resubmit)/i;
    let card: { text: string; links: { href: string; text: string }[] } | null = null;
    const heads = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,div,span')).filter((e) =>
      HEAD.test((e.textContent || '').trim()),
    );
    for (const head of heads) {
      let el: HTMLElement | null = head;
      for (let i = 0; i < 10 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        const hasAction = Array.from(el.querySelectorAll<HTMLElement>('button,[role="button"]')).some((b) =>
          ACTION.test(b.innerText || b.getAttribute('aria-label') || ''),
        );
        if (hasAction) {
          const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))
            .filter((a) => new URL(a.href).hostname !== 'classroom.google.com')
            .map((a) => ({
              href: a.href,
              text: ((a.innerText || a.getAttribute('aria-label') || a.title || '').split('\n')[0] || '').trim(),
            }));
          card = { text: el.innerText, links };
          break;
        }
      }
      if (card) break;
    }
    const h1 = document.querySelector('h1');
    return {
      title: ((h1 && h1.innerText) || document.title || '').trim(),
      text: document.body.innerText,
      card,
    };
  });
}

const GOOGLE_MIME: Record<string, string> = {
  document: 'application/vnd.google-apps.document',
  presentation: 'application/vnd.google-apps.presentation',
  spreadsheets: 'application/vnd.google-apps.spreadsheet',
};

export function linkToAttachment(href: string, text: string): Attachment {
  const title = text || undefined;
  const u = new URL(href);
  const doc = /^\/(document|presentation|spreadsheets)\/d\/([\w-]+)/.exec(u.pathname);
  if (u.hostname === 'docs.google.com' && doc) {
    return { kind: 'driveFile', id: doc[2], mimeType: GOOGLE_MIME[doc[1]], url: href, title };
  }
  if (u.hostname === 'docs.google.com' && u.pathname.startsWith('/forms')) return { kind: 'form', url: href, title };
  const file = /^\/file\/d\/([\w-]+)/.exec(u.pathname);
  if (u.hostname === 'drive.google.com' && (file || u.searchParams.get('id'))) {
    return { kind: 'driveFile', id: file?.[1] ?? u.searchParams.get('id') ?? undefined, url: href, title };
  }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) return { kind: 'youtube', url: href, title };
  return { kind: 'link', url: href, title };
}

/** Статус «Вашої роботи» за текстом картки. */
export function cardState(text: string): { state: SubmissionState; late: boolean } {
  const t = text.toLowerCase();
  const late = /запізн|late/.test(t);
  if (/не здано|not turned in|missing|пропущено|відсутн/.test(t) && !/здано із запізн|done late|turned in late/.test(t)) {
    return { state: 'CREATED', late };
  }
  if (/повернуто|returned|оцінено|graded/.test(t)) return { state: 'RETURNED', late };
  if (/здано|turned in|handed in|позначено як виконане|marked as done|done late|виконано/.test(t)) {
    return { state: 'TURNED_IN', late };
  }
  return { state: 'CREATED', late };
}

/** Читає текст Google-документа тією ж сесією браузера; `null` — не вдалося. */
async function inspect(ctx: BrowserContext, att: Attachment): Promise<void> {
  if (att.kind !== 'driveFile' || !att.id || !att.mimeType) return;
  const kind = Object.entries(GOOGLE_MIME).find(([, m]) => m === att.mimeType)?.[0];
  const url =
    kind === 'document'
      ? `https://docs.google.com/document/d/${att.id}/export?format=txt`
      : kind === 'presentation'
        ? `https://docs.google.com/presentation/d/${att.id}/export/txt`
        : `https://docs.google.com/spreadsheets/d/${att.id}/export?format=csv`;
  try {
    const res = await ctx.request.get(url, { timeout: 30_000 });
    const type = res.headers()['content-type'] ?? '';
    if (!res.ok() || type.includes('html')) {
      att.textLength = null;
      return;
    }
    att.textLength = meaningfulLength(await res.text());
  } catch {
    att.textLength = null;
  }
}

/**
 * Читає Google Клас через вебінтерфейс: курси, списки «Призначено / Пропущено / Виконано»
 * і картку «Ваша робота» для останніх зданих завдань.
 */
export async function fetchClassroom(
  ctx: BrowserContext,
  page: Page,
  memo: Record<string, ItemMemo>,
  now: Date,
  debug: Debug,
  log: (s: string) => void,
): Promise<{ assignments: Assignment[]; submissions: Submission[] }> {
  const nowIso = now.toISOString();
  const courses = await collectCourses(page);
  await debug.capture(page, 'classroom-home');
  log(`Google Клас: курсів ${courses.size}`);

  const items: ListItem[] = [];
  for (const list of ['not-turned-in', 'missing', 'turned-in'] as const) {
    const got = await collectList(page, list);
    await debug.capture(page, `classroom-${list}`);
    log(`Google Клас: «${list}» — ${got.length}`);
    for (const g of got) if (!items.some((i) => i.id === g.id)) items.push(g);
  }
  if (items.length === 0 && courses.size === 0) {
    await debug.capture(page, 'classroom-empty');
    throw new Error('не знайдено ні курсів, ні завдань — можливо, сторінка Класу змінилась (запустіть робота з debug)');
  }

  let opened = 0;
  for (const item of items) {
    const m = (memo[item.id] ??= { firstSeen: nowIso });
    const joined = item.lines.join('\n');
    m.title = item.lines[0] ?? m.title;
    m.courseName = courses.get(item.courseId) ?? m.courseName ?? item.lines[1];
    m.createdAt ??= findPostedDate(joined, now);
    m.dueDate = findDueDate(joined, now) ?? m.dueDate;

    const stale = !m.checkedAt || now.getTime() - Date.parse(m.checkedAt) > RECHECK_HOURS * 3_600_000;
    const wasDone = m.submission?.state === 'TURNED_IN' || m.submission?.state === 'RETURNED';
    if (item.list === 'turned-in' && opened < MAX_DETAILS && (stale || !wasDone)) {
      opened += 1;
      try {
        const d = await readDetails(page, item);
        if (d.title) m.title = d.title;
        m.createdAt ??= findPostedDate(d.text, now);
        m.dueDate = findDueDate(d.text, now) ?? m.dueDate;
        m.checkedAt = nowIso;
        if (d.card) {
          const { state, late } = cardState(d.card.text);
          const seen = new Set<string>();
          const attachments: Attachment[] = [];
          for (const l of d.card.links) {
            if (seen.has(l.href)) continue;
            seen.add(l.href);
            const att = linkToAttachment(l.href, l.text);
            await inspect(ctx, att);
            attachments.push(att);
          }
          m.submission = {
            id: `sub:${item.id}`,
            assignmentId: item.id,
            courseId: item.courseId,
            state,
            late,
            updatedAt: nowIso,
            attachments,
          };
        } else {
          await debug.capture(page, `classroom-no-card-${item.id}`);
        }
      } catch (e) {
        log(`Google Клас: не вдалося відкрити завдання ${item.id}: ${String(e)}`);
      }
    }
  }
  log(`Google Клас: перевірено зданих робіт ${opened}`);

  const since = now.getTime() - LOOKBACK_DAYS * 86_400_000;
  const assignments: Assignment[] = [];
  const submissions: Submission[] = [];
  for (const item of items) {
    const m = memo[item.id];
    const createdAt = m.createdAt ? `${m.createdAt}T08:00:00.000Z` : m.firstSeen;
    if (Date.parse(createdAt) < since) continue;
    assignments.push({
      id: item.id,
      courseId: item.courseId,
      courseName: m.courseName ?? 'Google Клас',
      title: m.title ?? 'Завдання',
      createdAt,
      dueDate: m.dueDate,
      link: `${CLASSROOM}/c/${item.courseId}/a/${item.id}/details`,
    });
    if (item.list === 'turned-in') {
      // Картку не прочитали — не знаємо, що прикріплено, тож не вважаємо роботу порожньою.
      submissions.push(
        m.submission ?? {
          id: `sub:${item.id}`,
          assignmentId: item.id,
          courseId: item.courseId,
          state: 'TURNED_IN',
          updatedAt: m.firstSeen,
          attachments: [{ kind: 'link', title: 'не перевірено' }],
        },
      );
    }
  }
  return { assignments, submissions };
}
