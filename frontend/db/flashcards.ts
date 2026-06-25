import { getDb } from './index'

// Shape of a row in the local `flashcards` table. This mirrors Supabase's
// `flashcards` table — it's a read-only cache, so there's no `synced`
// flag here (nothing local ever needs to be pushed back up).
export interface LocalFlashcard {
  id: string
  module_id: string
  front: string
  back: string
  created_at: string | null
}

// Shape of a row in the local `flashcard_progress` table. THIS one is
// read-write: it tracks how the user is doing on a card, and `synced`
// tells sync.ts whether that result has reached Supabase yet.
export interface LocalFlashcardProgress {
  id: string
  user_id: string
  flashcard_id: string
  was_correct: number // SQLite has no boolean type, so 0/1 stands in for false/true
  times_seen: number
  last_seen_at: string | null
  synced: number // 0 = pending push, 1 = matches the server
}

// --- Reading cached flashcards (what the study screen will call) ---

// Returns every flashcard cached for a module, oldest first. Pure local
// read — no network call, which is exactly what makes the study screen
// usable with the device in airplane mode.
export async function getLocalFlashcards(
  moduleId: string,
): Promise<LocalFlashcard[]> {
  const db = await getDb()
  return db.getAllAsync<LocalFlashcard>(
    `SELECT * FROM flashcards WHERE module_id = ? ORDER BY created_at ASC`,
    [moduleId],
  )
}

// --- Caching flashcards pulled from the server (called by sync.ts) ---

// Caches a batch of flashcards fetched from GET /modules/:id/flashcards.
// We use INSERT OR REPLACE (rather than checking row-by-row whether it
// already exists) because the server is always the source of truth for
// this table — overwriting with the latest copy is simpler and cannot
// lose any local-only data, since nothing local is ever written here.
export async function insertOrReplaceFlashcards(
  flashcards: Array<{
    id: string
    module_id: string
    front: string
    back: string
    created_at: string
  }>,
): Promise<void> {
  if (flashcards.length === 0) return

  const db = await getDb()

  // A transaction batches all the inserts into one disk write instead of
  // one per card — for a 20-card module that's the difference between
  // 20 round trips to disk and 1, which matters on slower devices.
  await db.withTransactionAsync(async () => {
    for (const card of flashcards) {
      await db.runAsync(
        `INSERT OR REPLACE INTO flashcards
          (id, module_id, front, back, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [card.id, card.module_id, card.front, card.back, card.created_at],
      )
    }
  })
}

// --- Recording study progress (offline-first write) ---

// Records the result of reviewing one flashcard. This is the function
// the (in-progress) study screen should call after the user flips a
// card and marks it "got it" / "didn't get it" — it works completely
// offline because it only ever touches local SQLite.
//
// Mirrors the backend's upsert logic in flashcards.service.ts exactly
// (look up the existing row for this card, update it if found, insert
// a new one if not) so that once this row eventually gets pushed, the
// server ends up in the same state the device already showed the user.
export async function upsertLocalFlashcardProgress(params: {
  flashcardId: string
  wasCorrect: boolean
}): Promise<LocalFlashcardProgress> {
  const db = await getDb()
  const now = new Date().toISOString()

  const existing = await db.getFirstAsync<LocalFlashcardProgress>(
    `SELECT * FROM flashcard_progress WHERE flashcard_id = ?`,
    [params.flashcardId],
  )

  if (existing) {
    // Seen this card before on this device — update the same row in
    // place and bump times_seen. We always reset synced back to 0 here,
    // even if it was already 1 from a previous sync, because this is a
    // NEW result the server doesn't know about yet.
    const updated: LocalFlashcardProgress = {
      ...existing,
      was_correct: params.wasCorrect ? 1 : 0,
      times_seen: existing.times_seen + 1,
      last_seen_at: now,
      synced: 0,
    }

    await db.runAsync(
      `UPDATE flashcard_progress
         SET was_correct = ?, times_seen = ?, last_seen_at = ?, synced = 0
       WHERE id = ?`,
      [updated.was_correct, updated.times_seen, updated.last_seen_at, updated.id],
    )

    return updated
  }

  // First time this device has seen this card — create the row.
  // user_id is just a placeholder ('local'); it isn't actually needed
  // by the server, which always identifies the user from the bearer
  // token, not from anything in the request body.
  const id = `local-${params.flashcardId}-${Date.now()}`
  const created: LocalFlashcardProgress = {
    id,
    user_id: 'local',
    flashcard_id: params.flashcardId,
    was_correct: params.wasCorrect ? 1 : 0,
    times_seen: 1,
    last_seen_at: now,
    synced: 0,
  }

  await db.runAsync(
    `INSERT INTO flashcard_progress
      (id, user_id, flashcard_id, was_correct, times_seen, last_seen_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [
      created.id,
      created.user_id,
      created.flashcard_id,
      created.was_correct,
      created.times_seen,
      created.last_seen_at,
    ],
  )

  return created
}

// --- Sync helpers (called by sync.ts) ---

// Returns every flashcard_progress row that hasn't reached Supabase yet —
// i.e. everything answered while offline (or answered online but the
// push hasn't run yet).
export async function getUnsyncedFlashcardProgress(): Promise<
  LocalFlashcardProgress[]
> {
  const db = await getDb()
  return db.getAllAsync<LocalFlashcardProgress>(
    `SELECT * FROM flashcard_progress WHERE synced = 0 ORDER BY last_seen_at ASC`,
  )
}

// Marks a progress row as confirmed-by-the-server. We only need the
// local id here — unlike modules/conversations, nothing else in the
// local database references flashcard_progress.id as a foreign key, so
// there's no temp-id-to-real-id swap needed, just flip the flag.
export async function markFlashcardProgressSynced(id: string): Promise<void> {
  const db = await getDb()
  await db.runAsync(`UPDATE flashcard_progress SET synced = 1 WHERE id = ?`, [
    id,
  ])
}
