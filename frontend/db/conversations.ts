import { getDb } from './index'

export interface LocalConversation {
  id: string
  module_id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
  synced: number // 0 = pending push to Supabase, 1 = synced
}

// Conversation enriched with a preview, computed on the client from the
// local module_chats cache (mirrors what the backend's getConversations
// computes server-side, so the UI looks the same whether data came from
// SQLite or just got pulled fresh).
export interface ConversationWithPreview extends LocalConversation {
  message_count: number
  last_message: string | null
  last_message_at: string
}

export async function getLocalConversations(
  moduleId: string,
): Promise<ConversationWithPreview[]> {
  const db = await getDb()

  const conversations = await db.getAllAsync<LocalConversation>(
    `SELECT * FROM conversations WHERE module_id = ? ORDER BY updated_at DESC`,
    [moduleId],
  )

  const result: ConversationWithPreview[] = []

  for (const conv of conversations) {
    const last = await db.getFirstAsync<{
      content: string
      created_at: string
    }>(
      `SELECT content, created_at FROM module_chats
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [conv.id],
    )
    const countRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM module_chats WHERE conversation_id = ?`,
      [conv.id],
    )

    result.push({
      ...conv,
      message_count: countRow?.count ?? 0,
      last_message: last?.content ?? null,
      last_message_at: last?.created_at ?? conv.created_at,
    })
  }

  return result
}

// Inserts a conversation created on-device, before it has reached Supabase.
export async function insertLocalConversation(conv: {
  id: string
  module_id: string
  user_id: string
  title: string
  created_at: string
}): Promise<LocalConversation> {
  const db = await getDb()

  await db.runAsync(
    `INSERT OR REPLACE INTO conversations
      (id, module_id, user_id, title, created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [
      conv.id,
      conv.module_id,
      conv.user_id,
      conv.title,
      conv.created_at,
      conv.created_at,
    ],
  )

  return {
    id: conv.id,
    module_id: conv.module_id,
    user_id: conv.user_id,
    title: conv.title,
    created_at: conv.created_at,
    updated_at: conv.created_at,
    synced: 0,
  }
}

// Replaces a temp local conversation row with the authoritative Supabase
// row once the create POST succeeds.
export async function markConversationSynced(
  localId: string,
  serverConv: {
    id: string
    module_id: string
    user_id: string
    title: string
    created_at: string
    updated_at: string
  },
) {
  const db = await getDb()

  if (serverConv.id !== localId) {
    await db.runAsync(`DELETE FROM conversations WHERE id = ?`, [localId])
    // Re-point any messages that were written locally under the temp id
    // before the server confirmed (shouldn't normally happen since we
    // create the conversation before sending messages, but guards against
    // races).
    await db.runAsync(
      `UPDATE module_chats SET conversation_id = ? WHERE conversation_id = ?`,
      [serverConv.id, localId],
    )
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO conversations
      (id, module_id, user_id, title, created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [
      serverConv.id,
      serverConv.module_id,
      serverConv.user_id,
      serverConv.title,
      serverConv.created_at,
      serverConv.updated_at,
    ],
  )
}

export async function getUnsyncedConversations(): Promise<LocalConversation[]> {
  const db = await getDb()
  return db.getAllAsync<LocalConversation>(
    `SELECT * FROM conversations WHERE synced = 0 ORDER BY created_at ASC`,
  )
}
