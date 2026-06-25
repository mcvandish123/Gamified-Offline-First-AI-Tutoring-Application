import { getDb } from './index'

// There's only ever one row in the local `user_progress` table (one
// logged-in user per device), so instead of generating a random id and
// having to look it up every time, we just always use this fixed id.
// That makes "get or create" trivial: INSERT OR REPLACE on this exact id.
const LOCAL_ID = 'local'

export interface LocalUserProgress {
  id: string
  user_id: string
  total_xp: number
  current_level: number
  current_streak: number
  longest_streak: number
  last_active_date: string | null
  updated_at: string | null
  synced: number // 0 = local XP gains the server hasn't seen yet, 1 = matches server
}

function defaultProgress(): LocalUserProgress {
  return {
    id: LOCAL_ID,
    user_id: 'local',
    total_xp: 0,
    current_level: 1,
    current_streak: 0,
    longest_streak: 0,
    last_active_date: null,
    updated_at: new Date().toISOString(),
    synced: 1, // a fresh zero-state matches what a brand-new server row looks like too
  }
}

// Returns the local XP/streak snapshot, creating a default zeroed-out
// row the very first time it's called (e.g. right after a fresh
// install, before the first sync has had a chance to pull the real
// numbers down).
export async function getLocalUserProgress(): Promise<LocalUserProgress> {
  const db = await getDb()
  const existing = await db.getFirstAsync<LocalUserProgress>(
    `SELECT * FROM user_progress WHERE id = ?`,
    [LOCAL_ID],
  )

  if (existing) return existing

  const fresh = defaultProgress()
  await writeRow(fresh)
  return fresh
}

async function writeRow(row: LocalUserProgress): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `INSERT OR REPLACE INTO user_progress
      (id, user_id, total_xp, current_level, current_streak, longest_streak, last_active_date, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.user_id,
      row.total_xp,
      row.current_level,
      row.current_streak,
      row.longest_streak,
      row.last_active_date,
      row.updated_at,
      row.synced,
    ],
  )
}

// Exact same streak rule as the backend's xp-log.service.ts, copied on
// purpose rather than shared, since the frontend and backend are
// separate apps/deploys here — keeping both in sync is a "remember to
// update both if this ever changes" tradeoff, which is fine for a
// hackathon timeline but worth a comment so it isn't a silent trap.
function calculateStreak(
  lastActiveDate: string | null,
  today: string,
  currentStreak: number,
): number {
  if (lastActiveDate === today) {
    return currentStreak
  }

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  if (lastActiveDate === yesterdayStr) {
    return currentStreak + 1
  }

  return 1
}

// Applies an XP gain LOCALLY, immediately — this is what makes the XP
// bar and streak counter move the instant a flashcard/quiz is answered
// correctly while offline, with no network call at all.
//
// Deliberately NOT touched here: daily_xp_log (the table that powers
// the progress chart) and current_level (nothing in this codebase
// calculates a level from XP yet — that's a product decision for the
// team to make, not something to invent silently here). Both are minor,
// non-blocking gaps for the offline demo; total_xp/streak are the two
// numbers players actually watch move in real time.
export async function applyLocalXpGain(
  xpEarned: number,
  source: 'flashcard' | 'quiz',
): Promise<LocalUserProgress> {
  const current = await getLocalUserProgress()
  const today = new Date().toISOString().split('T')[0]

  const newStreak = calculateStreak(
    current.last_active_date,
    today,
    current.current_streak,
  )

  const updated: LocalUserProgress = {
    ...current,
    total_xp: current.total_xp + xpEarned,
    current_streak: newStreak,
    longest_streak: Math.max(newStreak, current.longest_streak),
    last_active_date: today,
    updated_at: new Date().toISOString(),
    synced: 0, // the server doesn't know about this gain yet
  }

  await writeRow(updated)
  return updated
}

// Replaces the local row with the AUTHORITATIVE numbers from the
// server — either from a direct GET /users/me/progress pull, or from
// the `userProgress` field returned when a queued flashcard/quiz answer
// gets pushed. This is the reconciliation step: any local optimistic
// guess gets overwritten with the real total, so two devices (or one
// device that studied offline for a while) can never drift permanently.
export async function overwriteFromServer(serverProgress: {
  user_id: string
  total_xp: number
  current_level: number
  current_streak: number
  longest_streak: number
  last_active_date: string
  updated_at: string
}): Promise<LocalUserProgress> {
  const row: LocalUserProgress = {
    id: LOCAL_ID,
    user_id: serverProgress.user_id,
    total_xp: serverProgress.total_xp,
    current_level: serverProgress.current_level,
    current_streak: serverProgress.current_streak,
    longest_streak: serverProgress.longest_streak,
    last_active_date: serverProgress.last_active_date,
    updated_at: serverProgress.updated_at,
    synced: 1,
  }

  await writeRow(row)
  return row
}
