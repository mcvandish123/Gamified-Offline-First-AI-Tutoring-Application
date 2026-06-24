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

// Pushes notebooks (modules) that were created while offline to Supabase.
// Each local row was inserted with synced = 0 and a client-generated id;
// once Supabase confirms the insert, the local row is replaced with the
// authoritative server row (which has the real Supabase id) and synced = 1.
async function pushUnsyncedModules() {
  const token = await getAccessToken()
  const unsynced = await getUnsyncedModules()

  if (unsynced.length === 0) return

  for (const mod of unsynced) {
    try {
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
    } catch (err) {
      // Network dropped mid-push — leave this row queued, move on to the rest
      console.error('Failed to push module', mod.id, err)
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

  for (const mod of json.modules ?? []) {
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
          conv.module_id,
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
      (SELECT COUNT(*) FROM module_chats WHERE synced = 0)
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

export async function runSync() {
  const token = await getAccessToken()
  if (!token) return // not logged in yet, nothing to sync

  // Order matters: each push step can only succeed once its parent has a
  // real Supabase id. Modules must sync before conversations (conversations
  // reference module_id), and conversations must sync before chats
  // (chats reference conversation_id).
  await pushUnsyncedModules()
  await pushUnsyncedConversations()
  await pushUnsyncedChats()
  try {
    await pullModules()
  } catch (err) {
    console.error('pullModules failed:', err)
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
}

export function startSyncListener() {
  NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      runSync().catch((err) => console.error('Sync failed:', err))
    }
  })
}
