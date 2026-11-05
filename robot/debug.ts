import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';

/**
 * Налагодження: скріншоти й HTML сторінок, якими ходив робот.
 * Увімкнено лише при ручному запуску з `debug`; у workflow архів шифрується паролем робота,
 * бо там дані дитини.
 */
export class Debug {
  private n = 0;
  constructor(private dir: string | undefined) {}

  get enabled(): boolean {
    return !!this.dir;
  }

  private async path(name: string, ext: string): Promise<string | null> {
    if (!this.dir) return null;
    await mkdir(this.dir, { recursive: true });
    this.n += 1;
    return join(this.dir, `${String(this.n).padStart(2, '0')}-${name}.${ext}`);
  }

  async capture(page: Page, name: string, opts: { mask?: string[] } = {}): Promise<void> {
    const png = await this.path(name, 'png');
    if (!png) return;
    try {
      await page.screenshot({ path: png, fullPage: true, mask: (opts.mask ?? []).map((s) => page.locator(s)) });
      // Поле пароля в HTML не потрапляє: value не серіалізується, якщо його не задано атрибутом.
      await writeFile(png.replace(/\.png$/, '.html'), `<!-- ${page.url()} -->\n${await page.content()}`);
    } catch (e) {
      console.log(`debug: не вдалося зберегти ${name}: ${String(e)}`);
    }
  }

  async json(name: string, data: unknown): Promise<void> {
    const p = await this.path(name, 'json');
    if (p) await writeFile(p, JSON.stringify(data, null, 2));
  }
}
