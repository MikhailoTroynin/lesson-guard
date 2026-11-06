import type { BrowserContext, Page } from 'playwright';

import type { Debug } from './debug';

export const CLASSROOM = 'https://classroom.google.com';

export class GoogleLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleLoginError';
  }
}

function isClassroom(u: string): boolean {
  return new URL(u).hostname === 'classroom.google.com';
}

/**
 * Відкриває Google Клас збереженою сесією (cookies з віддаленого входу або з
 * `npm run robot:session`). Паролем робот не входить: Google відхиляє вхід з
 * автоматизованого браузера, тож усі входи робить людина — у звичайному Chrome.
 */
export async function ensureGoogleSession(ctx: BrowserContext, debug: Debug, log: (s: string) => void): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${CLASSROOM}/u/0/h`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  if (isClassroom(page.url())) {
    log('Google: сесія дійсна');
    return page;
  }
  await debug.capture(page, 'google-session-expired');
  throw new GoogleLoginError(
    `сесія Google більше не діє (Google відкрив ${new URL(page.url()).hostname}). Натисніть «Увійти через віддалений браузер» на сторінці налаштувань ще раз.`,
  );
}
