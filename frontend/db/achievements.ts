import { getDb } from './index'

export interface LocalAchievement {
  id: string
  name: string
  description: string | null
  icon_url: string | null
  xp_reward: number
  condition_type: string | null
  condition_value: number
  created_at: string | null
}

export interface LocalUnlockedAchievement {
  id: string
  achievement_id: string
  unlocked_at: string
}

// --- Achievement definitions (global, same list for every user) ---

export async function getLocalAchievements(): Promise<LocalAchievement[]> {
  const db = await getDb()
  return db.getAllAsync<LocalAchievement>(
    `SELECT * FROM achievements ORDER BY condition_value ASC`,
  )
}

// Caches the result of GET /achievements. This list is small and barely
// ever changes, so simply wiping and re-inserting on every sync (rather
// than diffing row by row) keeps this function simple with no real cost.
export async function insertOrReplaceAchievements(
  achievements: LocalAchievement[],
): Promise<void> {
  const db = await getDb()

  await db.withTransactionAsync(async () => {
    for (const a of achievements) {
      await db.runAsync(
        `INSERT OR REPLACE INTO achievements
          (id, name, description, icon_url, xp_reward, condition_type, condition_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.name,
          a.description,
          a.icon_url,
          a.xp_reward,
          a.condition_type,
          a.condition_value,
          a.created_at,
        ],
      )
    }
  })
}

// --- What THIS user has unlocked ---

// Returns the ids of every achievement this user already has, as a Set
// for cheap "do they already have this one?" lookups in the UI.
export async function getLocalUnlockedAchievementIds(): Promise<Set<string>> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ achievement_id: string }>(
    `SELECT achievement_id FROM user_achievements`,
  )
  return new Set(rows.map((r) => r.achievement_id))
}

// Caches the result of GET /achievements/me. Like achievements above,
// this is a full-replace rather than a diff — simple and cheap given
// how few rows this table will ever realistically hold.
export async function insertOrReplaceUnlockedAchievements(
  unlocked: LocalUnlockedAchievement[],
): Promise<void> {
  const db = await getDb()

  await db.withTransactionAsync(async () => {
    for (const u of unlocked) {
      await db.runAsync(
        `INSERT OR REPLACE INTO user_achievements (id, achievement_id, unlocked_at)
         VALUES (?, ?, ?)`,
        [u.id, u.achievement_id, u.unlocked_at],
      )
    }
  })
}

// Records ONE newly-unlocked achievement. Call this with each entry of
// the `newlyUnlocked` array that POST /flashcards/progress or
// PATCH /modules/:id/progress returns once that push succeeds — by the
// time this runs, the server has ALREADY confirmed the unlock, so it's
// safe to write straight in (no synced flag needed, see db/index.ts for
// why this table never originates unlocks on-device).
export async function recordLocalUnlock(achievement: {
  id: string // the achievement's own id, not a user_achievements row id
}): Promise<void> {
  const db = await getDb()
  const rowId = `unlock-${achievement.id}-${Date.now()}`

  await db.runAsync(
    `INSERT OR REPLACE INTO user_achievements (id, achievement_id, unlocked_at)
     VALUES (?, ?, ?)`,
    [rowId, achievement.id, new Date().toISOString()],
  )
}
