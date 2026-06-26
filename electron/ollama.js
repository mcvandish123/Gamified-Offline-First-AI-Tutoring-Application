// ─────────────────────────────────────────────────────────────────────────────
// ollama.js — local LLM lifecycle + PDF Q&A for the Electron main process.
//
// Job: run a bundled Ollama server entirely offline and answer questions about
// a PDF. Flow is text-only:
//     PDF file ──► extract text (pdf-parse) ──► Ollama chat ──► answer
//
// Nothing here touches the cloud or the NestJS backend, so PDF chat works with
// no internet and no API keys.
//
// Bundling layout (see ollama/PLACE_OLLAMA_HERE.md):
//   packaged:  <resources>/ollama/ollama(.exe)   + <resources>/ollama/models/
//   dev:       <repo>/ollama/ollama(.exe)         + <repo>/ollama/models/
// If no bundled binary is found we fall back to an `ollama` already on PATH so
// the feature still works on a dev machine with Ollama installed system-wide.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { app } = require('electron')

// ── Config ──────────────────────────────────────────────────────────────────
const OLLAMA_HOST = '127.0.0.1'
const OLLAMA_PORT = 11434
const OLLAMA_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`

// The small text model used for PDF Q&A. Change this one line to swap models.
// qwen2.5:1.5b (~1 GB) is the smallest that follows instructions well; the
// model blobs must be present under the bundled models/ dir (offline).
const MODEL = 'qwen2.5:1.5b'

// Tiny models have limited context and get slow with huge prompts, so we cap
// how much extracted PDF text we feed in. ~24k chars ≈ 6–8k tokens — enough for
// most slide decks / handouts. (For very long PDFs you'd add retrieval later.)
const MAX_CONTEXT_CHARS = 24000

// ── State ────────────────────────────────────────────────────────────────────
let child = null          // the `ollama serve` child process
let ready = false         // true once the server answers /api/tags
let startPromise = null   // de-dupes concurrent start() calls

// ── Locate the bundled binary + models ───────────────────────────────────────
function resolvePaths() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'ollama')
    : path.join(__dirname, '..', 'ollama')

  const exeName = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const bundledExe = path.join(base, exeName)
  const modelsDir = path.join(base, 'models')

  return {
    // Use the bundled exe if present, otherwise trust `ollama` on PATH.
    exe: fs.existsSync(bundledExe) ? bundledExe : 'ollama',
    bundledExe,
    modelsDir: fs.existsSync(modelsDir) ? modelsDir : null,
  }
}

// ── Start the server ─────────────────────────────────────────────────────────
// Returns a promise that resolves true once Ollama is reachable, false if it
// could not be started (e.g. no binary). Safe to call more than once.
function start() {
  if (startPromise) return startPromise

  startPromise = new Promise(async (resolve) => {
    const { exe, bundledExe, modelsDir } = resolvePaths()

    // If a server is already running on the port (dev machine ran `ollama
    // serve` manually), just use it instead of spawning a second one.
    if (await ping()) {
      ready = true
      console.log('[ollama] Reusing already-running server.')
      return resolve(true)
    }

    if (exe === 'ollama' && !fs.existsSync(bundledExe)) {
      console.warn(
        `[ollama] No bundled binary at ${bundledExe}. Falling back to "ollama" on PATH. ` +
          'PDF chat will be unavailable if it is not installed.',
      )
    }

    const env = {
      ...process.env,
      OLLAMA_HOST: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
    }
    // Point Ollama at the bundled model blobs so it runs fully offline.
    if (modelsDir) env.OLLAMA_MODELS = modelsDir

    try {
      child = spawn(exe, ['serve'], { env, stdio: 'pipe' })
    } catch (err) {
      console.error('[ollama] Failed to spawn:', err.message)
      return resolve(false)
    }

    child.stdout?.on('data', (d) => console.log('[ollama]', d.toString().trim()))
    child.stderr?.on('data', (d) => console.log('[ollama]', d.toString().trim()))
    child.on('exit', (code) => {
      console.log(`[ollama] Server exited (code ${code}).`)
      ready = false
      child = null
    })
    child.on('error', (err) => {
      console.error('[ollama] Process error:', err.message)
    })

    // Poll until the HTTP API responds (model load can take a few seconds).
    const ok = await waitForReady(30000)
    ready = ok
    console.log(ok ? '[ollama] Server is ready.' : '[ollama] Server did not become ready in time.')
    resolve(ok)
  })

  return startPromise
}

// One health-check request.
async function ping() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ping()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function isReady() {
  return ready
}

// ── PDF text extraction ──────────────────────────────────────────────────────
// Requiring the lib file directly avoids pdf-parse's index.js debug block,
// which tries to read a bundled test PDF on import.
function extractPdfText(buffer) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js')
  return pdfParse(buffer).then((data) => data.text || '')
}

// Read a PDF from disk (path) or accept an already-loaded Buffer/base64.
async function loadPdfText(source) {
  let buffer
  if (Buffer.isBuffer(source)) {
    buffer = source
  } else if (typeof source === 'string' && fs.existsSync(source)) {
    buffer = fs.readFileSync(source)
  } else if (typeof source === 'string') {
    // Assume base64 (e.g. file picked in the renderer and sent over IPC).
    buffer = Buffer.from(source, 'base64')
  } else {
    throw new Error('Unsupported PDF source')
  }
  const text = await extractPdfText(buffer)
  return text.trim()
}

// ── Chat / Q&A over a PDF ─────────────────────────────────────────────────────
// `context` is the extracted PDF text; `messages` is the running conversation
// ([{ role: 'user'|'assistant', content }]). Returns the assistant's answer.
async function chatOverPdf({ context, messages }) {
  if (!ready) throw new Error('Ollama is not ready yet.')

  const trimmed = (context || '').slice(0, MAX_CONTEXT_CHARS)
  const truncatedNote =
    context && context.length > MAX_CONTEXT_CHARS
      ? '\n\n[Note: the document was long and has been truncated.]'
      : ''

  const system =
    'You are a study assistant. Answer the user\'s questions using ONLY the ' +
    'document text provided below. If the answer is not in the document, say ' +
    'so plainly. Keep answers concise.\n\n' +
    '=== DOCUMENT START ===\n' +
    trimmed +
    truncatedNote +
    '\n=== DOCUMENT END ==='

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ollama chat failed (${res.status}): ${body}`)
  }

  const json = await res.json()
  return json?.message?.content ?? ''
}

// ── Shutdown ─────────────────────────────────────────────────────────────────
function stop() {
  if (child) {
    try {
      child.kill()
    } catch {
      /* best-effort */
    }
    child = null
  }
  ready = false
}

module.exports = {
  start,
  stop,
  isReady,
  loadPdfText,
  chatOverPdf,
  MODEL,
}
