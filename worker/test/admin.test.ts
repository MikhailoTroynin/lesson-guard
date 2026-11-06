import { describe, expect, it, vi } from 'vitest';
import { adminToken, webhookSecret } from '../src/crypto';
import worker from '../src/index';
import { hashCode, normalizeCode } from '../src/linkCodes';
import { FakeD1 } from './d1';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const TOKEN = '123:TEST';

async function call(db: FakeD1, body: unknown, auth?: string) {
  const req = new Request('https://x/admin/link-code', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
  });
  return worker.fetch(req, { DB: db.d1, TELEGRAM_BOT_TOKEN: TOKEN }, ctx);
}

describe('POST /admin/link-code', () => {
  it('адмін-токен відрізняється від секрету вебхука', async () => {
    expect(await adminToken(TOKEN)).not.toBe(await webhookSecret(TOKEN));
  });

  it('без токена або з секретом вебхука — 401', async () => {
    const db = new FakeD1();
    expect((await call(db, { name: 'Олена' })).status).toBe(401);
    expect((await call(db, { name: 'Олена' }, await webhookSecret(TOKEN))).status).toBe(401);
    expect(db.rows('SELECT * FROM children')).toEqual([]);
  });

  it('створює дитину один раз і новий код щоразу', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const db = new FakeD1();
    const auth = await adminToken(TOKEN);
    const r1 = await call(db, { name: '  Олена ', class_name: '7-А' }, auth);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { code: string; child: { id: number; created: boolean } };
    expect(b1.code).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}$/);
    expect(b1.child).toMatchObject({ created: true, name: 'Олена', class_name: '7-А' });

    const b2 = (await (await call(db, { name: 'Олена', class_name: '7-А' }, auth)).json()) as typeof b1;
    expect(b2.child).toMatchObject({ id: b1.child.id, created: false });
    expect(b2.code).not.toBe(b1.code);

    const hashes = db.rows<{ code_hash: string }>('SELECT code_hash FROM link_codes ORDER BY id').map((r) => r.code_hash);
    expect(hashes).toEqual([await hashCode(normalizeCode(b1.code)!), await hashCode(normalizeCode(b2.code)!)]);
    // Код не потрапляє в логи Worker'а.
    expect(JSON.stringify(log.mock.calls)).not.toContain(b1.code);
    log.mockRestore();
  });

  it('валідація імені', async () => {
    const db = new FakeD1();
    const auth = await adminToken(TOKEN);
    expect((await call(db, { name: '  ' }, auth)).status).toBe(400);
    expect((await call(db, { name: 'x'.repeat(101) }, auth)).status).toBe(400);
    expect((await call(db, { name: 'Олена', class_name: 'x'.repeat(21) }, auth)).status).toBe(400);
  });

  it('GET — 405', async () => {
    const res = await worker.fetch(
      new Request('https://x/admin/link-code'),
      { DB: new FakeD1().d1, TELEGRAM_BOT_TOKEN: TOKEN },
      ctx,
    );
    expect(res.status).toBe(405);
  });
});

describe('мітки HMAC у скриптах збігаються з Worker\'ом', () => {
  it('set-webhook.mjs і link-code.mjs', async () => {
    const { readFileSync } = await import('node:fs');
    const { ADMIN_TOKEN_LABEL, WEBHOOK_SECRET_LABEL } = await import('../src/crypto');
    const read = (f: string) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');
    expect(read('set-webhook.mjs')).toContain(`'${WEBHOOK_SECRET_LABEL}'`);
    expect(read('link-code.mjs')).toContain(`'${ADMIN_TOKEN_LABEL}'`);
  });
});
