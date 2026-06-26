const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn } = require('child_process')
const { WebSocketServer } = require('ws')
const ollama = require('./ollama')

// ── Config ────────────────────────────────────────────────────────────────────
const WS_PORT = 8765
// The renderer loads from http://127.0.0.1:<STATIC_PORT>. This port MUST stay
// fixed across launches: the web app keeps the auth token AND its offline SQLite
// data in localStorage, which the browser partitions by origin. A random port
// (the old `listen(0)`) gave a new origin every launch, so every restart looked
// like a fresh, logged-out browser. Pinning the port keeps the origin — and the
// login/session/data — stable. Paired with a single-instance lock below so two
// copies of the app never fight over it.
const STATIC_PORT = 8137
// In a packaged build the web export is unpacked under the app resources dir;
// in dev it lives at frontend/dist. app.isPackaged distinguishes the two.
const WEB_BUILD = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', 'frontend', 'dist')
// The bundled Unity build. Packaged: resources/game; dev: repo's game/ folder.
const GAME_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(__dirname, '..', 'game')
const DEV_URL = process.env.EXPO_URL || null  // set EXPO_URL=http://localhost:8081 for hot-reload dev

// ── Static file server ─────────────────────────────────────────────────────────
// Expo's web export uses absolute asset paths (e.g. /_expo/...). Those 404 under
// the file:// protocol, so in production we serve the export over a localhost
// HTTP server and point the window at it. No external dependency needed.
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json',
}

function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath)
        // Prevent path traversal outside the export dir.
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403); res.end('Forbidden'); return
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          // SPA fallback — let the client router handle unknown routes.
          filePath = path.join(rootDir, 'index.html')
        }
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
        fs.createReadStream(filePath).pipe(res)
      } catch (err) {
        res.writeHead(500); res.end('Server error')
      }
    })
    // A fixed port keeps the renderer origin stable so localStorage (auth token +
    // offline DB) survives restarts. If the port is momentarily held — e.g. a
    // just-closed previous instance still releasing it — retry rather than fall
    // back to a different port (which would change the origin and wipe the session).
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[static] port ${STATIC_PORT} busy, retrying in 500ms…`)
        setTimeout(() => server.listen(STATIC_PORT, '127.0.0.1'), 500)
      } else {
        console.error('[static] server error:', err.message)
      }
    })
    server.listen(STATIC_PORT, '127.0.0.1', () => {
      console.log(`[static] serving ${rootDir} on http://127.0.0.1:${STATIC_PORT}`)
      resolve(`http://127.0.0.1:${STATIC_PORT}`)
    })
  })
}

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let wss = null
let unityProcess = null               // handle to the spawned Unity build, if any
let unityLaunchTimer = null           // debounce/delay between kill and relaunch
const pendingForUnity = []            // envelopes to hand the next Unity that connects

// Labelled so we can route messages: 'app' = web UI, 'unity' = game
const clients = new Map()   // ws → { type: 'app' | 'unity' | 'unknown' }

// ── Unity launcher ──────────────────────────────────────────────────────────────
// Locate the Unity standalone executable inside GAME_DIR. The build usually lives
// in a sub-folder (e.g. finalunitybuild/), so we search a couple of levels deep.
function findUnityExecutable() {
  const isExe = (name) => {
    const lower = name.toLowerCase()
    if (/unitycrashhandler/i.test(name)) return false   // skip the crash reporter
    if (process.platform === 'win32') return lower.endsWith('.exe')
    if (process.platform === 'darwin') return lower.endsWith('.app')
    return false
  }

  const search = (dir, depth) => {
    if (depth < 0) return null
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    // Prefer a matching executable at this level before descending.
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (process.platform === 'darwin' && e.isDirectory() && isExe(e.name)) return full
      if (e.isFile() && isExe(e.name)) return full
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = search(path.join(dir, e.name), depth - 1)
        if (found) return found
      }
    }
    return null
  }

  return search(GAME_DIR, 2)
}

// Tear down any running Unity game: close its WebSocket(s) so the old window's
// bridge is gone, then kill the process. No-op if nothing is running.
function killUnity() {
  for (const [ws, meta] of clients.entries()) {
    if (meta.type === 'unity') {
      try { ws.close() } catch {}
      clients.delete(ws)
    }
  }
  if (unityProcess) {
    try { unityProcess.kill() } catch {}
    unityProcess = null
  }
}

// Spawn a fresh Unity instance. Returns false if no build is found.
function launchUnity() {
  const exe = findUnityExecutable()
  if (!exe) {
    console.error(`[unity] No Unity build found under ${GAME_DIR}`)
    return false
  }

  try {
    console.log(`[unity] Launching ${exe}`)
    if (process.platform === 'darwin') {
      // `-n` forces a brand-new instance even if one is already open.
      unityProcess = spawn('open', ['-n', exe], { detached: true, stdio: 'ignore' })
    } else {
      unityProcess = spawn(exe, [], {
        cwd: path.dirname(exe),
        detached: true,
        stdio: 'ignore',
      })
    }
    unityProcess.unref()
    unityProcess.on('exit', () => { unityProcess = null })
    unityProcess.on('error', (err) => {
      console.error('[unity] Failed to launch:', err.message)
      unityProcess = null
    })
    return true
  } catch (err) {
    console.error('[unity] Failed to launch:', err.message)
    unityProcess = null
    return false
  }
}

// Deliver a deck to the game with a guaranteed-fresh state: drop any stale
// queued cards, close the currently-running game, and launch a new instance.
// The new Unity picks up these cards when it connects (see the flush in the
// WebSocket connection handler). The Electron/React window is untouched.
function sendFreshToUnity(envelope) {
  pendingForUnity.length = 0
  pendingForUnity.push(envelope)

  killUnity()

  // Give the OS a moment to release the old window before relaunching.
  if (unityLaunchTimer) clearTimeout(unityLaunchTimer)
  unityLaunchTimer = setTimeout(() => {
    unityLaunchTimer = null
    launchUnity()
  }, 500)
}

// ── WebSocket server ──────────────────────────────────────────────────────────
function startWebSocketServer() {
  wss = new WebSocketServer({ port: WS_PORT })

  wss.on('connection', (ws, req) => {
    // Unity should connect with ?client=unity; the web app uses the IPC bridge
    // instead, but can also connect directly with ?client=app for flexibility.
    const type = new URL(req.url, `ws://localhost:${WS_PORT}`).searchParams.get('client') || 'unknown'
    clients.set(ws, { type })
    console.log(`[WS] Client connected — type: ${type}`)

    // Unity just connected — deliver any flashcards queued while it was starting.
    if (type === 'unity' && pendingForUnity.length) {
      console.log(`[unity] Flushing ${pendingForUnity.length} queued message(s)`)
      for (const envelope of pendingForUnity.splice(0)) {
        if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(envelope))
      }
    }

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        handleMessage(ws, type, data)
      } catch (err) {
        console.error('[WS] Bad JSON from client:', err.message)
      }
    })

    ws.on('close', () => {
      console.log(`[WS] Client disconnected — type: ${type}`)
      clients.delete(ws)
    })

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message)
      clients.delete(ws)
    })
  })

  wss.on('error', (err) => console.error('[WS] Server error:', err.message))
  console.log(`[WS] WebSocket server listening on ws://localhost:${WS_PORT}`)
}

function handleMessage(sender, senderType, data) {
  // Attach origin so the receiver knows who sent it
  const envelope = { from: senderType, ...data }

  if (senderType === 'unity') {
    // Unity → web UI
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('unity-message', envelope)
    }
  } else {
    // app / unknown → Unity (live broadcast to the running game)
    broadcast({ target: 'unity', envelope })
  }
}

function broadcast({ target, envelope }) {
  for (const [ws, meta] of clients.entries()) {
    if (target && meta.type !== target) continue
    if (ws.readyState !== 1 /* OPEN */) continue
    ws.send(JSON.stringify(envelope))
  }
}

// ── IPC: web UI → Unity ───────────────────────────────────────────────────────
ipcMain.on('send-to-unity', (_event, payload) => {
  // Each send opens the game fresh with the chosen deck (closing any prior game).
  sendFreshToUnity({ from: 'app', ...payload })
})

// ── IPC: web UI → local Ollama (offline PDF Q&A) ──────────────────────────────
// invoke/handle (not send/on) so the renderer gets a Promise back with the
// result or error.

// Returns whether the local model is up and ready to answer.
ipcMain.handle('ollama-status', () => ({
  ready: ollama.isReady(),
  model: ollama.MODEL,
}))

// Extract plain text from a PDF. `source` is a base64 string or absolute path.
// Returns the text so the renderer can hold it as the chat context.
ipcMain.handle('ollama-extract-pdf', async (_event, source) => {
  try {
    const text = await ollama.loadPdfText(source)
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Ask a question about a previously-extracted PDF.
// payload = { context: string, messages: [{ role, content }] }
ipcMain.handle('ollama-chat', async (_event, payload) => {
  try {
    const answer = await ollama.chatOverPdf(payload)
    return { ok: true, answer }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── BrowserWindow ─────────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'AI Tutor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (DEV_URL) {
    // Dev: point at the running Expo web dev server for hot reload.
    await mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools()
  } else {
    // Production: serve the static export over localhost and load that.
    const baseUrl = await startStaticServer(WEB_BUILD)
    await mainWindow.loadURL(baseUrl)
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
// Only one instance may run: a second copy would fail to bind the fixed static
// port (and the WS port). Instead, hand focus to the window that's already open.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    startWebSocketServer()
    // Boot the local LLM in the background — don't block the window on it.
    ollama.start().catch((err) => console.error('[ollama] start failed:', err.message))
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (wss) wss.close()
  ollama.stop()
  killUnity()
  if (process.platform !== 'darwin') app.quit()
})

// Make sure child processes are never left running after we exit.
app.on('before-quit', () => {
  ollama.stop()
  killUnity()
})
