import { Platform } from 'react-native'
import Constants from 'expo-constants'
import NetInfo from '@react-native-community/netinfo'
import { getDb } from './index'
import { getAccessToken } from './auth-storage'
import { getUnsyncedModules, markModuleSynced } from './modules'
import {
  getUnsyncedConversations,
  markConversationSynced,
} from './conversations'

const getBackendUrl = () => {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000'
  }
  const hostUri = Constants.expoConfig?.hostUri
  if (hostUri) {
    const hostIp = hostUri.split(':')[0]
    return `http://${hostIp}:3000`
  }
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:3000'
    : 'http://localhost:3000'
}

const BACKEND_URL = getBackendUrl()

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

      if (!res.ok) continue // leave synced = 0, retry next pass

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

      if (!res.ok) continue // leave synced = 0, retry on next sync pass

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
  const json = await res.json()

  for (const mod of json.modules) {
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

export async function runSync() {
  const token = await getAccessToken()
  if (!token) return // not logged in yet, nothing to sync

  await pushUnsyncedConversations()
  await pushUnsyncedChats()
  await pushUnsyncedModules()
  await pullModules()
  await pullConversations()
}

export function startSyncListener() {
  NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      runSync().catch((err) => console.error('Sync failed:', err))
    }
  })
}
