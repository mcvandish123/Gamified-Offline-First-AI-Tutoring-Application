import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { getAccessToken, clearAccessToken } from '../../db/auth-storage'

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#EFF4EB',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  green: '#6B9E1E',
  text: '#1A1A1A',
  textSub: '#666666',
  textMuted: '#94a3b8',
  divider: '#E8EDE3',
  signOutBorder: '#F87171',
  signOutText: '#DC2626',
} as const

// ─── Backend URL ──────────────────────────────────────────────────────────────
const getBackendUrl = () => {
  if (Platform.OS === 'web') return 'http://localhost:3000'
  const hostUri = Constants.expoConfig?.hostUri
  if (hostUri) return `http://${hostUri.split(':')[0]}:3000`
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000'
}
const BACKEND_URL = getBackendUrl()

// ─── Types ────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string
  email: string
  username: string
  avatar_url?: string
}

interface SettingsScreenProps {
  onBack: () => void
  onSignOut: () => void
  onEditProfile: (profile: UserProfile) => void
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SettingsScreen({ onBack, onSignOut, onEditProfile }: SettingsScreenProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => { fetchProfile() }, [])

  const fetchProfile = async () => {
    try {
      const token = await getAccessToken()
      const res = await fetch(`${BACKEND_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) setProfile(data.user)
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true)
          await clearAccessToken()
          onSignOut()
        },
      },
    ])
  }

  return (
    // SafeAreaView covers ALL edges — handles notch, status bar, home bar, macOS titlebar
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={C.headerBg} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={styles.headerSideSlot}
        >
          <Ionicons name="chevron-back" size={24} color={C.green} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSideSlot} />
      </View>

      {/* ── Scrollable Body ──
          flex:1 lets this fill all space between header and bottom home bar.
          ScrollView with bounces=false prevents rubberbanding on macOS/iPad. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Constrain to maxWidth 480 on large screens, center horizontally */}
        <View style={styles.contentCard}>

          {/* Account Section */}
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            {loading ? (
              <ActivityIndicator color={C.green} style={{ paddingVertical: 20 }} />
            ) : (
              <>
                {/* Subtle gray avatar — no distracting container */}
                <View style={styles.avatarRow}>
                  <Ionicons name="person-circle-outline" size={48} color="#CBD5E1" />
                </View>

                <Text style={styles.userName}>{profile?.username ?? '—'}</Text>
                <Text style={styles.userEmail}>{profile?.email ?? '—'}</Text>

                <TouchableOpacity
                  style={styles.editLink}
                  onPress={() => profile && onEditProfile(profile)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.editLinkText}>Edit Profile →</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* ── Footer: pushed down naturally via marginTop: 'auto' ──
              This avoids absolute positioning while still anchoring to the
              bottom of the available flex space on any screen height. */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
              disabled={signingOut}
              activeOpacity={0.8}
            >
              {signingOut ? (
                <ActivityIndicator color={C.signOutText} size="small" />
              ) : (
                <Text style={styles.signOutText}>Sign Out</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.version}>v1.0.0-mvp</Text>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.headerBg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
  },
  headerSideSlot: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: C.green,
    letterSpacing: -0.2,
  },

  // Scroll container
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,           // allows footer push on short AND tall screens
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
  },

  // Max-width content wrapper (centers on iPad / macOS)
  contentCard: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  // Section
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Account card
  card: {
    backgroundColor: C.cardBg,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
      web: {
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      },
    }),
  },
  avatarRow: {
    marginBottom: 8,
  },
  userName: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 13,
    color: C.textSub,
    marginBottom: 16,
  },
  editLink: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
  },
  editLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.green,
  },

  // Footer — marginTop: 'auto' pushes it to bottom of the flex container
  footer: {
    marginTop: 'auto' as any,
    paddingTop: 32,
  },
  signOutButton: {
    borderWidth: 1.5,
    borderColor: C.signOutBorder,
    borderRadius: 12,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.signOutText,
  },
  version: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 12,
    color: C.textMuted,
  },
})
