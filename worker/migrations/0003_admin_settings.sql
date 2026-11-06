-- Lesson Guard: сторінка налаштувань (GitHub Pages) → Worker.
-- Вхід на сторінку — через Telegram, налаштування і дані робота — у D1.

-- Хто може відкривати сторінку налаштувань (приватні чати Telegram).
-- Перший чат, який підтвердив вхід, стає адміністратором автоматично.
CREATE TABLE admins (
  chat_id     INTEGER PRIMARY KEY REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Запити на вхід: сторінка тримає request (секрет), у Telegram іде nonce
-- (посилання t.me/<бот>?start=login_<nonce>). Зберігаються лише SHA-256.
CREATE TABLE admin_logins (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_hash      TEXT NOT NULL UNIQUE,
  nonce_hash        TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at        TEXT NOT NULL,
  approved_chat_id  INTEGER,
  approved_at       TEXT,
  consumed_at       TEXT
);

-- Сесії сторінки (Bearer-токен у браузері; у базі — SHA-256).
CREATE TABLE admin_sessions (
  token_hash    TEXT PRIMARY KEY,
  chat_id       INTEGER NOT NULL REFERENCES admins(chat_id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX idx_admin_sessions_chat ON admin_sessions(chat_id);

-- Загальні налаштування (JSON-значення): поріг оцінки, сповіщення, відповідність предметів,
-- а також стан останнього запуску робота (без даних дитини).
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Зашифроване сховище (AES-256-GCM, ключ виводиться з токена бота):
-- логін/пароль Єдиної школи, сесія Google, пам'ять робота, останній знімок даних.
CREATE TABLE vault (
  name        TEXT PRIMARY KEY,
  iv          TEXT NOT NULL,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
