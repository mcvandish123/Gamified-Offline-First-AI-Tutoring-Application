// Type declaration for the bridge injected by electron/preload.js.
// In a regular browser window.unityBridge is undefined — always guard with isElectron().

export interface UnityPayload {
  type: string
  [key: string]: unknown
}

interface UnityBridge {
  sendToUnity: (payload: UnityPayload) => void
  onUnityMessage: (callback: (data: UnityPayload) => void) => () => void
  isElectron: true
}

function getBridge(): UnityBridge | undefined {
  if (typeof window !== 'undefined' && (window as any).unityBridge) {
    return (window as any).unityBridge as UnityBridge
  }
  return undefined
}

export function isElectron(): boolean {
  return !!getBridge()
}

// Send a JSON payload to the Unity game.
// Safe to call in the browser — silently no-ops if not in Electron.
export function sendToUnity(payload: UnityPayload): void {
  getBridge()?.sendToUnity(payload)
}

// ── Flashcards → Unity ────────────────────────────────────────────────────────

// The flashcard shape sent to the game. Kept minimal/stable so the Unity side
// can rely on it regardless of internal DB columns.
export interface UnityFlashcard {
  id: string
  front: string
  back: string
}

export interface SendFlashcardsOptions {
  deckId: string          // conversation id (or module id) the deck came from
  deckTitle: string       // human-readable deck name shown in the game
  cards: UnityFlashcard[]
}

// Sends a deck of flashcards to the Unity game as a single JSON message.
// Returns true if the bridge was available (running in Electron), false if not
// (e.g. plain browser) so the caller can show appropriate UI.
export function sendFlashcardsToUnity(options: SendFlashcardsOptions): boolean {
  const bridge = getBridge()
  if (!bridge) return false
  bridge.sendToUnity({
    type: 'flashcards',
    deckId: options.deckId,
    deckTitle: options.deckTitle,
    count: options.cards.length,
    cards: options.cards,
    sentAt: new Date().toISOString(),
  })
  return true
}

// React hook — subscribes to messages FROM Unity and calls `onMessage` when one arrives.
// Returns nothing; cleanup is handled automatically via the returned unsubscribe fn.
import { useEffect } from 'react'

export function useUnityMessages(onMessage: (data: UnityPayload) => void): void {
  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return
    const unsubscribe = bridge.onUnityMessage(onMessage)
    return unsubscribe
  }, [onMessage])
}
