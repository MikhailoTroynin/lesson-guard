import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEXTS, handleUpdateSafe, pickChild, type TgUpdate } from '../src/bot';
import { webhookSecret } from '../src/crypto';
import { handleTelegramWebhook } from '../src/index';
import { createLinkCode, findOrCreateChild } from '../src/linkCodes';
import { sendMessage } from '../src/telegram';
import { FakeD1 } from './d1';

const TOKEN = '123:TEST';
const CHAT = 555;

interface Sent {
  chat_id: number;
  text: string;
}

function fakeTelegram(status = 200) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    const ok = status === 200;
    return new Response(JSON.stringify(ok ? { ok, result: { message_id: 1 } } : { ok, description: 'Forbidden' }), {
      status,
    });
  });
  return { sent, fetch: fetchImpl as unknown as typeof fetch };
}

let seq = 0;
function msg(text: string, chat: Partial<TgUpdate['message'] & object>['chat'] = undefined): TgUpdate {
  return {
    update_id: ++seq,
    message: {
      message_id: seq,
      chat: chat ?? { id: CHAT, type: 'private', first_name: 'Марія', username: 'maria' },
      from: { id: CHAT, language_code: 'uk' },
      text,
    },
  };
}

describe('бот', () => {
  let db: FakeD1;
  let tg: ReturnType<typeof fakeTelegram>;
  const send = (u: TgUpdate) => handleUpdateSafe(u, { db: db.d1, botToken: TOKEN, fetch: tg.fetch });
  const last = () => tg.sent.at(-1)?.text;
  const chatRow = () =>
    db.rows<{ is_active: number; title: string; username: string }>('SELECT * FROM telegram_chats WHERE chat_id = ?', CHAT)[0];

  beforeEach(() => {
    db = new FakeD1();
    tg = fakeTelegram();
  });

  it('/start записує чат і вітає', async () => {
    await send(msg('/start'));
    expect(chatRow()).toMatchObject({ is_active: 1, title: 'Марія', username: 'maria' });
    expect(last()).toBe(TEXTS.welcome);
    expect(last()).toContain('/link');
  });

  it('/stop вимикає, /start вмикає знову', async () => {
    await send(msg('/start'));
    await send(msg('/stop'));
    expect(chatRow().is_active).toBe(0);
    expect(last()).toBe(TEXTS.stopped);
    await send(msg('/children'));
    expect(chatRow().is_active).toBe(0); // інші команди не вмикають
    await send(msg('/start'));
    expect(chatRow().is_active).toBe(1);
  });

  it('/link, /children, /unlink', async () => {
    const olena = await findOrCreateChild(db.d1, 'Олена', '7-А');
    const ivan = await findOrCreateChild(db.d1, 'Іван', null);
    const c1 = await createLinkCode(db.d1, olena.id);
    const c2 = await createLinkCode(db.d1, ivan.id);

    await send(msg('/children'));
    expect(last()).toBe(TEXTS.noChildren);

    await send(msg('/link'));
    expect(last()).toBe(TEXTS.linkUsage);

    await send(msg(`/link ${c1.code}`));
    expect(last()).toBe(TEXTS.linked('Олена (7-А)'));
    await send(msg(`/link@LessonGuardBot ${c2.code.toLowerCase()}`));
    expect(last()).toBe(TEXTS.linked('Іван'));

    await send(msg('/children'));
    expect(last()).toBe(TEXTS.childrenList(['1. Іван', '2. Олена (7-А)']));

    await send(msg('/unlink Петро'));
    expect(last()).toBe(TEXTS.unlinkNotFound);
    await send(msg('/unlink олена'));
    expect(last()).toBe(TEXTS.unlinked('Олена (7-А)'));
    await send(msg('/unlink 1'));
    expect(last()).toBe(TEXTS.unlinked('Іван'));
    expect(db.rows('SELECT * FROM chat_children')).toEqual([]);
  });

  it('/link з неправильним кодом — без подробиць, далі ліміт', async () => {
    for (let i = 0; i < 5; i++) {
      await send(msg('/link ZZZZZ-ZZZZZ'));
      expect(last()).toBe(TEXTS.linkInvalid);
    }
    await send(msg('/link ZZZZZ-ZZZZZ'));
    expect(last()).toBe(TEXTS.linkRateLimited);
  });

  it('/link до /start створює чат', async () => {
    const c = await findOrCreateChild(db.d1, 'Олена', null);
    const { code } = await createLinkCode(db.d1, c.id);
    await send(msg(`/link ${code}`));
    expect(chatRow().is_active).toBe(1);
    expect(last()).toBe(TEXTS.linked('Олена'));
  });

  it('невідома команда й текст у приватному чаті → довідка; у групі текст ігнорується', async () => {
    await send(msg('/foo'));
    expect(last()).toBe(TEXTS.help);
    await send(msg('привіт'));
    expect(last()).toBe(TEXTS.help);
    const n = tg.sent.length;
    await send(msg('привіт усім', { id: -100, type: 'supergroup', title: 'Батьки 7-А' }));
    expect(tg.sent.length).toBe(n);
    await send(msg('/start@LessonGuardBot', { id: -100, type: 'supergroup', title: 'Батьки 7-А' }));
    expect(db.rows('SELECT title FROM telegram_chats WHERE chat_id = -100')).toEqual([{ title: 'Батьки 7-А' }]);
  });

  it('my_chat_member kicked/left → is_active = 0', async () => {
    await send(msg('/start'));
    await send({
      update_id: ++seq,
      my_chat_member: { chat: { id: CHAT, type: 'private' }, new_chat_member: { status: 'kicked' } },
    });
    expect(chatRow().is_active).toBe(0);
  });

  it('помилка всередині обробки логується, користувачу — коротке повідомлення', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.sqlite.exec('DROP TABLE chat_children');
    await expect(send(msg('/children'))).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    expect(last()).toBe(TEXTS.internalError);
    err.mockRestore();
  });

  it('pickChild: однакові імена → ambiguous', () => {
    const kids = [
      { id: 1, name: 'Олена', class_name: '5-Б' },
      { id: 2, name: 'Олена', class_name: '7-А' },
    ];
    expect(pickChild(kids, 'олена')).toEqual({ error: 'ambiguous' });
    expect(pickChild(kids, 'Олена (7-А)')).toEqual({ child: kids[1] });
    expect(pickChild(kids, '3')).toEqual({ error: 'not_found' });
  });
});

describe('sendMessage', () => {
  it('403 → чат неактивний', async () => {
    const db = new FakeD1();
    db.sqlite.prepare('INSERT INTO telegram_chats (chat_id) VALUES (?)').run(CHAT);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await sendMessage({ db: db.d1, botToken: TOKEN, fetch: fakeTelegram(403).fetch }, CHAT, 'x');
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(db.rows('SELECT is_active FROM telegram_chats')).toEqual([{ is_active: 0 }]);
    warn.mockRestore();
  });

  it('мережева помилка не кидає виняток', async () => {
    const db = new FakeD1();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await sendMessage(
      { db: db.d1, botToken: TOKEN, fetch: (async () => { throw new Error('boom'); }) as unknown as typeof fetch },
      CHAT,
      'x',
    );
    expect(res.ok).toBe(false);
    err.mockRestore();
  });
});

describe('вебхук', () => {
  const env = (db: FakeD1) => ({ DB: db.d1, TELEGRAM_BOT_TOKEN: TOKEN });
  const req = (body: string, secret?: string) =>
    new Request('https://x/telegram/webhook', {
      method: 'POST',
      body,
      headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {},
    });

  it('без секрету — 401', async () => {
    const res = await handleTelegramWebhook(req('{}'), env(new FakeD1()));
    expect(res.status).toBe(401);
  });

  it('некоректний JSON і помилки — все одно 200', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = new FakeD1();
    const secret = await webhookSecret(TOKEN);
    expect((await handleTelegramWebhook(req('not json', secret), env(db))).status).toBe(200);
    db.sqlite.exec('DROP TABLE chat_children');
    const tg = fakeTelegram();
    const res = await handleTelegramWebhook(req(JSON.stringify(msg('/children')), secret), env(db), tg.fetch);
    expect(res.status).toBe(200);
    err.mockRestore();
  });

  it('обробляє /start', async () => {
    const db = new FakeD1();
    const tg = fakeTelegram();
    const res = await handleTelegramWebhook(req(JSON.stringify(msg('/start')), await webhookSecret(TOKEN)), env(db), tg.fetch);
    expect(res.status).toBe(200);
    expect(tg.sent[0]).toMatchObject({ chat_id: CHAT, text: TEXTS.welcome });
  });
});
