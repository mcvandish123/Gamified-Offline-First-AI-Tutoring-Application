import { getDb } from './index'

export interface LocalConversationSource {
  id: string
  conversation_id: string
  resource_id: string
  added_at: string
  // Joined from resources table for display
  resource_title?: string
  resource_file_type?: string
}

// Fetches all sources for a conversation, joined with resource title.
export async function getSourcesForConversation(
  conversationId: string,
): Promise<LocalConversationSource[]> {
  const db = await getDb()
  return db.getAllAsync<LocalConversationSource>(
    `SELECT cs.*, r.title AS resource_title, r.file_type AS resource_file_type
     FROM conversation_sources cs
     LEFT JOIN resources r ON r.id = cs.resource_id
     WHERE cs.conversation_id = ?
     ORDER BY cs.added_at ASC`,
    [conversationId],
  )
}

// Inserts a conversation_source row (called after a successful server POST,
// or optimistically when the user taps "Add Source").
export async function insertConversationSource(source: {
  id: string
  conversation_id: string
  resource_id: string
  added_at: string
}) {
  const db = await getDb()
  await db.runAsync(
    `INSERT OR REPLACE INTO conversation_sources
      (id, conversation_id, resource_id, added_at)
     VALUES (?, ?, ?, ?)`,
    [source.id, source.conversation_id, source.resource_id, source.added_at],
  )
}

// Removes a source from a conversation locally.
export async function removeConversationSource(
  conversationId: string,
  resourceId: string,
) {
  const db = await getDb()
  await db.runAsync(
    `DELETE FROM conversation_sources
     WHERE conversation_id = ? AND resource_id = ?`,
    [conversationId, resourceId],
  )
}

// Replaces all cached sources for a conversation with a fresh server list.
export async function replaceConversationSources(
  conversationId: string,
  sources: { id: string; resource_id: string; added_at: string }[],
) {
  const db = await getDb()
  await db.runAsync(
    `DELETE FROM conversation_sources WHERE conversation_id = ?`,
    [conversationId],
  )
  for (const s of sources) {
    await db.runAsync(
      `INSERT OR REPLACE INTO conversation_sources
        (id, conversation_id, resource_id, added_at)
       VALUES (?, ?, ?, ?)`,
      [s.id, conversationId, s.resource_id, s.added_at],
    )
  }
}
