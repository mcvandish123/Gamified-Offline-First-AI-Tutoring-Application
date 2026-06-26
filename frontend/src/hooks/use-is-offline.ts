import { useEffect, useState } from 'react'
import NetInfo from '@react-native-community/netinfo'

// Tracks live connectivity. Used to put the app into a read-only mode when
// offline: cached data (chats, quizzes, flashcards) stays fully viewable, but
// actions that require the server (creating a notebook/chat, uploading a
// source, generating quizzes/flashcards) are disabled.
export function useIsOffline(): boolean {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    let mounted = true

    NetInfo.fetch().then((state) => {
      if (mounted) setIsOffline(!state.isConnected)
    })

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (mounted) setIsOffline(!state.isConnected)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return isOffline
}
