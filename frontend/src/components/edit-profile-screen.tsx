import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { getAccessToken } from '../../db/auth-storage'
import type { UserProfile } from './settings-screen'

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#EFF4EB',
  headerBg: '#FFFFFF',
  green: '#6B9E1E',
  text: '#1A1A1A',
  textMuted: '#94a3b8',
  inputBg: '#FFFFFF',
  inputBorder: '#E2E8F0',
  inputFocused: '#6B9E1E',
  disabledBg: '#F1F5F9',
  divider: '#E8EDE3',
  helperText: '#64748B',
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
interface EditProfileScreenProps {
  profile: UserProfile
  onBack: () => void
  onSaved: (updatedProfile: UserProfile) => void
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function EditProfileScreen({ profile, onBack, onSaved }: EditProfileScreenProps) {
  const [fullName, setFullName] = useState(profile.username ?? '')
  const [nameFocused, setNameFocused] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Validation', 'Full name cannot be empty.')
      return
    }
    setSaving(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${BACKEND_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: fullName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed to save.')
      onSaved({ ...profile, username: data.user.username })
      Alert.alert('Success', 'Profile updated successfully.')
      onBack()
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  return (
    // SafeAreaView owns ALL edges — handles notch, home bar, macOS titlebar
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
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.headerSideSlot} />
      </View>

      {/* ── Keyboard-aware wrapper ──
          Moves the footer button up when the keyboard appears on iOS. */}
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── Scrollable form fields ──
            flexGrow:1 ensures footer can be pushed to bottom even on tall screens */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Max-width wrapper: centers form on iPad / macOS windows */}
          <View style={styles.formCard}>

            {/* Full Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={[styles.input, nameFocused && styles.inputFocused]}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                returnKeyType="done"
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                placeholderTextColor={C.textMuted}
                {...Platform.select({ web: { outlineStyle: 'none' as any } })}
              />
            </View>

            {/* Email Address — read-only */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.disabledInputWrapper}>
                <Text style={styles.disabledInputText} numberOfLines={1}>
                  {profile.email}
                </Text>
                <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              </View>
              <View style={styles.helperRow}>
                <Ionicons name="information-circle-outline" size={13} color={C.helperText} />
                <Text style={styles.helperText}> Email cannot be changed.</Text>
              </View>
            </View>

            {/* ── Footer: marginTop: 'auto' pushes it to the bottom of the flex
                container regardless of content height or screen size.
                No absolute positioning used. ── */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="save-outline"
                      size={18}
                      color="#FFFFFF"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.saveButtonText}>Save Changes</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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

  // Keyboard view
  keyboardView: {
    flex: 1,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,           // critical: lets footer push down naturally
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 16,
  },

  // Max-width centering for desktop/iPad
  formCard: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  // Form fields
  fieldGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 52,           // ≥48px touch target
    fontSize: 15,
    color: C.text,
    ...Platform.select({ web: { outlineStyle: 'none' as any } }),
  },
  inputFocused: {
    borderColor: C.inputFocused,
    borderWidth: 1.5,
  },
  disabledInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.disabledBg,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 52,           // ≥48px touch target
  },
  disabledInputText: {
    flex: 1,
    fontSize: 15,
    color: C.textMuted,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: 2,
  },
  helperText: {
    fontSize: 12,
    color: C.helperText,
  },

  // Footer — pushed to bottom via marginTop: 'auto'
  footer: {
    marginTop: 'auto' as any,
    paddingTop: 32,
  },
  saveButton: {
    backgroundColor: C.green,
    borderRadius: 12,
    minHeight: 52,           // ≥48px touch target + visual breathing room
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#9DC060',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
})
