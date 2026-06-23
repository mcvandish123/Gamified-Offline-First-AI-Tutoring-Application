import { getDb } from './index'

export interface LocalChat {
  id: string
  module_id: string
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  synced: number // 0 = pending, 1 = synced
}

export async function getLocalChats(
  conversationId: string,
): Promise<LocalChat[]> {
  const db = await getDb()
  return db.getAllAsync<LocalChat>(
    `SELECT * FROM module_chats WHERE conversation_id = ? ORDER BY created_at ASC`,
    [conversationId],
  )
}

export async function insertLocalChat(chat: {
  id: string
  module_id: string
  conversation_id: string
  user_id: string
  role: string
  content: string
  created_at: string
  synced?: number
}): Promise<LocalChat> {
  const db = await getDb()
  const syncedVal = chat.synced ?? 0

  await db.runAsync(
    `INSERT OR REPLACE INTO module_chats
      (id, module_id, conversation_id, user_id, role, content, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chat.id,
      chat.module_id,
      chat.conversation_id,
      chat.user_id,
      chat.role,
      chat.content,
      chat.created_at,
      syncedVal,
    ],
  )

  return {
    id: chat.id,
    module_id: chat.module_id,
    conversation_id: chat.conversation_id,
    user_id: chat.user_id,
    role: chat.role as 'user' | 'assistant',
    content: chat.content,
    created_at: chat.created_at,
    synced: syncedVal,
  }
}

export async function insertOrReplaceChats(chats: any[]) {
  const db = await getDb()
  for (const c of chats) {
    await db.runAsync(
      `INSERT OR REPLACE INTO module_chats
        (id, module_id, conversation_id, user_id, role, content, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        c.id,
        c.module_id,
        c.conversation_id,
        c.user_id,
        c.role,
        c.content,
        c.created_at,
      ],
    )
  }
}

export async function markChatSynced(id: string) {
  const db = await getDb()
  await db.runAsync(
    `UPDATE module_chats SET synced = 1 WHERE id = ?`,
    [id],
  )
}
