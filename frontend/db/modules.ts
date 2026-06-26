import { getDb } from './index'

export interface LocalModule {
  id: string
  resource_id: string | null
  title: string
  summary: string | null
  key_terms: string | null
  difficulty: string
  chat_count: number
  created_at: string
  synced: number // 0 = pending push to Supabase, 1 = synced
}

// Returns all modules (notebooks) for display, newest first.
export async function getLocalModules(): Promise<LocalModule[]> {
  const db = await getDb()
  return db.getAllAsync<LocalModule>(
    `SELECT * FROM modules ORDER BY created_at DESC`,
  )
}

// Inserts a module that was just created on-device, before it has
// reached Supabase. Marked synced = 0 so sync.ts knows to push it
// next time the device is online.
export async function insertLocalModule(mod: {
  id: string
  title: string
  created_at: string
}): Promise<LocalModule> {
  const db = await getDb()

  await db.runAsync(
    `INSERT OR REPLACE INTO modules
      (id, resource_id, title, summary, key_terms, difficulty, chat_count, created_at, synced)
     VALUES (?, NULL, ?, NULL, NULL, 'easy', 0, ?, 0)`,
    [mod.id, mod.title, mod.created_at],
  )

  return {
    id: mod.id,
    resource_id: null,
    title: mod.title,
    summary: null,
    key_terms: null,
    difficulty: 'easy',
    chat_count: 0,
    created_at: mod.created_at,
    synced: 0,
  }
}

// Once a locally-created module has been confirmed by Supabase, replace
// the temporary local row with the authoritative server row (same id
// unless Supabase assigned a different one — in that case the caller
// should delete the temp row separately).
export async function markModuleSynced(
  localId: string,
  serverModule: {
    id: string
    resource_id: string | null
    title: string
    summary: string | null
    key_terms: string | null
    difficulty: string
    chat_count: number
    created_at: string
  },
) {
  const db = await getDb()

  if (serverModule.id !== localId) {
    // Supabase assigned a different id than our temp client-side id —
    // remove the temp row and insert the real one.
    await db.runAsync(`DELETE FROM modules WHERE id = ?`, [localId])
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO modules
      (id, resource_id, title, summary, key_terms, difficulty, chat_count, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      serverModule.id,
      serverModule.resource_id,
      serverModule.title,
      serverModule.summary,
      serverModule.key_terms,
      serverModule.difficulty,
      serverModule.chat_count,
      serverModule.created_at,
    ],
  )
}

// Returns modules created on-device that haven't reached Supabase yet.
export async function getUnsyncedModules(): Promise<LocalModule[]> {
  const db = await getDb()
  return db.getAllAsync<LocalModule>(
    `SELECT * FROM modules WHERE synced = 0 ORDER BY created_at ASC`,
  )
}

export async function deleteLocalModule(id: string) {
  const db = await getDb()
  if (!id.startsWith('local-')) {
    await db.runAsync(
      `INSERT OR REPLACE INTO deleted_modules (id, deleted_at) VALUES (?, ?)`,
      [id, new Date().toISOString()],
    )
  }
  await db.runAsync(`DELETE FROM modules WHERE id = ?`, [id])
}
