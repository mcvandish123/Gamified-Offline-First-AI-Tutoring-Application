import { getDb } from './index'

export interface LocalResource {
  id: string
  user_id: string
  title: string
  file_url: string | null
  file_type: string
  is_processed: number // 0 = false, 1 = true
  created_at: string | null
}

// Upserts a resource row pulled from the backend into the local cache.
export async function upsertLocalResource(resource: LocalResource) {
  const db = await getDb()
  await db.runAsync(
    `INSERT OR REPLACE INTO resources
      (id, user_id, title, file_url, file_type, is_processed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      resource.id,
      resource.user_id,
      resource.title,
      resource.file_url ?? null,
      resource.file_type ?? 'pdf',
      resource.is_processed ?? 0,
      resource.created_at ?? null,
    ],
  )
}

// Returns the resource attached to a module, or null if none.
// The module row carries resource_id; we look up the full resource here.
export async function getResourceForModule(
  resourceId: string,
): Promise<LocalResource | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<LocalResource>(
    `SELECT * FROM resources WHERE id = ?`,
    [resourceId],
  )
  return row ?? null
}
