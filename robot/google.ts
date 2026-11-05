import type { BrowserContext, Page } from 'playwright';

import type { Debug } from './debug';

export const CLASSROOM = 'https://classroom.google.com';

/** Скільки чекати, поки дитина натисне «Так, це я» на телефоні. */
const CHALLENGE_WAIT_MS = 4 * 60_000;

export class GoogleLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleLoginError';
  }
}

const SESSION_HINT =
  'Один раз збережіть сесію Google: на комп’ютері запустіть `npm run robot:session`, увійдіть у вікні Chrome і додайте рядок у секрет GOOGLE_SESSION (див. README).';

function isClassroom(u: string): boolean {
  return new URL(u).hostname === 'classroom.google.com';
}

async function textOf(page: Page): Promise<string> {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

/**
 * Відкриває Google Клас; якщо сесії немає — входить email і паролем дитини.
 * Жодного обходу захисту: якщо Google просить підтвердження, робот чекає, поки
 * людина підтвердить вхід на телефоні, а якщо блокує — повідомляє, що робити.
 */
export async function ensureGoogleSession(
  ctx: BrowserContext,
  creds: { email?: string; password?: string },
  debug: Debug,
  log: (s: string) => void,
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${CLASSROOM}/u/0/h`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  if (isClassroom(page.url())) return page;

  if (!creds.email || !creds.password) {
    throw new GoogleLoginError(`сесії Google немає, а GOOGLE_EMAIL / GOOGLE_PASSWORD не задані. ${SESSION_HINT}`);
  }
  log('Google: вхід email і паролем');

  // На сторінці вибору акаунта може бути «Use another account».
  const other = page.getByText(/Use another account|Використати інший обліковий запис|Увійти в інший акаунт/i);
  if (await other.isVisible().catch(() => false)) await other.click();

  const email = page.locator('#identifierId, input[name="identifier"], input[type="email"]').first();
  await email.waitFor({ state: 'visible', timeout: 30_000 });
  await email.fill(creds.email);
  await page.keyboard.press('Enter');

  const password = page.locator('input[type="password"]:visible');
  const deadline = Date.now() + CHALLENGE_WAIT_MS;
  let passwordSent = false;
  let announcedChallenge = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    const url = page.url();
    if (isClassroom(url)) {
      log('Google: увійшли');
      return page;
    }
    const body = await textOf(page);

    if (/signin\/rejected|may not be secure|небезпечн|незахищен|Не вдається ввійти|Couldn.t sign you in/i.test(url + body)) {
      await debug.capture(page, 'google-rejected');
      throw new GoogleLoginError(`Google відхилив вхід з браузера робота. ${SESSION_HINT}`);
    }
    if (/Wrong password|Неправильний пароль|Couldn.t find your Google Account|Не вдалося знайти/i.test(body)) {
      await debug.capture(page, 'google-wrong-credentials', { mask: ['input[type="password"]'] });
      throw new GoogleLoginError('Google: неправильний email або пароль (GOOGLE_EMAIL / GOOGLE_PASSWORD).');
    }
    if (!passwordSent && (await password.count()) > 0) {
      await password.first().fill(creds.password);
      await page.keyboard.press('Enter');
      passwordSent = true;
      continue;
    }
    // Сторінки «Ласкаво просимо», умови Workspace for Education тощо.
    const ack = page.getByRole('button', { name: /^(I understand|Я розумію|Зрозуміло|Accept|Прийняти|Continue|Продовжити|Not now|Не зараз)$/i });
    if (await ack.first().isVisible().catch(() => false)) {
      await ack.first().click();
      continue;
    }
    if (/\/challenge\//.test(url) && !announcedChallenge) {
      announcedChallenge = true;
      await debug.capture(page, 'google-challenge');
      log(
        'Google просить підтвердити вхід. Відкрийте телефон дитини (сповіщення Google / Gmail) і натисніть «Так, це я». ' +
          `Робот чекає до ${Math.round(CHALLENGE_WAIT_MS / 60000)} хв.`,
      );
    }
  }
  await debug.capture(page, 'google-timeout', { mask: ['input[type="password"]'] });
  throw new GoogleLoginError(
    `не дочекалися входу в Google (зупинилися на ${new URL(page.url()).pathname}). ${SESSION_HINT}`,
  );
}
