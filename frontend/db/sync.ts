import NetInfo from '@react-native-community/netinfo'
import { getDb } from './index'
import { getAccessToken } from './auth-storage'
import { getUnsyncedModules, markModuleSynced } from './modules'
import {
  getUnsyncedConversations,
  markConversationSynced,
} from './conversations'
import { upsertLocalResource } from '././resources'
import { replaceConversationSources } from './conversation-sources'
import {
  getUnsyncedFlashcardProgress,
  markFlashcardProgressSynced,
  insertOrReplaceFlashcards,
} from './flashcards'
import { insertOrReplaceQuestions } from './questions'
import {
  getUnsyncedModuleProgress,
  markModuleProgressSynced,
} from './module-progress'
import { overwriteFromServer } from './user-progress'
import {
  insertOrReplaceAchievements,
  insertOrReplaceUnlockedAchievements,
  recordLocalUnlock,
} from './achievements'
import { BACKEND_URL } from '../src/lib/api'

async function pushUnsyncedChats() {
  const db = await getDb()
  const token = await getAccessToken()

  const rows = await db.getAllAsync<any>(
    `SELECT * FROM module_chats WHERE synced = 0`,
  )

  if (rows.length === 0) return

  // A message can only be pushed once its parent conversation has reached
  // Supabase (the server needs a valid conversation_id to insert against).
  // pushUnsyncedConversations() runs before this in runSync(), but in case
  // a conversation push failed, skip its messages this round rather than
  // sending a conversation_id Supabase doesn't recognize yet.
  const stillUnsyncedConvIds = new Set(
    (
      await db.getAllAsync<{ id: string }>(
        `SELECT id FROM conversations WHERE synced = 0`,
      )
    ).map((c) => c.id),
  )

  const pushable = rows.filter(
    (r) => !stillUnsyncedConvIds.has(r.conversation_id),
  )
  if (pushable.length === 0) return

  const byModule: Record<string, any[]> = {}
  for (const row of pushable) {
    byModule[row.module_id] = byModule[row.module_id] || []
    byModule[row.module_id].push(row)
  }

  for (const [moduleId, messages] of Object.entries(byModule)) {
    const res = await fetch(`${BACKEND_URL}/modules/${moduleId}/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          conversation_id: m.conversation_id,
          created_at: m.created_at,
        })),
      }),
    })

    if (res.ok) {
      const ids = messages.map((m) => `'${m.id}'`).join(',')
      await db.execAsync(
        `UPDATE module_chats SET synced = 1 WHERE id IN (${ids})`,
      )
    }
  }
}

// Pushes conversations created on-device (e.g. tapping "New Chat" while
// offline) to Supabase. Must run before pushUnsyncedChats(), since chat
// messages reference conversation_id and the server needs that id to
// already exist.
async function pushUnsyncedConversations() {
  const token = await getAccessToken()
  const unsynced = await getUnsyncedConversations()

  if (unsynced.length === 0) return

  for (const conv of unsynced) {
    try {
      const res = await fetch(
        `${BACKEND_URL}/modules/${conv.module_id}/conversations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title: conv.title }),
        },
      )

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error(
          `Failed to push conversation ${conv.id} (HTTP ${res.status}): ${errBody}`,
        )
        continue // leave synced = 0, retry next pass
      }

      const json = await res.json()
      await markConversationSynced(conv.id, json.conversation)
    } catch (err) {
      console.error('Failed to push conversation', conv.id, err)
    }
  }
}

// Pushes module deletions that occurred while offline.
async function pushUnsyncedDeletions() {
  const db = await getDb()
  const token = await getAccessToken()

  const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM deleted_modules`)
  if (rows.length === 0) return

  for (const row of rows) {
    try {
      const res = await fetch(`${BACKEND_URL}/modules/${row.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (res.ok || res.status === 404) {
        await db.runAsync(`DELETE FROM deleted_modules WHERE id = ?`, [row.id])
      } else {
        const errBody = await res.text().catch(() => '')
        console.error(
          `Failed to sync deletion for module ${row.id} (HTTP ${res.status}): ${errBody}`,
        )
      }
    } catch (err) {
      console.error('Failed to push deletion for module', row.id, err)
    }
  }
}

// Pushes notebooks (modules) that were created or renamed/updated while offline to Supabase.
// Each local row was inserted with synced = 0.
// If the ID is client-generated (starts with "local-"), we POST to /modules to create it.
// If the ID is a real server ID, we PATCH to /modules/:id to update it.
async function pushUnsyncedModules() {
  const token = await getAccessToken()
  const unsynced = await getUnsyncedModules()

  if (unsynced.length === 0) return

  for (const mod of unsynced) {
    try {
      if (mod.id.startsWith('local-')) {
        const res = await fetch(`${BACKEND_URL}/modules`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title: mod.title }),
        })

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          console.error(
            `Failed to push module ${mod.id} (HTTP ${res.status}): ${errBody}`,
          )
          continue // leave synced = 0, retry on next sync pass
        }

        const json = await res.json()
        await markModuleSynced(mod.id, json.module)
      } else {
        const res = await fetch(`${BACKEND_URL}/modules/${mod.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title: mod.title }),
        })

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          console.error(
            `Failed to sync module rename ${mod.id} (HTTP ${res.status}): ${errBody}`,
          )
          continue // leave synced = 0, retry on next sync pass
        }

        const db = await getDb()
        await db.runAsync(`UPDATE modules SET synced = 1 WHERE id = ?`, [mod.id])
      }
    } catch (err) {
      // Network dropped mid-push — leave this row queued, move on to the rest
      console.error('Failed to push module', mod.id, err)
    }
  }
}

// Pushes flashcard answers recorded while offline (or recorded online
// but not pushed yet) up to Supabase. Each successful push can return
// two extra things beyond "saved ok": a fresh userProgress snapshot —
// if that particular answer earned XP — and a list of achievements that
// just got newly unlocked. Both get applied to the local cache right
// away, so the gamification UI reflects the server's TRUE numbers
// instead of just this device's optimistic guess.
async function pushUnsyncedFlashcardProgress() {
  const token = await getAccessToken()
  const unsynced = await getUnsyncedFlashcardProgress()

  if (unsynced.length === 0) return

  for (const row of unsynced) {
    try {
      const res = await fetch(`${BACKEND_URL}/flashcards/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          flashcardId: row.flashcard_id,
          wasCorrect: row.was_correct === 1,
        }),
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error(
          `Failed to push flashcard progress ${row.id} (HTTP ${res.status}): ${errBody}`,
        )
        continue // leave synced = 0, retry next sync pass
      }

      const json = await res.json()
      await markFlashcardProgressSynced(row.id)

      // Reconcile the local optimistic XP guess with the real total.
      if (json.userProgress) {
        await overwriteFromServer(json.userProgress)
      }
      // Any achievement in here is now CONFIRMED by the server — safe
      // to add to the local "unlocked" cache straight away.
      for (const achievement of json.newlyUnlocked ?? []) {
        await recordLocalUnlock(achievement)
      }
    } catch (err) {
      console.error('Failed to push flashcard progress', row.id, err)
    }
  }
}

// Same idea as pushUnsyncedFlashcardProgress, but for whole-module
// quiz/match results (PATCH /modules/:id/progress).
async function pushUnsyncedModuleProgress() {
  const token = await getAccessToken()
  const unsynced = await getUnsyncedModuleProgress()

  if (unsynced.length === 0) return

  for (const row of unsynced) {
    try {
      const res = await fetch(
        `${BACKEND_URL}/modules/${row.module_id}/progress`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ masteryScore: row.mastery_score }),
        },
      )

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error(
          `Failed to push module progress ${row.id} (HTTP ${res.status}): ${errBody}`,
        )
        continue
      }

      const json = await res.json()
      await markModuleProgressSynced(row.id)

      if (json.userProgress) {
        await overwriteFromServer(json.userProgress)
      }
      for (const achievement of json.newlyUnlocked ?? []) {
        await recordLocalUnlock(achievement)
      }
    } catch (err) {
      console.error('Failed to push module progress', row.id, err)
    }
  }
}

async function pullModules() {
  const db = await getDb()
  const token = await getAccessToken()

  const res = await fetch(`${BACKEND_URL}/modules`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.error(`pullModules failed (HTTP ${res.status}): ${errBody}`)
    return
  }

  const json = await res.json()

  // Fetch all pending deleted module IDs to prevent re-inserting them
  const deletedRows = await db.getAllAsync<{ id: string }>(`SELECT id FROM deleted_modules`)
  const deletedIds = new Set(deletedRows.map((r) => r.id))

  for (const mod of json.modules ?? []) {
    if (deletedIds.has(mod.id)) continue

    // Don't clobber a row that's still queued to be pushed (synced = 0) —
    // it hasn't reached Supabase yet, so it can't be in this server list
    // under the same id anyway, but guard against any id collision.
    const existing = await db.getFirstAsync<{ synced: number }>(
      `SELECT synced FROM modules WHERE id = ? AND synced = 0`,
      [mod.id],
    )
    if (existing) continue

    await db.runAsync(
      `INSERT OR REPLACE INTO modules (id, resource_id, title, summary, key_terms, difficulty, chat_count, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        mod.id,
        mod.resource_id,
        mod.title,
        mod.summary,
        JSON.stringify(mod.key_terms),
        mod.difficulty,
        mod.chat_count ?? 0,
        mod.created_at,
      ],
    )
  }
}

// Caches flashcards + questions for every module currently cached
// locally, so the study/quiz/match screens can read them with ZERO
// network calls — including with no connection at all. This is the
// piece that actually makes offline flashcards/quizzes possible: it
// only needs to run once while online per module, and after that the
// content just sits in SQLite, ready any time.
// Run after pullModules() so the module list is current first.
async function pullFlashcardsAndQuestions() {
  const db = await getDb()
  const token = await getAccessToken()

  const modules = await db.getAllAsync<{ id: string }>(`SELECT id FROM modules`)

  for (const mod of modules) {
    try {
      // Fire both requests for a module at once rather than one after
      // the other — they're independent, so there's no reason to make
      // the device wait twice.
      const [flashRes, quesRes] = await Promise.all([
        fetch(`${BACKEND_URL}/modules/${mod.id}/flashcards`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${BACKEND_URL}/modules/${mod.id}/questions`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (flashRes.ok) {
        const json = await flashRes.json()
        await insertOrReplaceFlashcards(json.flashcards ?? [])
      }

      if (quesRes.ok) {
        const json = await quesRes.json()
        await insertOrReplaceQuestions(json.questions ?? [])
      }
    } catch (err) {
      console.error('pullFlashcardsAndQuestions failed for module', mod.id, err)
    }
  }
}

// Pulls fresh conversations (with previews) for every module currently
// cached locally. Run after modules are pulled, so the module list is
// up to date first.
async function pullConversations() {
  const db = await getDb()
  const token = await getAccessToken()

  const modules = await db.getAllAsync<{ id: string }>(`SELECT id FROM modules`)

  for (const mod of modules) {
    const res = await fetch(`${BACKEND_URL}/modules/${mod.id}/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) continue

    const json = await res.json()

    for (const conv of json.conversations ?? []) {
      const existing = await db.getFirstAsync<{ synced: number }>(
        `SELECT synced FROM conversations WHERE id = ? AND synced = 0`,
        [conv.id],
      )
      if (existing) continue

      await db.runAsync(
        `INSERT OR REPLACE INTO conversations
          (id, module_id, user_id, title, created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          conv.id,
          mod.id,   // always use the module we fetched from, not the server field which may be absent
          conv.user_id,
          conv.title,
          conv.created_at,
          conv.updated_at,
        ],
      )
    }
  }
}

// Counts every locally-created row across all syncable tables that hasn't
// reached Supabase yet. Used by the UI to show a "N pending" badge and to
// know when there's nothing left to push.
export async function getUnsyncedCount(): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT
      (SELECT COUNT(*) FROM modules WHERE synced = 0) +
      (SELECT COUNT(*) FROM conversations WHERE synced = 0) +
      (SELECT COUNT(*) FROM module_chats WHERE synced = 0) +
      (SELECT COUNT(*) FROM flashcard_progress WHERE synced = 0) +
      (SELECT COUNT(*) FROM module_progress WHERE synced = 0)
      AS count`,
  )
  return row?.count ?? 0
}

// Pulls resource metadata and conversation sources for all locally-cached
// modules and conversations. Run after pullModules() and pullConversations()
// so those tables are populated first.
async function pullResourcesAndSources() {
  const db = await getDb()
  const token = await getAccessToken()

  // 1. Pull resource metadata for every module that has a resource attached
  const modulesWithResource = await db.getAllAsync<{
    id: string
    resource_id: string
  }>(`SELECT id, resource_id FROM modules WHERE resource_id IS NOT NULL`)

  const fetchedResourceIds = new Set<string>()

  for (const mod of modulesWithResource) {
    if (fetchedResourceIds.has(mod.resource_id)) continue
    try {
      const res = await fetch(`${BACKEND_URL}/resources/${mod.resource_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) continue
      const json = await res.json()
      if (json.resource) {
        await upsertLocalResource(json.resource)
        fetchedResourceIds.add(mod.resource_id)
      }
    } catch (err) {
      console.error('pullResources failed for resource', mod.resource_id, err)
    }
  }

  // 2. Pull conversation sources (per-conversation resource list) for every
  //    synced conversation we have locally. Also upsert any resource records
  //    returned that we haven't cached yet.
  const conversations = await db.getAllAsync<{ id: string; module_id: string }>(
    `SELECT id, module_id FROM conversations WHERE synced = 1`,
  )

  for (const conv of conversations) {
    try {
      const res = await fetch(
        `${BACKEND_URL}/modules/${conv.module_id}/conversations/${conv.id}/sources`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) continue
      const json = await res.json()

      const sources: { id: string; resource_id: string; added_at: string }[] =
        json.sources ?? []
      await replaceConversationSources(conv.id, sources)

      // Upsert resource rows that came back embedded in the sources response
      for (const s of json.sources_with_resource ?? []) {
        if (s.resource && !fetchedResourceIds.has(s.resource_id)) {
          await upsertLocalResource(s.resource)
          fetchedResourceIds.add(s.resource_id)
        }
      }
    } catch (err) {
      console.error('pullConversationSources failed for conv', conv.id, err)
    }
  }
}

// Pulls the AUTHORITATIVE total_xp/streak from the server and overwrites
// the local optimistic copy. Deliberately run LAST in runSync() — after
// the push steps above — so it reflects everything THIS device just
// sent up, not a stale read from before the push.
async function pullUserProgress() {
  const token = await getAccessToken()

  const res = await fetch(`${BACKEND_URL}/users/me/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return

  const json = await res.json()
  if (json.progress) {
    await overwriteFromServer(json.progress)
  }
}

// Caches the global achievement definitions (name, icon, XP reward, the
// threshold needed to unlock it). Same list for every user, so a plain
// refresh-on-every-sync is simple and cheap — there's no per-user state
// to lose by overwriting.
async function pullAchievementDefinitions() {
  const token = await getAccessToken()

  const res = await fetch(`${BACKEND_URL}/achievements`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return

  const json = await res.json()
  await insertOrReplaceAchievements(json.achievements ?? [])
}

// Caches which achievements THIS user has unlocked. Run after
// pullAchievementDefinitions() so the badges being reconciled here
// already have their full definitions (name/icon/etc) cached locally.
async function pullUnlockedAchievements() {
  const token = await getAccessToken()

  const res = await fetch(`${BACKEND_URL}/achievements/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return

  const json = await res.json()
  // The server's response nests the achievement definition inside each
  // row (achievements: {...}); we only need the unlock record itself
  // here, since the definitions are cached separately above.
  const unlocked = (json.achievements ?? []).map((u: any) => ({
    id: u.id,
    achievement_id: u.achievement_id,
    unlocked_at: u.unlocked_at,
  }))
  await insertOrReplaceUnlockedAchievements(unlocked)
}

let isSyncing = false

export async function runSync() {
  if (isSyncing) {
    console.log('Sync already in progress, skipping concurrent runSync invocation.')
    return
  }
  isSyncing = true

  try {
    const token = await getAccessToken()
    if (!token) return // not logged in yet, nothing to sync

    // Order matters: each push step can only succeed once its parent has a
    // real Supabase id. Modules must sync before conversations (conversations
    // reference module_id), and conversations must sync before chats
    // (chats reference conversation_id). Flashcard/module progress don't
    // have that constraint — flashcards/questions are always pulled FROM
    // the server in the first place, so their ids are already real.
    await pushUnsyncedDeletions()
    await pushUnsyncedModules()
    await pushUnsyncedConversations()
    await pushUnsyncedChats()
    await pushUnsyncedFlashcardProgress()
    await pushUnsyncedModuleProgress()
    try {
      await pullModules()
    } catch (err) {
      console.error('pullModules failed:', err)
    }
    try {
      await pullFlashcardsAndQuestions()
    } catch (err) {
      console.error('pullFlashcardsAndQuestions failed:', err)
    }
    try {
      await pullConversations()
    } catch (err) {
      console.error('pullConversations failed:', err)
    }
    try {
      await pullResourcesAndSources()
    } catch (err) {
      console.error('pullResourcesAndSources failed:', err)
    }
    // These three run LAST, after every push above has had a chance to
    // land — so the numbers they pull back reflect this device's own
    // offline progress, not a snapshot from before it synced.
    try {
      await pullUserProgress()
    } catch (err) {
      console.error('pullUserProgress failed:', err)
    }
    try {
      await pullAchievementDefinitions()
    } catch (err) {
      console.error('pullAchievementDefinitions failed:', err)
    }
    try {
      await pullUnlockedAchievements()
    } catch (err) {
      console.error('pullUnlockedAchievements failed:', err)
    }
  } finally {
    isSyncing = false
  }
}

export function startSyncListener() {
  NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      runSync().catch((err) => console.error('Sync failed:', err))
    }
  })
}
