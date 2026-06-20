import { useEffect, useState } from 'react'
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native'
import { useColorScheme } from 'react-native'

import { AnimatedSplashOverlay } from '@/components/animated-icon'
import AppTabs from '@/components/app-tabs'
import LoginScreen from '@/components/login'
import SignUpScreen from '@/components/signup'
import LibraryScreen, { type Notebook } from '@/components/library-screen'
import NotebookDetailScreen from '@/components/notebook-detail-screen'
import { initDb } from '../../db'
import { startSyncListener } from '../../db/sync'

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isSigningUp, setIsSigningUp] = useState(false)
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(
    null,
  )

  useEffect(() => {
    initDb()
      .then(() => {
        startSyncListener()
      })
      .catch((err) => console.error('DB init failed:', err))
  }, [])

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {isAuthenticated ? (
        selectedNotebook ? (
          <NotebookDetailScreen
            notebook={{ id: selectedNotebook.id, name: selectedNotebook.name }}
            onBack={() => setSelectedNotebook(null)}
          />
        ) : (
          <LibraryScreen onNotebookPress={setSelectedNotebook} />
        )
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
