import type { BrowserContext, Page } from 'playwright';

import type { Grade } from '../src/core/types';
import { appointmentsToGrades, type EsAppointment } from '../src/providers/eschool/parse';
import type { Debug } from './debug';

export { appointmentsToGrades };

const DIARY = 'https://diary.eschool-ua.com/';

async function apiGet<T>(page: Page, path: string): Promise<{ status: number; body: T | null }> {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: 'include', headers: { Accept: 'application/json' } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // не JSON
    }
    return { status: res.status, body };
  }, path) as Promise<{ status: number; body: T | null }>;
}

async function login(page: Page, username: string, password: string, debug: Debug): Promise<void> {
  await page.goto(DIARY, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Щоденник або одразу відкривається (сесія жива), або перекидає на eschool-ua.com/login.
  const form = page.locator('input[name="username"]');
  try {
    await form.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    if (page.url().startsWith(DIARY)) return; // уже увійшли
    await debug.capture(page, 'eschool-no-form');
    throw new Error(`не відкрилась форма входу (${page.url()})`);
  }
  await form.fill(username);
  await page.locator('input[name="password"]').fill(password);
  await debug.capture(page, 'eschool-login-filled', { mask: ['input[name="password"]'] });
  await page.locator('form button[type="submit"]').filter({ hasText: /Увійти|Log ?in|Sign ?in/i }).first().click();
  try {
    await page.waitForURL((u) => u.hostname === 'diary.eschool-ua.com', { timeout: 45_000 });
  } catch {
    await debug.capture(page, 'eschool-login-failed', { mask: ['input[name="password"]'] });
    const msg = await page
      .locator('[role="alert"], [data-slot="form-message"], .text-text-error-primary, [aria-live]')
      .allInnerTexts()
      .catch(() => []);
    const hint = msg
      .map((s) => s.trim().replace(/\.+$/, ''))
      .filter(Boolean)
      .join('; ');
    throw new Error(`не вдалося увійти${hint ? `: ${hint}` : ''}. Перевірте ESCHOOL_LOGIN / ESCHOOL_PASSWORD.`);
  }
}

interface Profile {
  Id?: number;
  SchoolId?: number;
}

/**
 * Заходить у «Єдину школу» логіном учня (diary.eschool-ua.com) і читає оцінки за період.
 * Сам вхід — через звичайну форму в браузері, далі — ті самі запити, що робить щоденник.
 */
export async function fetchEschoolGrades(
  ctx: BrowserContext,
  creds: { login: string; password: string },
  from: string,
  to: string,
  debug: Debug,
): Promise<Grade[]> {
  const page = await ctx.newPage();
  try {
    await login(page, creds.login, creds.password, debug);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (page.url().includes('no-student-profile')) {
      throw new Error('цей акаунт не має профілю учня. Потрібен логін дитини (номер телефону 380…), а не батьків.');
    }

    // Щоденник після входу ще «прив'язує» сесію — даємо кілька спроб.
    let profile: Profile | null = null;
    for (let i = 0; i < 5 && !profile?.SchoolId; i++) {
      const r = await apiGet<Profile>(page, '/api/profile');
      if (r.status === 200 && r.body?.SchoolId) profile = r.body;
      else await page.waitForTimeout(3000);
    }
    if (!profile?.SchoolId || !profile.Id) {
      await debug.capture(page, 'eschool-no-profile');
      throw new Error('увійшли, але не вдалося прочитати профіль учня');
    }

    const q = new URLSearchParams({ start: from, end: to, embed: 'Rate,Topic', fileRole: 'schoolboy' });
    const r = await apiGet<{ Items?: EsAppointment[] }>(
      page,
      `/api/v1/${profile.SchoolId}/SchoolBoy/${profile.Id}/Appointment?${q}`,
    );
    if (r.status !== 200 || !r.body) throw new Error(`розклад з оцінками: HTTP ${r.status}`);
    await debug.json('eschool-appointments', r.body);
    return appointmentsToGrades(r.body.Items ?? []);
  } finally {
    await page.close();
  }
}
