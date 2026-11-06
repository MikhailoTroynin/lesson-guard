import { beforeEach, describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_FAILED_ATTEMPTS,
  createLinkCode,
  findOrCreateChild,
  formatCode,
  generateCode,
  hashCode,
  normalizeCode,
  redeemLinkCode,
} from '../src/linkCodes';
import { FakeD1 } from './d1';

const CHAT = 1001;
const OTHER = 2002;

function addChat(db: FakeD1, chatId: number) {
  db.sqlite.prepare('INSERT INTO telegram_chats (chat_id) VALUES (?)').run(chatId);
}

describe('генерація й нормалізація кодів', () => {
  it('код має потрібну довжину й алфавіт', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });
  it('відкидає байти, що дають зміщення', () => {
    // 248 і вище відкидаються (256 - 256 % 31 = 248).
    let calls = 0;
    const rnd = (n: number) => {
      calls++;
      return calls === 1 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(31);
    };
    expect(generateCode(rnd)).toBe('2'.repeat(CODE_LENGTH));
  });
  it('нормалізує регістр, дефіси, пробіли й кириличні двійники', () => {
    expect(normalizeCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeCode(' ABCDE FGHJK ')).toBe('ABCDEFGHJK');
    expect(normalizeCode('АВСЕН-КМРТХ')).toBe('ABCEHKMPTX'); // кирилиця
  });
  it('відкидає те, що не може бути кодом', () => {
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('ABCDE-FGHJ0')).toBeNull(); // 0 немає в алфавіті
    expect(normalizeCode('ABCDE-FGHJKL')).toBeNull();
  });
  it('formatCode', () => {
    expect(formatCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
  });
});

describe('коди в базі', () => {
  let db: FakeD1;
  let childId: number;
  const t0 = new Date('2026-11-06T10:00:00Z');

  beforeEach(async () => {
    db = new FakeD1();
    addChat(db, CHAT);
    addChat(db, OTHER);
    childId = (await findOrCreateChild(db.d1, 'Олена', '7-А')).id;
  });

  it('findOrCreateChild не дублює дитину, але розрізняє клас', async () => {
    expect(await findOrCreateChild(db.d1, 'Олена', '7-А')).toEqual({ id: childId, created: false });
    const other = await findOrCreateChild(db.d1, 'Олена', null);
    expect(other.created).toBe(true);
    expect(await findOrCreateChild(db.d1, 'Олена', null)).toEqual({ id: other.id, created: false });
  });

  it('зберігає лише хеш, строк дії — 24 год', async () => {
    const { code, expiresAt } = await createLinkCode(db.d1, childId, t0);
    expect(expiresAt).toBe('2026-11-07 10:00:00');
    const [row] = db.rows<{ code_hash: string }>('SELECT * FROM link_codes');
    expect(row.code_hash).toBe(await hashCode(normalizeCode(code)!));
    expect(JSON.stringify(row)).not.toContain(code.replace('-', ''));
  });

  it('успішна прив\'язка, потім код уже не працює', async () => {
    const { code } = await createLinkCode(db.d1, childId, t0);
    const res = await redeemLinkCode(db.d1, CHAT, code.toLowerCase(), new Date(t0.getTime() + 1000));
    expect(res).toEqual({ ok: true, childId, childName: 'Олена', className: '7-А' });
    expect(db.rows('SELECT chat_id, child_id FROM chat_children')).toEqual([{ chat_id: CHAT, child_id: childId }]);
    const [lc] = db.rows<{ used_by_chat_id: number; used_at: string }>('SELECT * FROM link_codes');
    expect(lc.used_by_chat_id).toBe(CHAT);
    expect(lc.used_at).toBe('2026-11-06 10:00:01');

    // Повторно — і тим самим, і іншим чатом — «invalid».
    expect(await redeemLinkCode(db.d1, CHAT, code, t0)).toEqual({ ok: false, reason: 'invalid' });
    expect(await redeemLinkCode(db.d1, OTHER, code, t0)).toEqual({ ok: false, reason: 'invalid' });
    expect(db.rows('SELECT * FROM chat_children WHERE chat_id = ?', OTHER)).toEqual([]);
  });

  it('використаний код не повертає відв\'язану дитину', async () => {
    const { code } = await createLinkCode(db.d1, childId, t0);
    await redeemLinkCode(db.d1, CHAT, code, t0);
    db.sqlite.prepare('DELETE FROM chat_children').run();
    expect((await redeemLinkCode(db.d1, CHAT, code, t0)).ok).toBe(false);
    expect(db.rows('SELECT * FROM chat_children')).toEqual([]);
  });

  it('прострочений код — «invalid»', async () => {
    const { code } = await createLinkCode(db.d1, childId, t0);
    const later = new Date(t0.getTime() + 24 * 3600 * 1000);
    expect(await redeemLinkCode(db.d1, CHAT, code, later)).toEqual({ ok: false, reason: 'invalid' });
    expect(db.rows('SELECT * FROM chat_children')).toEqual([]);
  });

  it('неправильний код — «invalid»', async () => {
    await createLinkCode(db.d1, childId, t0);
    expect(await redeemLinkCode(db.d1, CHAT, 'ZZZZZ-ZZZZZ', t0)).toEqual({ ok: false, reason: 'invalid' });
    expect(await redeemLinkCode(db.d1, CHAT, 'абв', t0)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('обмежує невдалі спроби на чат, вікно — година', async () => {
    const { code } = await createLinkCode(db.d1, childId, t0);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      expect((await redeemLinkCode(db.d1, CHAT, 'ZZZZZ-ZZZZZ', t0)).ok).toBe(false);
    }
    // Навіть правильний код не перевіряється, поки діє блокування.
    expect(await redeemLinkCode(db.d1, CHAT, code, t0)).toEqual({ ok: false, reason: 'rate_limited' });
    // Інший чат не заблоковано.
    expect((await redeemLinkCode(db.d1, OTHER, 'ZZZZZ-ZZZZZ', t0)).ok).toBe(false);
    // Через годину можна знову.
    const later = new Date(t0.getTime() + 3600 * 1000 + 1000);
    expect((await redeemLinkCode(db.d1, CHAT, code, later)).ok).toBe(true);
  });
});
