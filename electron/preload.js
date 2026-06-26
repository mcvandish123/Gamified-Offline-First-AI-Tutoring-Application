const { contextBridge, ipcRenderer } = require('electron')

// Exposes a safe bridge so the Expo web app can communicate with Unity
// without needing nodeIntegration enabled in the renderer.
contextBridge.exposeInMainWorld('unityBridge', {
  // Send any JSON-serialisable payload to the Unity game.
  sendToUnity: (payload) => ipcRenderer.send('send-to-unity', payload),

  // Register a callback for messages arriving FROM Unity.
  // Returns a cleanup function — call it in useEffect cleanup.
  onUnityMessage: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('unity-message', listener)
    return () => ipcRenderer.removeListener('unity-message', listener)
  },

  // Check whether we're running inside Electron (returns true) or a browser (returns undefined).
  isElectron: true,
})

// Exposes the local (offline) Ollama PDF-Q&A bridge to the web app.
// All calls return Promises. In a plain browser window.ollamaBridge is undefined.
contextBridge.exposeInMainWorld('ollamaBridge', {
  // { ready: boolean, model: string } — is the local model up?
  status: () => ipcRenderer.invoke('ollama-status'),

  // Extract text from a PDF. `source` = base64 string or absolute file path.
  // Resolves { ok, text } or { ok: false, error }.
  extractPdf: (source) => ipcRenderer.invoke('ollama-extract-pdf', source),

  // Ask about an extracted PDF.
  // payload = { context: string, messages: [{ role, content }] }
  // Resolves { ok, answer } or { ok: false, error }.
  chat: (payload) => ipcRenderer.invoke('ollama-chat', payload),
})
