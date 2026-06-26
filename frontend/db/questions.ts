import { getDb } from './index'

// Mirrors Supabase's `questions` table. `choices` is stored as a JSON
// string (SQLite has no array/object column type) — parse it with
// JSON.parse() on the way out when type === 'multiple_choice'.
export interface LocalQuestion {
  id: string
  module_id: string
  conversation_id: string | null
  question_text: string
  correct_answer: string
  difficulty: string
  type: string // 'open_ended' | 'multiple_choice'
  choices: string | null // JSON-encoded array, or null for open_ended
  created_at: string | null
}

// Returns every question cached for a module. Like flashcards, this is
// a read-only cache — the quiz screen reads straight from here with no
// network call, so a quiz can be taken with the device fully offline as
// long as the module was opened at least once while online.
export async function getLocalQuestions(
  moduleId: string,
): Promise<LocalQuestion[]> {
  const db = await getDb()
  return db.getAllAsync<LocalQuestion>(
    `SELECT * FROM questions WHERE module_id = ? ORDER BY created_at ASC`,
    [moduleId],
  )
}

export async function getLocalQuestionsForConversation(
  conversationId: string,
): Promise<LocalQuestion[]> {
  const db = await getDb()
  return db.getAllAsync<LocalQuestion>(
    `SELECT * FROM questions WHERE conversation_id = ? ORDER BY created_at ASC`,
    [conversationId],
  )
}

// Caches a batch of questions fetched from GET /modules/:id/questions.
// Same INSERT OR REPLACE approach as flashcards.ts — the server is the
// only piece that creates or edits questions, so overwriting the local
// cache with the latest copy is always safe.
export async function insertOrReplaceQuestions(
  questions: Array<{
    id: string
    module_id: string
    conversation_id?: string | null
    question_text: string
    correct_answer: string
    difficulty: string
    type: string
    choices: unknown[] | null
    created_at: string
  }>,
): Promise<void> {
  if (questions.length === 0) return

  const db = await getDb()

  await db.withTransactionAsync(async () => {
    for (const q of questions) {
      await db.runAsync(
        `INSERT OR REPLACE INTO questions
          (id, module_id, conversation_id, question_text, correct_answer, difficulty, type, choices, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          q.id,
          q.module_id,
          q.conversation_id || null,
          q.question_text,
          q.correct_answer,
          q.difficulty,
          q.type,
          // choices comes back from the API as a real array (jsonb column
          // on the Supabase side) — SQLite needs it as a TEXT string, so
          // stringify it here and JSON.parse() it back when reading.
          q.choices ? JSON.stringify(q.choices) : null,
          q.created_at,
        ],
      )
    }
  })
}
