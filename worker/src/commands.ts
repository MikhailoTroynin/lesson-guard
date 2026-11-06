/** Розбір команд Telegram: «/link@MyBot  ABC-123» → { name: 'link', args: 'ABC-123' }. */

export interface ParsedCommand {
  /** Назва команди в нижньому регістрі, без «/» і без «@бот». */
  name: string;
  /** Решта тексту після команди, обрізана з обох боків. */
  args: string;
  /** Ім'я бота після «@», якщо команду адресовано конкретному боту. */
  botUsername?: string;
}

const COMMAND_RE = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?=\s|$)/;

/** Повертає null, якщо текст не починається з команди. */
export function parseCommand(text: string | undefined | null): ParsedCommand | null {
  if (!text) return null;
  const trimmed = text.trimStart();
  const m = COMMAND_RE.exec(trimmed);
  if (!m) return null;
  const cmd: ParsedCommand = {
    name: m[1].toLowerCase(),
    args: trimmed.slice(m[0].length).trim(),
  };
  if (m[2]) cmd.botUsername = m[2];
  return cmd;
}
