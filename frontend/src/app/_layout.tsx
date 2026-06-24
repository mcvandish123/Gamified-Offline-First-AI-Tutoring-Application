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
import ChatScreen from '@/components/chat-screen'
import SettingsScreen, { type UserProfile } from '@/components/settings-screen'
import EditProfileScreen from '@/components/edit-profile-screen'
import { initDb } from '../../db'
import { runSync, startSyncListener } from '../../db/sync'

type Screen = 'library' | 'notebook' | 'settings' | 'editProfile' | 'chat'

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
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
    if (screen === 'settings') {
      return (
        <SettingsScreen
          onBack={() => setScreen('library')}
          onSignOut={() => {
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
        onSettingsPress={() => setScreen('settings')}
      />
    )
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {isAuthenticated ? (
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
