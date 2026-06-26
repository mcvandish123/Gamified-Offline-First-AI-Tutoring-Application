import { useEffect, useState } from 'react'
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native'
import { useColorScheme } from 'react-native'

import { AnimatedSplashOverlay } from '@/components/animated-icon'
import LoginScreen from '@/components/login'
import SignUpScreen from '@/components/signup'
import LibraryScreen, { type Notebook } from '@/components/library-screen'
import NotebookDetailScreen from '@/components/notebook-detail-screen'
import GameScreen from '@/components/game-screen'
import ChatScreen from '@/components/chat-screen'
import SettingsScreen, { type UserProfile } from '@/components/settings-screen'
import EditProfileScreen from '@/components/edit-profile-screen'
import { initDb, resetDb } from '../../db'
import { runSync, startSyncListener } from '../../db/sync'
import { getAccessToken, clearAccessToken } from '../../db/auth-storage'

type Screen = 'library' | 'notebook' | 'game' | 'settings' | 'editProfile' | 'chat'

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // Until we've checked for a stored token, don't render anything decisive —
  // otherwise the login screen flashes for a frame on every launch even when
  // the user is already signed in.
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isSigningUp, setIsSigningUp] = useState(false)
  const [screen, setScreen] = useState<Screen>('library')
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(
    null,
  )
  const [selectedConversation, setSelectedConversation] = useState<any | null>(
    null,
  )
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    initDb()
      .then(() => {
        startSyncListener()
        // Also sync once on launch — startSyncListener only fires on
        // network *transitions*, so a backlog of unsynced rows (e.g. from
        // before a backend fix landed) would otherwise sit untouched until
        // connectivity happens to drop and come back.
        runSync().catch((err) => console.error('Initial sync failed:', err))
      })
      .catch((err) => console.error('DB init failed:', err))
  }, [])

  // Restore a previous session on launch. The access token is persisted
  // (SecureStore on native, localStorage on web), so a logged-in user who
  // closes and reopens the app — or refreshes the Electron window — should
  // stay signed in and land straight on their library, including offline.
  useEffect(() => {
    let cancelled = false
    getAccessToken()
      .then((token) => {
        if (cancelled) return
        if (token) setIsAuthenticated(true)
      })
      .catch((err) => console.error('Failed to restore session:', err))
      .finally(() => {
        if (!cancelled) setCheckingAuth(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const renderAuthenticated = () => {
    if (screen === 'chat' && selectedNotebook && selectedConversation) {
      return (
        <ChatScreen
          notebook={{ id: selectedNotebook.id, name: selectedNotebook.name }}
          conversation={{
            id: selectedConversation.id,
            title: selectedConversation.title,
          }}
          onBack={() => setScreen('notebook')}
          onNavigateToSettings={() => setScreen('settings')}
          onNavigateToLibrary={() => setScreen('library')}
        />
      )
    }
    if (screen === 'notebook' && selectedNotebook) {
      return (
        <NotebookDetailScreen
          notebook={{ id: selectedNotebook.id, name: selectedNotebook.name }}
          onBack={() => setScreen('library')}
          onOpenConversation={(conv) => {
            setSelectedConversation(conv)
            setScreen('chat')
          }}
        />
      )
    }
    if (screen === 'game') {
      return (
        <GameScreen
          onNavigateToLibrary={() => setScreen('library')}
          onNavigateToSettings={() => setScreen('settings')}
        />
      )
    }
    if (screen === 'settings') {
      return (
        <SettingsScreen
          onBack={() => setScreen('library')}
          onSignOut={async () => {
            try {
              await resetDb()
            } catch (err) {
              console.error('Failed to reset local DB on sign out:', err)
            }
            // Clear the persisted token too, otherwise the startup session
            // restore would silently sign the user back in on next launch.
            try {
              await clearAccessToken()
            } catch (err) {
              console.error('Failed to clear token on sign out:', err)
            }
            setSelectedNotebook(null)
            setSelectedConversation(null)
            setProfile(null)
            setIsAuthenticated(false)
            setScreen('library')
          }}
          onEditProfile={(p) => {
            setProfile(p)
            setScreen('editProfile')
          }}
        />
      )
    }
    if (screen === 'editProfile' && profile) {
      return (
        <EditProfileScreen
          profile={profile}
          onBack={() => setScreen('settings')}
          onSaved={(updated) => {
            setProfile(updated)
            setScreen('settings')
          }}
        />
      )
    }
    // Default: library
    return (
      <LibraryScreen
        onNotebookPress={(nb) => {
          setSelectedNotebook(nb)
          setScreen('notebook')
        }}
        onGamePress={() => setScreen('game')}
        onSettingsPress={() => setScreen('settings')}
      />
    )
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {checkingAuth ? (
        // Still restoring the session — render only the splash (above) to
        // avoid a one-frame flash of the login screen for signed-in users.
        null
      ) : isAuthenticated ? (
        renderAuthenticated()
      ) : isSigningUp ? (
        <SignUpScreen
          onSignUpSuccess={() => setIsSigningUp(false)}
          onBackToLogin={() => setIsSigningUp(false)}
        />
      ) : (
        <LoginScreen
          onLoginSuccess={() => setIsAuthenticated(true)}
          onSignUpPress={() => setIsSigningUp(true)}
        />
      )}
    </ThemeProvider>
  )
}
