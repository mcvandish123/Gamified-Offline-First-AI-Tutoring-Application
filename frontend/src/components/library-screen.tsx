import React, { useState, useEffect, useCallback } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Logo } from './logo'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  getLocalModules,
  insertLocalModule,
  markModuleSynced,
  type LocalModule,
} from '../../db/modules'
import { getAccessToken } from '../../db/auth-storage'
import { runSync, getUnsyncedCount } from '../../db/sync'
import { BACKEND_URL } from '../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────
// Notebook is a thin view-model over a LocalModule (the modules table row).

export interface Notebook {
  id: string
  name: string
  chatCount: number
  synced: boolean
}

function toNotebook(mod: LocalModule): Notebook {
  return {
    id: mod.id,
    name: mod.title,
    chatCount: mod.chat_count,
    synced: mod.synced === 1,
  }
}

// ─── Design Tokens ───────────────────────────────────────────────────────────

const D = {
  pageBg: '#F2F4EF',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  tabBarBg: '#FFFFFF',
  green: '#5A8A1F',
  greenAdd: '#5A8A1F',
  greenLight: '#EBF3DF',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textTabActive: '#5A8A1F',
  textTabInactive: '#888888',
  cardBorder: '#E5ECD9',
  dashedBorder: '#C5D6A8',
  accentBar: '#6B9E1E',
  divider: '#EEEEEE',
  overlay: 'rgba(0,0,0,0.45)',
  pagePadH: 16,
  cardPadH: 16,
  cardPadV: 20,
  cardRadius: 12,
  accentBarW: 4,
} as const

// ─── New Notebook Modal ───────────────────────────────────────────────────────

interface NewNotebookModalProps {
  visible: boolean
  onClose: () => void
  onCreate: (name: string) => void
}

function NewNotebookModal({
  visible,
  onClose,
  onCreate,
}: NewNotebookModalProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleCreate = () => {
    if (!name.trim()) {
      setError('Please enter a notebook name.')
      return
    }
    onCreate(name.trim())
    setName('')
    setError('')
    onClose()
  }

  const handleClose = () => {
    setName('')
    setError('')
    onClose()
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Notebook</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Give your notebook a name to get started.
          </Text>

          {/* Input */}
          <TextInput
            style={[styles.modalInput, error ? styles.modalInputError : null]}
            placeholder="e.g. Organic Chemistry"
            placeholderTextColor={D.textMuted}
            value={name}
            onChangeText={(t) => {
              setName(t)
              setError('')
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />

          {/* Inline error */}
          {!!error && <Text style={styles.modalError}>{error}</Text>}

          {/* Actions */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.modalBtnCancel}
              onPress={handleClose}
              activeOpacity={0.7}
            >
              <Text style={styles.modalBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalBtnCreate}
              onPress={handleCreate}
              activeOpacity={0.85}
            >
              <Text style={styles.modalBtnCreateText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface TopBarProps {
  syncing: boolean
  pendingCount: number
  onSyncPress: () => void
}

function TopBar({ syncing, pendingCount, onSyncPress }: TopBarProps) {
  return (
    <View style={styles.topBar}>
      <Logo style={styles.logoImage} />
      <TouchableOpacity
        style={styles.offlineBadge}
        onPress={onSyncPress}
        disabled={syncing}
        activeOpacity={0.7}
      >
        {syncing ? (
          <ActivityIndicator size="small" color={D.textMuted} />
        ) : (
          <View
            style={[
              styles.offlineDot,
              pendingCount === 0 && styles.offlineDotSynced,
            ]}
          />
        )}
        <Text style={styles.offlineText}>
          {syncing
            ? 'Syncing…'
            : pendingCount > 0
              ? `${pendingCount} pending · Tap to sync`
              : 'Synced'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

interface NotebookCardProps {
  notebook: Notebook
  onPress: (notebook: Notebook) => void
}

function NotebookCard({ notebook, onPress }: NotebookCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(notebook)}
      activeOpacity={0.75}
    >
      {/* ── Title block (top) ── */}
      <View style={styles.cardTop}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
            {notebook.name}
          </Text>
          {!notebook.synced && (
            <View
              style={styles.pendingDot}
              accessibilityLabel="Not yet synced"
            />
          )}
        </View>
      </View>

      {/* ── Metadata (bottom) ── */}
      <Text style={styles.cardSubtitle}>
        {notebook.chatCount} {notebook.chatCount === 1 ? 'Chat' : 'Chats'}
      </Text>
    </TouchableOpacity>
  )
}

function NewNotebookCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.newCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.newCardPlus}>+</Text>
      <Text style={styles.newCardLabel}>New Notebook</Text>
    </TouchableOpacity>
  )
}

function FAB({
  onPress,
  bottomOffset,
}: {
  onPress: () => void
  bottomOffset: number
}) {
  return (
    <TouchableOpacity
      style={[styles.fab, { bottom: bottomOffset }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={styles.fabIcon}>+</Text>
    </TouchableOpacity>
  )
}

interface TabItemProps {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  active?: boolean
}

function TabItem({ icon, label, active }: TabItemProps) {
  const color = active ? '#6B9E1E' : '#94a3b8'
  return (
    <View style={styles.tabItem}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </View>
  )
}

function BottomTabBar({
  onLayout,
  onSettingsPress,
}: {
  onLayout?: (height: number) => void
  onSettingsPress?: () => void
}) {
  return (
    <View
      style={styles.tabBar}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
    >
      <TabItem icon="library-outline" label="Library" active />
      <TabItem icon="school-outline" label="Study" />
      <TabItem icon="game-controller-outline" label="Game" />
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={onSettingsPress}
        activeOpacity={0.7}
      >
        <TabItem icon="settings-outline" label="Settings" />
      </TouchableOpacity>
    </View>
  )
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

interface LibraryScreenProps {
  onNotebookPress?: (notebook: Notebook) => void
  onSettingsPress?: () => void
}

export default function LibraryScreen({
  onNotebookPress,
  onSettingsPress,
}: LibraryScreenProps) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [tabBarHeight, setTabBarHeight] = useState(64)
  const [syncing, setSyncing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  // Reads the current local cache and reflects it in state. SQLite is the
  // single source of truth the UI renders from — both the offline-created
  // rows (synced = 0) and rows pulled down from Supabase live here.
  const refreshFromLocal = useCallback(async () => {
    const rows = await getLocalModules()
    setNotebooks(rows.map(toNotebook))
    setPendingCount(await getUnsyncedCount())
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await runSync()
    } catch (err) {
      // Offline or backend unreachable — local cache still shown, badge
      // keeps reflecting whatever's still queued.
      console.error('Manual sync failed:', err)
    } finally {
      await refreshFromLocal()
      setSyncing(false)
    }
  }, [refreshFromLocal])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      await refreshFromLocal()
      if (cancelled) return
      setLoading(false)

      // Kick a sync in the background (pushes anything queued, pulls fresh
      // data from Supabase) then re-render from local once it settles.
      setSyncing(true)
      try {
        await runSync()
        if (!cancelled) await refreshFromLocal()
      } catch (err) {
        // Offline or backend unreachable — local cache is still shown
        console.error('Initial sync failed:', err)
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshFromLocal])

  const handleCreate = async (name: string) => {
    const tempId = `local-${Date.now()}`
    const createdAt = new Date().toISOString()

    // 1. Write to SQLite immediately (synced = 0) so it shows up instantly,
    //    works offline, and survives an app restart even without network.
    await insertLocalModule({ id: tempId, title: name, created_at: createdAt })
    await refreshFromLocal()

    // 2. Try to push it to Supabase right away.
    try {
      const token = await getAccessToken()
      const res = await fetch(`${BACKEND_URL}/modules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: name }),
      })

      if (!res.ok) {
        // Backend reachable but rejected the request — log why, instead of
        // failing silently. Leave it queued locally; sync.ts will retry
        // next time the listener fires.
        const errBody = await res.text().catch(() => '')
        console.error(
          `Failed to create notebook "${name}" (HTTP ${res.status}): ${errBody}`,
        )
        return
      }

      const json = await res.json()
      await markModuleSynced(tempId, json.module)
      await refreshFromLocal()
    } catch (err) {
      // Offline or request failed to reach the backend at all — the row
      // stays in SQLite with synced = 0. startSyncListener() in _layout.tsx
      // will push it automatically once connectivity returns.
      console.error('Could not reach backend, notebook queued for sync:', err)
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={D.headerBg} />

      <NewNotebookModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreate={handleCreate}
      />

      <SafeAreaView
        style={styles.safeArea}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <TopBar
          syncing={syncing}
          pendingCount={pendingCount}
          onSyncPress={handleSync}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>Library</Text>
            <Text style={styles.pageSubtitle}>
              Manage your systematic learning modules.
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={D.green} />
            </View>
          ) : (
            <View style={styles.notebookList}>
              {notebooks.map((nb) => (
                <NotebookCard
                  key={nb.id}
                  notebook={nb}
                  onPress={(n) => onNotebookPress?.(n)}
                />
              ))}
              <NewNotebookCard onPress={() => setModalVisible(true)} />
            </View>
          )}

          <View style={{ height: 80 }} />
        </ScrollView>

        <BottomTabBar
          onLayout={setTabBarHeight}
          onSettingsPress={onSettingsPress}
        />
        <FAB
          onPress={() => setModalVisible(true)}
          bottomOffset={tabBarHeight + 50}
        />
      </SafeAreaView>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: D.pageBg,
  },
  safeArea: {
    flex: 1,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: D.headerBg,
    paddingHorizontal: D.pagePadH,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: D.divider,
  },
  logoImage: {
    width: 120,
    height: 36,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  offlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFA500',
  },
  offlineDotSynced: {
    backgroundColor: '#22C55E',
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: D.textSecondary,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: D.pagePadH,
    paddingTop: 20,
  },

  // Page header
  pageHeader: { marginBottom: 20 },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: D.textPrimary,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 13,
    color: D.textSecondary,
    lineHeight: 18,
  },

  // ── 2-column notebook grid ───────────────────────────────────────────────
  notebookList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  loadingState: {
    paddingVertical: 40,
    alignItems: 'center',
  },

  // ── Notebook card ────────────────────────────────────────────────────────
  card: {
    // Each card takes exactly half the row minus half the gap
    width: '48%' as unknown as number,
    flexDirection: 'column',
    justifyContent: 'space-between',
    backgroundColor: D.cardBg,
    borderRadius: D.cardRadius,
    borderWidth: 1,
    borderColor: D.cardBorder,
    minHeight: 140,
    paddingHorizontal: D.cardPadH,
    paddingVertical: D.cardPadV,
    ...Platform.select({
      ios: {
        shadowColor: '#2D4A0E',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.09,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
    }),
  },
  cardTop: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: D.textPrimary,
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  pendingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFA500',
    marginTop: 6,
    flexShrink: 0,
  },
  cardSubtitle: {
    marginTop: 16,
    fontSize: 11,
    fontWeight: '500',
    color: D.textMuted,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },

  // ── New notebook dashed card ─────────────────────────────────────────────
  newCard: {
    width: '48%' as unknown as number,
    minHeight: 140,
    backgroundColor: '#FAFCF7',
    borderRadius: D.cardRadius,
    borderWidth: 1.5,
    borderColor: D.dashedBorder,
    borderStyle: 'dashed',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: D.cardPadV,
    paddingHorizontal: D.cardPadH,
  },
  newCardPlus: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '300',
    color: D.green,
  },
  newCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: D.green,
    textAlign: 'center',
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: D.greenAdd,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: D.greenAdd,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
    }),
  },
  fabIcon: {
    fontSize: 26,
    color: '#FFFFFF',
    lineHeight: 30,
    marginTop: -2,
  },

  // Bottom tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: D.tabBarBg,
    borderTopWidth: 1,
    borderTopColor: D.divider,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94a3b8',
    marginTop: 2,
  },
  tabLabelActive: {
    color: '#6B9E1E',
    fontWeight: '700',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: D.overlay,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: D.textPrimary,
  },
  modalClose: {
    fontSize: 16,
    color: D.textMuted,
    fontWeight: '500',
  },
  modalSubtitle: {
    fontSize: 13,
    color: D.textSecondary,
    marginBottom: 20,
    lineHeight: 18,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: D.textPrimary,
    backgroundColor: '#F8FAFC',
    marginBottom: 6,
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  modalInputError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF5F5',
  },
  modalError: {
    fontSize: 12,
    color: '#DC2626',
    marginBottom: 16,
    marginLeft: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  modalBtnCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalBtnCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: D.textSecondary,
  },
  modalBtnCreate: {
    flex: 1,
    backgroundColor: D.green,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalBtnCreateText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
})
