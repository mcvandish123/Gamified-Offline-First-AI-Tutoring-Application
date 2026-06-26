// Typed wrapper around the offline Ollama PDF-Q&A bridge injected by
// electron/preload.js. In a plain browser window.ollamaBridge is undefined —
// always guard with isOllamaAvailable().

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface OllamaStatus {
  ready: boolean
  model: string
}

interface OllamaBridge {
  status: () => Promise<OllamaStatus>
  extractPdf: (
    source: string,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  chat: (payload: {
    context: string
    messages: ChatMessage[]
  }) => Promise<{ ok: true; answer: string } | { ok: false; error: string }>
}

function getBridge(): OllamaBridge | undefined {
  if (typeof window !== 'undefined' && (window as any).ollamaBridge) {
    return (window as any).ollamaBridge as OllamaBridge
  }
  return undefined
}

// True only inside Electron (where the local model runs).
export function isOllamaAvailable(): boolean {
  return !!getBridge()
}

// Is the local model booted and ready to answer? Resolves false in a browser.
export async function getOllamaStatus(): Promise<OllamaStatus> {
  const bridge = getBridge()
  if (!bridge) return { ready: false, model: '' }
  try {
    return await bridge.status()
  } catch {
    return { ready: false, model: '' }
  }
}

// Extract text from a PDF passed as a base64 string (e.g. from a file picker)
// or an absolute path. Returns the text, or throws with a readable message.
export async function extractPdfText(source: string): Promise<string> {
  const bridge = getBridge()
  if (!bridge) throw new Error('PDF chat is only available in the desktop app.')
  const res = await bridge.extractPdf(source)
  if (!res.ok) throw new Error(res.error)
  return res.text
}

// Ask a question about an already-extracted PDF. `context` is the extracted
// text; `messages` is the running conversation. Returns the assistant's reply.
export async function askPdf(
  context: string,
  messages: ChatMessage[],
): Promise<string> {
  const bridge = getBridge()
  if (!bridge) throw new Error('PDF chat is only available in the desktop app.')
  const res = await bridge.chat({ context, messages })
  if (!res.ok) throw new Error(res.error)
  return res.answer
}
