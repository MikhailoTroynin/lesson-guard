-- Lesson Guard: одноразові коди прив'язки чату батьків до дитини.
-- Код створюється з GitHub Actions (Deploy Worker → action = link-code) і
-- вводиться в боті командою /link <код>. Сам код не зберігається — лише його
-- SHA-256 (hex). Час — TEXT у форматі datetime('now'): 'YYYY-MM-DD HH:MM:SS' UTC.

CREATE TABLE link_codes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash       TEXT    NOT NULL UNIQUE,      -- hex(SHA-256(нормалізований код))
  child_id        INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT    NOT NULL,             -- created_at + 24 год
  used_at         TEXT,                         -- NULL, поки код не використано
  used_by_chat_id INTEGER REFERENCES telegram_chats(chat_id) ON DELETE SET NULL
);
CREATE INDEX idx_link_codes_child ON link_codes(child_id);

-- Невдалі спроби /link: обмеження кількості спроб на чат за ковзне вікно.
CREATE TABLE link_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id       INTEGER NOT NULL,
  attempted_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_link_attempts_chat ON link_attempts(chat_id, attempted_at);
