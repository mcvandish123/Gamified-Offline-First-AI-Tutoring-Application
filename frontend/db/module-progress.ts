import { getDb } from './index'

// Mirrors Supabase's `module_progress` table.
export interface LocalModuleProgress {
  id: string
  user_id: string
  module_id: string
  mastery_score: number // 0.0 (not started) to 1.0 (fully mastered)
  times_reviewed: number
  is_completed: number // 0/1 — SQLite has no boolean type
  updated_at: string | null
  synced: number // 0 = pending push, 1 = matches the server
}

// A small, honest helper: turns "8 correct out of 10" into the 0.0–1.0
// ratio the rest of the app expects. The backend doesn't average this
// with previous attempts — each update simply OVERWRITES mastery_score
// with whatever ratio is sent. That's existing behavior (see
// progress.service.ts), not something introduced here, so the quiz
// screen should know: the LATEST attempt is always what counts, not a
// running average across every attempt ever made.
export function computeMasteryScore(
  correctCount: number,
  totalCount: number,
): number {
  if (totalCount <= 0) return 0
  return correctCount / totalCount
}

// Returns this device's progress on a module, or a sensible "never
// studied" default if no row exists yet — matching the shape the
// backend's GET /modules/:id/progress returns when there's no row.
export async function getLocalModuleProgress(
  moduleId: string,
): Promise<LocalModuleProgress> {
  const db = await getDb()
  const existing = await db.getFirstAsync<LocalModuleProgress>(
    `SELECT * FROM module_progress WHERE module_id = ?`,
    [moduleId],
  )

  if (existing) return existing

  return {
    id: '',
    user_id: 'local',
    module_id: moduleId,
    mastery_score: 0.0,
    times_reviewed: 0,
    is_completed: 0,
    updated_at: null,
    synced: 1, // nothing local-only to push for a row that doesn't exist
  }
}

// Records a quiz/match attempt's result for a module. Call this with
// the mastery score for THIS attempt (see computeMasteryScore above) —
// works fully offline since it only touches local SQLite.
//
// Mirrors progress.service.ts's updateProgress(): look up the existing
// row, decide is_completed from the score, bump times_reviewed, and
// only treat it as a fresh completion if it JUST crossed 1.0 (so
// re-studying an already-mastered module doesn't re-trigger anything
// downstream that's keyed off "first time completed").
export async function upsertLocalModuleProgress(params: {
  moduleId: string
  masteryScore: number
}): Promise<{ progress: LocalModuleProgress; justCompleted: boolean }> {
  const db = await getDb()
  const now = new Date().toISOString()

  const existing = await db.getFirstAsync<LocalModuleProgress>(
    `SELECT * FROM module_progress WHERE module_id = ?`,
    [params.moduleId],
  )

  const isCompleted = params.masteryScore >= 1.0
  const wasAlreadyCompleted = existing ? existing.is_completed === 1 : false
  const justCompleted = isCompleted && !wasAlreadyCompleted

  if (existing) {
    const updated: LocalModuleProgress = {
      ...existing,
      mastery_score: params.masteryScore,
      times_reviewed: existing.times_reviewed + 1,
      is_completed: isCompleted ? 1 : 0,
      updated_at: now,
      synced: 0,
    }

    await db.runAsync(
      `UPDATE module_progress
         SET mastery_score = ?, times_reviewed = ?, is_completed = ?, updated_at = ?, synced = 0
       WHERE id = ?`,
      [
        updated.mastery_score,
        updated.times_reviewed,
        updated.is_completed,
        updated.updated_at,
        updated.id,
      ],
    )

    return { progress: updated, justCompleted }
  }

  const id = `local-${params.moduleId}-${Date.now()}`
  const created: LocalModuleProgress = {
    id,
    user_id: 'local',
    module_id: params.moduleId,
    mastery_score: params.masteryScore,
    times_reviewed: 1,
    is_completed: isCompleted ? 1 : 0,
    updated_at: now,
    synced: 0,
  }

  await db.runAsync(
    `INSERT INTO module_progress
      (id, user_id, module_id, mastery_score, times_reviewed, is_completed, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      created.id,
      created.user_id,
      created.module_id,
      created.mastery_score,
      created.times_reviewed,
      created.is_completed,
      created.updated_at,
    ],
  )

  return { progress: created, justCompleted }
}

// --- Sync helpers (called by sync.ts) ---

export async function getUnsyncedModuleProgress(): Promise<
  LocalModuleProgress[]
> {
  const db = await getDb()
  return db.getAllAsync<LocalModuleProgress>(
    `SELECT * FROM module_progress WHERE synced = 0 ORDER BY updated_at ASC`,
  )
}

// Same reasoning as markFlashcardProgressSynced: nothing references
// module_progress.id elsewhere, so flipping the flag is all that's
// needed — no id-reconciliation step required.
export async function markModuleProgressSynced(id: string): Promise<void> {
  const db = await getDb()
  await db.runAsync(`UPDATE module_progress SET synced = 1 WHERE id = ?`, [
    id,
  ])
}
