/**
 * Обробка оновлень Telegram: реєстрація чатів батьків і прив'язка до дітей.
 *
 *   /start            записати чат (is_active = 1), привітання й інструкція
 *   /link <код>       прив'язати дитину одноразовим кодом
 *   /children         список прив'язаних дітей
 *   /unlink <ім'я|№>  відв'язати дитину
 *   /stop             вимкнути сповіщення (is_active = 0)
 *   my_chat_member    бота заблоковано / видалено з групи → is_active = 0
 */
import { parseCommand } from './commands';
import { redeemLinkCode } from './linkCodes';
import { deactivateChat, sendMessage, type TelegramDeps } from './telegram';

// Мінімальні типи потрібних полів Telegram Bot API.
export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: { id: number; language_code?: string; is_bot?: boolean };
  text?: string;
}
export interface TgChatMemberUpdated {
  chat: TgChat;
  new_chat_member: { status: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
}

export const TEXTS = {
  welcome: [
    'Вітаю! Я бот Lesson Guard: надсилаю батькам сповіщення про нові завдання, погані оцінки й порожні здачі.',
    '',
    'Щоб отримувати сповіщення про дитину, прив\'яжіть її одноразовим кодом:',
    '/link КОД',
    '',
    'Код діє 24 години. Його створює адміністратор (GitHub Actions → Deploy Worker → link-code).',
  ].join('\n'),
  help: [
    'Команди:',
    '/start — увімкнути бота',
    '/link КОД — прив\'язати дитину за кодом',
    '/children — список прив\'язаних дітей',
    '/unlink ІМ\'Я — відв\'язати дитину',
    '/stop — вимкнути сповіщення в цьому чаті',
  ].join('\n'),
  linkUsage: 'Надішліть код разом із командою, наприклад:\n/link ABCDE-FGHJK',
  linkInvalid: 'Код не підійшов. Перевірте його або попросіть новий.',
  linkRateLimited: 'Забагато невдалих спроб. Спробуйте ще раз через годину.',
  linked: (child: string) => `Готово! Тепер у цей чат приходитимуть сповіщення про: ${child}.`,
  noChildren: 'До цього чату ще не прив\'язано жодної дитини. Надішліть /link КОД.',
  childrenList: (lines: string[]) => `Сповіщення приходять про:\n${lines.join('\n')}\n\nВідв'язати: /unlink ІМ'Я`,
  unlinkUsage: 'Вкажіть, кого відв\'язати, наприклад:\n/unlink Олена\n(або номер зі списку /children)',
  unlinkNotFound: 'Такої дитини серед прив\'язаних немає. Список: /children',
  unlinkAmbiguous: 'Знайдено кілька дітей з таким ім\'ям. Вкажіть номер зі списку /children, наприклад: /unlink 2',
  unlinked: (child: string) => `Готово. Сповіщення про ${child} більше не приходитимуть у цей чат.`,
  stopped: 'Сповіщення в цьому чаті вимкнено. Щоб увімкнути знову, надішліть /start.',
  internalError: 'Сталася помилка. Спробуйте, будь ласка, пізніше.',
};

export interface BotDeps extends TelegramDeps {
  now?: () => Date;
}

function chatTitle(chat: TgChat): string | null {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  return name || null;
}

/** Записує або оновлює чат. activate = true вмикає сповіщення (is_active = 1). */
export async function upsertChat(db: D1Database, msg: TgMessage, activate: boolean): Promise<void> {
  const { chat } = msg;
  await db
    .prepare(
      `INSERT INTO telegram_chats (chat_id, title, username, language_code, is_active)
       VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT (chat_id) DO UPDATE SET
         title = excluded.title,
         username = excluded.username,
         language_code = COALESCE(excluded.language_code, telegram_chats.language_code),
         is_active = CASE WHEN ?5 THEN 1 ELSE telegram_chats.is_active END,
         updated_at = datetime('now')`,
    )
    .bind(chat.id, chatTitle(chat), chat.username ?? null, msg.from?.language_code ?? null, activate ? 1 : 0)
    .run();
}

export function childLabel(c: { name: string; class_name: string | null }): string {
  return c.class_name ? `${c.name} (${c.class_name})` : c.name;
}

interface LinkedChild {
  id: number;
  name: string;
  class_name: string | null;
}

async function linkedChildren(db: D1Database, chatId: number): Promise<LinkedChild[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.class_name FROM chat_children cc
       JOIN children c ON c.id = cc.child_id
       WHERE cc.chat_id = ? ORDER BY c.name, c.id`,
    )
    .bind(chatId)
    .all<LinkedChild>();
  return results;
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk');

/** Вибирає дитину для /unlink: за номером зі списку, «ім'я (клас)» або ім'ям. */
export function pickChild(
  children: LinkedChild[],
  query: string,
): { child: LinkedChild } | { error: 'not_found' | 'ambiguous' } {
  const q = norm(query);
  if (/^\d+$/.test(q)) {
    const c = children[Number(q) - 1];
    return c ? { child: c } : { error: 'not_found' };
  }
  const byLabel = children.filter((c) => norm(childLabel(c)) === q);
  if (byLabel.length === 1) return { child: byLabel[0] };
  const byName = children.filter((c) => norm(c.name) === q);
  if (byName.length === 1) return { child: byName[0] };
  if (byName.length > 1 || byLabel.length > 1) return { error: 'ambiguous' };
  return { error: 'not_found' };
}

/** Обробляє одне оновлення. Помилки прокидає нагору — їх ловить handleUpdateSafe. */
export async function handleUpdate(update: TgUpdate, deps: BotDeps): Promise<void> {
  const { db } = deps;

  if (update.my_chat_member) {
    const status = update.my_chat_member.new_chat_member.status;
    if (status === 'kicked' || status === 'left') {
      await deactivateChat(db, update.my_chat_member.chat.id);
    }
    return;
  }

  const msg = update.message;
  if (!msg || msg.from?.is_bot) return;
  const chatId = msg.chat.id;
  const reply = (text: string) => sendMessage(deps, chatId, text);
  const cmd = parseCommand(msg.text);

  if (!cmd) {
    // У групах на звичайні повідомлення не відповідаємо.
    if (msg.chat.type === 'private' && msg.text !== undefined) await reply(TEXTS.help);
    return;
  }

  switch (cmd.name) {
    case 'start':
      await upsertChat(db, msg, true);
      await reply(TEXTS.welcome);
      return;

    case 'stop':
      await upsertChat(db, msg, false);
      await deactivateChat(db, chatId);
      await reply(TEXTS.stopped);
      return;

    case 'link': {
      if (!cmd.args) {
        await reply(TEXTS.linkUsage);
        return;
      }
      await upsertChat(db, msg, true);
      const res = await redeemLinkCode(db, chatId, cmd.args, deps.now?.());
      if (res.ok) {
        await reply(TEXTS.linked(childLabel({ name: res.childName, class_name: res.className })));
      } else {
        await reply(res.reason === 'rate_limited' ? TEXTS.linkRateLimited : TEXTS.linkInvalid);
      }
      return;
    }

    case 'children': {
      await upsertChat(db, msg, false);
      const list = await linkedChildren(db, chatId);
      await reply(list.length ? TEXTS.childrenList(list.map((c, i) => `${i + 1}. ${childLabel(c)}`)) : TEXTS.noChildren);
      return;
    }

    case 'unlink': {
      if (!cmd.args) {
        await reply(TEXTS.unlinkUsage);
        return;
      }
      await upsertChat(db, msg, false);
      const picked = pickChild(await linkedChildren(db, chatId), cmd.args);
      if ('error' in picked) {
        await reply(picked.error === 'ambiguous' ? TEXTS.unlinkAmbiguous : TEXTS.unlinkNotFound);
        return;
      }
      await db
        .prepare('DELETE FROM chat_children WHERE chat_id = ? AND child_id = ?')
        .bind(chatId, picked.child.id)
        .run();
      await reply(TEXTS.unlinked(childLabel(picked.child)));
      return;
    }

    case 'help':
    default:
      await reply(TEXTS.help);
  }
}

/**
 * Обгортка для вебхука: будь-яка помилка логується, а в чат (якщо відомий)
 * надсилається коротке повідомлення. Сам вебхук усе одно відповідає 200.
 */
export async function handleUpdateSafe(update: TgUpdate, deps: BotDeps): Promise<void> {
  try {
    await handleUpdate(update, deps);
  } catch (e) {
    console.error(`Помилка обробки update_id=${update?.update_id}:`, e);
    const chatId = update?.message?.chat?.id;
    if (typeof chatId === 'number') await sendMessage(deps, chatId, TEXTS.internalError);
  }
}
