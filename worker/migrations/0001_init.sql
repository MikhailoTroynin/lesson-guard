-- Lesson Guard: початкова схема D1 (SQLite).
-- Застосовується вручну: Actions → Deploy Worker → Run workflow → action = migrate.
-- Час зберігається як TEXT у форматі ISO-8601 UTC (datetime('now')).

-- Діти, за якими стежимо.
CREATE TABLE children (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  class_name    TEXT,                       -- наприклад «7-А»
  eschool_id    TEXT    UNIQUE,             -- id учня в «Єдиній школі»
  classroom_id  TEXT    UNIQUE,             -- id користувача в Google Класі
  bad_grade_threshold INTEGER NOT NULL DEFAULT 7
                CHECK (bad_grade_threshold BETWEEN 1 AND 12),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Чати Telegram батьків (приватний чат або група).
CREATE TABLE telegram_chats (
  chat_id       INTEGER PRIMARY KEY,        -- id чату Telegram (може бути від'ємним для груп)
  title         TEXT,                       -- ім'я користувача або назва групи
  username      TEXT,
  language_code TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),  -- 0 після /stop або блокування бота
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Хто з батьків отримує сповіщення про яку дитину (багато-до-багатьох).
CREATE TABLE chat_children (
  chat_id       INTEGER NOT NULL REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
  child_id      INTEGER NOT NULL REFERENCES children(id)            ON DELETE CASCADE,
  notify_grades      INTEGER NOT NULL DEFAULT 1 CHECK (notify_grades IN (0, 1)),
  notify_assignments INTEGER NOT NULL DEFAULT 1 CHECK (notify_assignments IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, child_id)
);
CREATE INDEX idx_chat_children_child ON chat_children(child_id);

-- Завдання (Google Клас та інші джерела).
CREATE TABLE assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id      INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL CHECK (source IN ('classroom', 'eschool')),
  external_id   TEXT    NOT NULL,           -- id завдання в джерелі
  subject       TEXT    NOT NULL,           -- курс / предмет
  title         TEXT    NOT NULL,
  url           TEXT,
  assigned_at   TEXT,                       -- коли видано
  due_at        TEXT,                       -- дедлайн
  status        TEXT    NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned', 'turned_in', 'returned', 'missing')),
  is_empty_submission INTEGER NOT NULL DEFAULT 0 CHECK (is_empty_submission IN (0, 1)),
  first_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (child_id, source, external_id)
);
CREATE INDEX idx_assignments_child_subject ON assignments(child_id, subject, assigned_at);

-- Оцінки («Єдина школа»).
CREATE TABLE grades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id      INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL CHECK (source IN ('eschool', 'classroom')),
  external_id   TEXT    NOT NULL,           -- id оцінки в джерелі (або стабільний хеш)
  subject       TEXT    NOT NULL,
  value_raw     TEXT    NOT NULL,           -- як у журналі: «5», «н», «зар.»
  value_num     INTEGER CHECK (value_num IS NULL OR value_num BETWEEN 1 AND 12),
  lesson_date   TEXT    NOT NULL,           -- дата уроку (YYYY-MM-DD)
  comment       TEXT,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,  -- прив'язка до завдання
  first_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (child_id, source, external_id)
);
CREATE INDEX idx_grades_child_date ON grades(child_id, lesson_date);

-- Журнал надісланих сповіщень. UNIQUE (chat_id, dedupe_key) гарантує,
-- що одне й те саме сповіщення не піде в чат двічі (INSERT ... ON CONFLICT DO NOTHING
-- перед відправкою).
CREATE TABLE notifications_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id       INTEGER NOT NULL REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
  child_id      INTEGER REFERENCES children(id) ON DELETE SET NULL,
  kind          TEXT    NOT NULL
                CHECK (kind IN ('new_assignment', 'bad_grade', 'empty_submission', 'other')),
  dedupe_key    TEXT    NOT NULL,           -- напр. 'bad_grade:eschool:<external_id>'
  grade_id      INTEGER REFERENCES grades(id)      ON DELETE SET NULL,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed')),
  telegram_message_id INTEGER,
  error         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT,
  UNIQUE (chat_id, dedupe_key)
);
CREATE INDEX idx_notifications_status ON notifications_log(status, created_at);
