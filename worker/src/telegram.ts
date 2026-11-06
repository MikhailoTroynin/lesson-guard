/**
 * Відправка повідомлень у Telegram Bot API.
 *
 * sendMessage ніколи не кидає виняток: повертає результат. Якщо Telegram
 * відповів 403 (бота заблоковано, видалено з групи тощо), чат позначається
 * неактивним (telegram_chats.is_active = 0), щоб більше туди не писати.
 */

export interface SendResult {
  ok: boolean;
  status: number;
  messageId?: number;
  description?: string;
}

export interface TelegramDeps {
  db: D1Database;
  botToken: string;
  fetch?: typeof fetch;
}

export async function deactivateChat(db: D1Database, chatId: number): Promise<void> {
  await db
    .prepare("UPDATE telegram_chats SET is_active = 0, updated_at = datetime('now') WHERE chat_id = ?")
    .bind(chatId)
    .run();
}

export async function sendMessage(deps: TelegramDeps, chatId: number, text: string): Promise<SendResult> {
  const doFetch = deps.fetch ?? fetch;
  let status = 0;
  try {
    const res = await doFetch(`https://api.telegram.org/bot${deps.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    });
    status = res.status;
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (res.ok && data.ok) {
      return { ok: true, status, messageId: data.result?.message_id };
    }
    if (status === 403) {
      console.warn(`sendMessage: 403 для чату ${chatId} — позначаю неактивним (${data.description ?? ''})`);
      await deactivateChat(deps.db, chatId);
    } else {
      console.error(`sendMessage: ${status} для чату ${chatId}: ${data.description ?? ''}`);
    }
    return { ok: false, status, description: data.description };
  } catch (e) {
    console.error(`sendMessage: помилка для чату ${chatId}:`, e);
    return { ok: false, status, description: String(e) };
  }
}
