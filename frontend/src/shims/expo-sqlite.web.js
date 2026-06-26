/**
 * Web shim for expo-sqlite.
 *
 * Native (iOS/Android) uses the real expo-sqlite. On web/Electron there is no
 * native SQLite, so this shim backs the same API with an in-memory store
 * (table-name → rows[]) that is ALSO persisted to localStorage.
 *
 * Why this file matters: the previous version of this shim only understood
 * `WHERE synced = 0` and `WHERE id = ?`. Every per-notebook query
 * (`WHERE module_id = ?`, `WHERE conversation_id = ?`) silently returned ALL
 * rows — so every notebook showed the same chats/quizzes/flashcards. It also
 * kept nothing across refreshes. This version honours the WHERE/ORDER/IN/JOIN
 * shapes the app actually uses and persists, so data is correctly scoped per
 * notebook and survives a refresh / works offline.
 *
 * This is a tiny interpreter, NOT a general SQL engine. It only needs to cover
 * the finite set of statements in db/*.ts. If you add a new query shape there,
 * make sure it's handled here too.
 */

const STORAGE_KEY = 'tutor.web.sqlite.v1'

// table name → array of row objects
const tables = new Map()

// ── Persistence ────────────────────────────────────────────────────────────
function loadFromStorage() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const obj = JSON.parse(raw)
    for (const [name, rows] of Object.entries(obj)) {
      tables.set(name, Array.isArray(rows) ? rows : [])
    }
  } catch (err) {
    console.warn('[web-sqlite] failed to load persisted DB:', err)
  }
}

let saveScheduled = false
function scheduleSave() {
  if (saveScheduled) return
  saveScheduled = true
  // Batch many writes within a tick into a single serialize+store.
  Promise.resolve().then(() => {
    saveScheduled = false
    try {
      const obj = {}
      for (const [name, rows] of tables.entries()) obj[name] = rows
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
      }
    } catch (err) {
      console.warn('[web-sqlite] failed to persist DB:', err)
    }
  })
}

loadFromStorage()

function getTable(name) {
  if (!tables.has(name)) tables.set(name, [])
  return tables.get(name)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Compare two scalar values: numeric when both look numeric, else string.
function cmp(a, b) {
  const an = a === null || a === undefined ? '' : a
  const bn = b === null || b === undefined ? '' : b
  const af = Number(an)
  const bf = Number(bn)
  if (an !== '' && bn !== '' && !Number.isNaN(af) && !Number.isNaN(bf)) {
    return af - bf
  }
  return String(an).localeCompare(String(bn))
}

// Loosely-equal compare so "1" == 1 (params can be strings or numbers).
function looseEq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined
  // eslint-disable-next-line eqeqeq
  return a == b
}

// Strip a table alias prefix ("cs.conversation_id" → "conversation_id").
function bareCol(col) {
  const i = col.indexOf('.')
  return i >= 0 ? col.slice(i + 1) : col
}

// Parse a parenthesised value list: "?, ?, ?" or "'a','b'" or "1,2".
// `next()` supplies the next bound parameter for each `?`.
function parseInList(listStr, next) {
  return listStr.split(',').map((tok) => {
    const t = tok.trim()
    if (t === '?') return next()
    if (/^'.*'$/.test(t)) return t.slice(1, -1)
    return t
  })
}

// Evaluate a `SELECT <col> FROM <table> [WHERE ...]` subquery into a Set of
// the selected column's values. Subqueries here are simple (no params except
// an optional trailing `WHERE col = ?`, whose param is taken via next()).
function evalSubquerySet(subSql, next) {
  const m = subSql.match(/^SELECT\s+(\S+)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i)
  if (!m) return new Set()
  const col = bareCol(m[1])
  const rows = [...getTable(m[2])]
  const where = m[3]
  let filtered = rows
  if (where) {
    const pred = buildWherePredicate(where, next)
    filtered = rows.filter(pred)
  }
  return new Set(filtered.map((r) => r[col]))
}

// Build a predicate(row) from a WHERE body. Consumes bound params (for each
// `?`, in left-to-right order) via next(). Supports conditions joined by AND:
//   col = ?            col = 'lit'        col = 123
//   col IS NULL        col IS NOT NULL
//   col IN (list)      col IN (SELECT…)   col NOT IN (SELECT…)
function buildWherePredicate(whereBody, next) {
  // Split on AND that is not inside parentheses.
  const parts = splitTopLevelAnd(whereBody)
  const checks = []

  for (const partRaw of parts) {
    const part = partRaw.trim()
    let m

    if ((m = part.match(/^(\S+)\s+IS\s+NOT\s+NULL$/i))) {
      const col = bareCol(m[1])
      checks.push((r) => r[col] !== null && r[col] !== undefined)
      continue
    }
    if ((m = part.match(/^(\S+)\s+IS\s+NULL$/i))) {
      const col = bareCol(m[1])
      checks.push((r) => r[col] === null || r[col] === undefined)
      continue
    }
    if ((m = part.match(/^(\S+)\s+NOT\s+IN\s*\(\s*(SELECT\s+.+)\)$/i))) {
      const col = bareCol(m[1])
      const set = evalSubquerySet(m[2].trim(), next)
      checks.push((r) => !set.has(r[col]))
      continue
    }
    if ((m = part.match(/^(\S+)\s+IN\s*\(\s*(SELECT\s+.+)\)$/i))) {
      const col = bareCol(m[1])
      const set = evalSubquerySet(m[2].trim(), next)
      checks.push((r) => set.has(r[col]))
      continue
    }
    if ((m = part.match(/^(\S+)\s+IN\s*\(([^)]*)\)$/i))) {
      const col = bareCol(m[1])
      const vals = parseInList(m[2], next)
      checks.push((r) => vals.some((v) => looseEq(r[col], v)))
      continue
    }
    if ((m = part.match(/^(\S+)\s*=\s*\?$/))) {
      const col = bareCol(m[1])
      const val = next()
      checks.push((r) => looseEq(r[col], val))
      continue
    }
    if ((m = part.match(/^(\S+)\s*=\s*'(.*)'$/))) {
      const col = bareCol(m[1])
      const val = m[2]
      checks.push((r) => looseEq(r[col], val))
      continue
    }
    if ((m = part.match(/^(\S+)\s*=\s*(-?\d+(?:\.\d+)?)$/))) {
      const col = bareCol(m[1])
      const val = Number(m[2])
      checks.push((r) => looseEq(r[col], val))
      continue
    }
    // Unrecognised condition — log once and treat as always-true so we don't
    // accidentally hide data.
    console.warn('[web-sqlite] unhandled WHERE condition:', part)
  }

  return (r) => checks.every((c) => c(r))
}

function splitTopLevelAnd(s) {
  const out = []
  let depth = 0
  let cur = ''
  const tokens = s.split(/(\s+AND\s+)/i)
  for (const tok of tokens) {
    if (/^\s+AND\s+$/i.test(tok) && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    for (const ch of tok) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    cur += tok
  }
  if (cur.trim()) out.push(cur)
  return out
}

function applyOrderBy(rows, s) {
  const m = s.match(/ORDER BY\s+([\w.]+)\s*(ASC|DESC)?/i)
  if (!m) return rows
  const col = bareCol(m[1])
  const dir = (m[2] || 'ASC').toUpperCase() === 'DESC' ? -1 : 1
  return rows.sort((a, b) => cmp(a[col], b[col]) * dir)
}

// ── Statement interpreter ─────────────────────────────────────────────────────
function runSql(sql, params = []) {
  const s = sql.trim().replace(/\s+/g, ' ')
  let pi = 0
  const next = () => params[pi++]

  // PRAGMA / CREATE / ALTER → structural no-ops
  if (/^PRAGMA/i.test(s)) return { rows: [], lastInsertRowId: 0, changes: 0 }
  if (/^ALTER TABLE/i.test(s)) return { rows: [], lastInsertRowId: 0, changes: 0 }
  const createMatch = s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/i)
  if (createMatch) {
    getTable(createMatch[1])
    return { rows: [], lastInsertRowId: 0, changes: 0 }
  }

  // INSERT [OR REPLACE] INTO <table> (cols) VALUES (...)
  const insertMatch = s.match(/^INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES/i)
  if (insertMatch) {
    const tableName = insertMatch[1]
    const cols = insertMatch[2].split(',').map((c) => c.trim())
    // Map the VALUES list positionally. Each placeholder is `?`; literals like
    // `0` appear inline (e.g. "VALUES (?, ?, 0)"). Parse the VALUES tuple.
    const valuesMatch = s.match(/VALUES\s*\(([^)]*)\)/i)
    const valueToks = valuesMatch ? valuesMatch[1].split(',').map((t) => t.trim()) : []
    const row = {}
    cols.forEach((col, i) => {
      const tok = valueToks[i]
      if (tok === '?') row[col] = next()
      else if (tok === undefined) row[col] = null
      else if (/^'.*'$/.test(tok)) row[col] = tok.slice(1, -1)
      else if (tok.toUpperCase() === 'NULL') row[col] = null
      else if (/^-?\d+(\.\d+)?$/.test(tok)) row[col] = Number(tok)
      else row[col] = next() // fall back to a param
    })
    const tbl = getTable(tableName)
    if (row.id !== undefined && row.id !== null) {
      const idx = tbl.findIndex((r) => r.id === row.id)
      if (idx >= 0) tbl[idx] = row
      else tbl.push(row)
    } else {
      tbl.push(row)
    }
    scheduleSave()
    return { rows: [], lastInsertRowId: tbl.length, changes: 1 }
  }

  // INSERT ... SELECT (migration only) — not needed on web, no-op.
  if (/^INSERT\s+INTO\s+\w+.*SELECT/i.test(s)) {
    return { rows: [], lastInsertRowId: 0, changes: 0 }
  }

  // UPDATE <table> SET <assignments> [WHERE ...]
  const updateMatch = s.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
  if (updateMatch) {
    const tableName = updateMatch[1]
    const setStr = updateMatch[2]
    const whereStr = updateMatch[3]
    // Parse assignments first (their `?` come before WHERE's in param order).
    const assigns = setStr.split(',').map((a) => a.trim())
    const setters = assigns.map((a) => {
      const m = a.match(/^(\S+)\s*=\s*(.+)$/)
      const col = bareCol(m[1])
      const valTok = m[2].trim()
      if (valTok === '?') {
        const v = next()
        return (r) => { r[col] = v }
      }
      if (/^'.*'$/.test(valTok)) return (r) => { r[col] = valTok.slice(1, -1) }
      if (/^-?\d+(\.\d+)?$/.test(valTok)) return (r) => { r[col] = Number(valTok) }
      if (valTok.toUpperCase() === 'NULL') return (r) => { r[col] = null }
      const v = next()
      return (r) => { r[col] = v }
    })
    const tbl = getTable(tableName)
    const pred = whereStr ? buildWherePredicate(whereStr, next) : () => true
    let changes = 0
    for (const r of tbl) {
      if (pred(r)) {
        setters.forEach((fn) => fn(r))
        changes++
      }
    }
    scheduleSave()
    return { rows: [], lastInsertRowId: 0, changes }
  }

  // DELETE FROM <table> [WHERE ...]
  const deleteMatch = s.match(/^DELETE FROM (\w+)(?:\s+WHERE\s+(.+))?$/i)
  if (deleteMatch) {
    const tableName = deleteMatch[1]
    const whereStr = deleteMatch[2]
    const tbl = getTable(tableName)
    if (!whereStr) {
      const before = tbl.length
      tables.set(tableName, [])
      scheduleSave()
      return { rows: [], lastInsertRowId: 0, changes: before }
    }
    const pred = buildWherePredicate(whereStr, next)
    const kept = tbl.filter((r) => !pred(r))
    const changes = tbl.length - kept.length
    tables.set(tableName, kept)
    scheduleSave()
    return { rows: [], lastInsertRowId: 0, changes }
  }

  // SELECT — several shapes.
  if (/^SELECT/i.test(s)) {
    // (a) getUnsyncedCount: sum of several (SELECT COUNT(*) ... ) AS count
    if (/\bAS count\b/i.test(s) && /SELECT COUNT\(\*\) FROM/i.test(s)) {
      const subRe = /SELECT COUNT\(\*\) FROM (\w+) WHERE synced = (\d+)/gi
      let total = 0
      let m
      while ((m = subRe.exec(s)) !== null) {
        const rows = getTable(m[1])
        total += rows.filter((r) => looseEq(r.synced, Number(m[2]))).length
      }
      return { rows: [{ count: total }], lastInsertRowId: 0, changes: 0 }
    }

    // (b) conversation_sources LEFT JOIN resources
    if (/FROM conversation_sources cs/i.test(s)) {
      const convId = next()
      const sources = getTable('conversation_sources').filter((r) =>
        looseEq(r.conversation_id, convId),
      )
      const resources = getTable('resources')
      let joined = sources.map((cs) => {
        const r = resources.find((x) => x.id === cs.resource_id)
        return {
          ...cs,
          resource_title: r ? r.title : null,
          resource_file_type: r ? r.file_type : null,
        }
      })
      joined = applyOrderBy(joined, s)
      return { rows: joined, lastInsertRowId: 0, changes: 0 }
    }

    // (c) single-table COUNT(*) [as <alias>]
    const countMatch = s.match(/^SELECT COUNT\(\*\)(?:\s+as\s+(\w+))?\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i)
    if (countMatch) {
      const alias = countMatch[1] || 'count'
      const tableName = countMatch[2]
      const whereStr = countMatch[3]
      let rows = [...getTable(tableName)]
      if (whereStr) rows = rows.filter(buildWherePredicate(whereStr, next))
      return { rows: [{ [alias]: rows.length }], lastInsertRowId: 0, changes: 0 }
    }

    // (d) generic SELECT <cols> FROM <table> [WHERE ...] [ORDER BY ...]
    const genMatch = s.match(/^SELECT\s+.+?\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+.+)?$/i)
    if (genMatch) {
      const tableName = genMatch[1]
      const whereStr = genMatch[2]
      let rows = [...getTable(tableName)]
      if (whereStr) rows = rows.filter(buildWherePredicate(whereStr, next))
      rows = applyOrderBy(rows, s)
      // Return full row objects — callers read the fields they selected;
      // extra fields are harmless.
      return { rows, lastInsertRowId: 0, changes: 0 }
    }
  }

  console.warn('[web-sqlite] unhandled SQL:', s)
  return { rows: [], lastInsertRowId: 0, changes: 0 }
}

const stubDb = {
  execAsync: async (sql) => {
    // execAsync can receive a multi-statement string (split on ';').
    sql.split(';').forEach((stmt) => {
      if (stmt.trim()) runSql(stmt)
    })
  },
  getAllAsync: async (sql, params = []) => runSql(sql, params).rows,
  getFirstAsync: async (sql, params = []) => runSql(sql, params).rows[0] ?? null,
  runAsync: async (sql, params = []) => runSql(sql, params),
  closeAsync: async () => {},
  withTransactionAsync: async (fn) => {
    try {
      await fn()
    } catch (e) {
      console.warn('[web-sqlite] transaction error', e)
    }
  },
}

export async function openDatabaseAsync() {
  return stubDb
}

export const SQLiteProvider = ({ children }) => children
export const useSQLiteContext = () => stubDb

export default { openDatabaseAsync, SQLiteProvider, useSQLiteContext }
