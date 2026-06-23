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
      "PRAGMA table_info(module_chats)"
    )
    const hasConvId = columns.some(c => c.name === 'conversation_id')
    if (columns.length > 0 && !hasConvId) {
      console.log('Migrating module_chats table to add conversation_id column...')
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
  `)

  return database
}
