-- ============================
-- READ-ONLY CACHE TABLES
-- (pulled from Supabase, never edited on-device)
-- ============================

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  resource_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  key_terms TEXT,              -- JSON stored as string, parse with JSON.parse()
  difficulty TEXT DEFAULT 'easy',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  difficulty TEXT DEFAULT 'easy',
  type TEXT DEFAULT 'open_ended',
  choices TEXT,                -- JSON stored as string
  created_at TEXT
);

-- ============================
-- READ-WRITE TABLES
-- (created/updated on-device, need a synced flag)
-- ============================

CREATE TABLE IF NOT EXISTS module_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  mastery_score REAL DEFAULT 0.0,
  times_reviewed INTEGER DEFAULT 0,
  is_completed INTEGER DEFAULT 0,   -- 0 = false, 1 = true (SQLite has no boolean type)
  updated_at TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS flashcard_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  flashcard_id TEXT NOT NULL,
  was_correct INTEGER DEFAULT 0,
  times_seen INTEGER DEFAULT 0,
  last_seen_at TEXT,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS module_chats (
  id TEXT PRIMARY KEY,           -- UUID generated on-device
  module_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,            -- 'user' or 'assistant'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);