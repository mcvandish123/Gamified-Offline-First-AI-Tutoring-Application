import * as SQLite from 'expo-sqlite'

let db: SQLite.SQLiteDatabase

export async function getDb() {
  if (!db) {
    db = await SQLite.openDatabaseAsync('tutor.db')
  }
  return db
}

export async function initDb() {
  const database = await getDb()

  // Migration: Add conversation_id column to module_chats if it was created in a previous version of the app
  try {
    const columns = await database.getAllAsync<{ name: string }>(
      'PRAGMA table_info(module_chats)',
    )
    const hasConvId = columns.some((c) => c.name === 'conversation_id')
    if (columns.length > 0 && !hasConvId) {
      console.log(
        'Migrating module_chats table to add conversation_id column...',
      )
      await database.execAsync(`
        ALTER TABLE module_chats RENAME TO temp_module_chats;
        
        CREATE TABLE module_chats (
          id TEXT PRIMARY KEY,
          module_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          synced INTEGER DEFAULT 0
        );
        
        INSERT INTO module_chats (id, module_id, conversation_id, user_id, role, content, created_at, synced)
        SELECT id, module_id, 'legacy', user_id, role, content, created_at, synced FROM temp_module_chats;
        
        DROP TABLE temp_module_chats;
      `)
      console.log('Migration completed successfully!')
    }
  } catch (err) {
    console.error('Migration checks failed:', err)
  }

  // Migration: Add conversation_id column to flashcards if it doesn't exist
  try {
    const columns = await database.getAllAsync<{ name: string }>(
      'PRAGMA table_info(flashcards)',
    )
    const hasConvId = columns.some((c) => c.name === 'conversation_id')
    if (columns.length > 0 && !hasConvId) {
      console.log('Migrating flashcards table to add conversation_id column...')
      await database.execAsync(`
        ALTER TABLE flashcards ADD COLUMN conversation_id TEXT;
      `)
      console.log('Migration of flashcards completed successfully!')
    }
  } catch (err) {
    console.error('Flashcards migration check failed:', err)
  }

  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      resource_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      key_terms TEXT,
      difficulty TEXT DEFAULT 'easy',
      chat_count INTEGER DEFAULT 0,
      created_at TEXT,
      synced INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      conversation_id TEXT,
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
      choices TEXT,
      created_at TEXT
    );

    -- Read-only cache of achievement DEFINITIONS (name, icon, the XP
    -- threshold needed to unlock it, etc). This is the same global list
    -- for every user, pulled from Supabase's public 'achievements' table.
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      xp_reward INTEGER DEFAULT 0,
      condition_type TEXT,
      condition_value INTEGER DEFAULT 0,
      created_at TEXT
    );

    -- Read-only cache of which achievements THIS user has already
    -- unlocked, and when. Unlike module_progress/flashcard_progress,
    -- there's no "synced" flag here on purpose: the device never
    -- decides an achievement is unlocked on its own (some conditions,
    -- like boss battles won, depend on data that isn't cached
    -- on-device). Rows only ever arrive here from a confirmed server
    -- response — either a direct pull, or the "newlyUnlocked" list
    -- returned when a queued flashcard/quiz answer gets synced.
    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      mastery_score REAL DEFAULT 0.0,
      times_reviewed INTEGER DEFAULT 0,
      is_completed INTEGER DEFAULT 0,
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

    -- Local mirror of Supabase's user_progress table. Only ONE row ever
    -- lives here (id is always the fixed string 'local' — see
    -- db/user-progress.ts) because this app only supports one logged-in
    -- user per device at a time. Holding a local copy is what lets the
    -- XP bar / streak counter update INSTANTLY while offline, instead of
    -- waiting for a round trip that can't happen until reconnecting.
    -- synced = 0 means "this device has applied XP gains the server
    -- doesn't know about yet"; it flips back to 1 the moment the queued
    -- flashcard/quiz answers that earned that XP are pushed.
    CREATE TABLE IF NOT EXISTS user_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      total_xp INTEGER DEFAULT 0,
      current_level INTEGER DEFAULT 1,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_active_date TEXT,
      updated_at TEXT,
      synced INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS module_chats (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      file_url TEXT,
      file_type TEXT DEFAULT 'pdf',
      is_processed INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conversation_sources (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      added_at TEXT NOT NULL
    );
  `)

  return database
}
