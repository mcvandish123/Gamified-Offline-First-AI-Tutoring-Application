import React, { useState, useEffect, useCallback } from 'react'
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
  getLocalConversations,
  insertLocalConversation,
  markConversationSynced,
  type ConversationWithPreview,
} from '../../db/conversations'
import { getAccessToken } from '../../db/auth-storage'
import { runSync } from '../../db/sync'
import { BACKEND_URL } from '../lib/api'

// ─── Design Tokens ───────────────────────────────────────────────────────────
// Matches library-screen.tsx so the two screens feel like one app.

const D = {
  pageBg: '#F5F5F0',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  tabBarBg: '#FFFFFF',
  green: '#5A8A1F',
  greenAdd: '#5A8A1F',
  textPrimary: '#1A1A1A',
  textSecondary: '#666666',
  textMuted: '#999999',
  textTabActive: '#5A8A1F',
  textTabInactive: '#888888',
  cardBorder: '#E8E8E8',
  dashedBorder: '#CCCCCC',
  accentBar: '#6B9E1E',
  divider: '#EEEEEE',
  overlay: 'rgba(0,0,0,0.45)',
  pagePadH: 16,
  cardRadius: 8,
} as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotebookSummary {
  id: string
  name: string
}

type DetailTab = 'Chats' | 'Quizzes' | 'Flashcards' | 'Match'

// ─── Time formatting ──────────────────────────────────────────────────────────
// Matches the design: "12 mins ago", "2 hours ago", "Yesterday", "Mar 24"

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? '' : 's'} ago`
  if (diffHours < 24)
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── New Chat Modal ───────────────────────────────────────────────────────────

interface NewChatModalProps {
  visible: boolean
  onClose: () => void
  onCreate: (title: string) => void
}

function NewChatModal({ visible, onClose, onCreate }: NewChatModalProps) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const handleCreate = () => {
    if (!title.trim()) {
      setError('Please name this conversation.')
      return
    }
    onCreate(title.trim())
    setTitle('')
    setError('')
    onClose()
  }

  const handleClose = () => {
    setTitle('')
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
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Chat</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Give this conversation a name so you can find it later.
          </Text>

          <TextInput
            style={[styles.modalInput, error ? styles.modalInputError : null]}
            placeholder="e.g. SN1 vs SN2 Review"
            placeholderTextColor={D.textMuted}
            value={title}
            onChangeText={(t) => {
              setTitle(t)
              setError('')
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />

          {!!error && <Text style={styles.modalError}>{error}</Text>}

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
              <Text style={styles.modalBtnCreateText}>Start Chat</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface HeaderProps {
  notebookName: string
  onBack: () => void
}

function Header({ notebookName, onBack }: HeaderProps) {
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: D.headerBg, borderBottomWidth: 1, borderBottomColor: D.divider }}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backRow}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backTitle} numberOfLines={1}>
            {notebookName}
          </Text>
        </TouchableOpacity>
        <Text style={styles.cloudIcon}>☁</Text>
      </View>
    </SafeAreaView>
  )
}

function NotebookCard({ name }: { name: string }) {
  return (
    <View style={styles.notebookCard}>
      <View style={styles.notebookCardImagePlaceholder} />
      <Text style={styles.notebookCardLabel}>NOTEBOOK</Text>
      <Text style={styles.notebookCardTitle}>{name}</Text>
    </View>
  )
}

function NewChatButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.newChatBtn}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={styles.newChatPlus}>+</Text>
      <Text style={styles.newChatLabel}>New Chat</Text>
    </TouchableOpacity>
  )
}

interface TabBarProps {
  active: DetailTab
  onChange: (tab: DetailTab) => void
}

function DetailTabBar({ active, onChange }: TabBarProps) {
  const tabs: DetailTab[] = ['Chats', 'Quizzes', 'Flashcards', 'Match']
  return (
    <View style={styles.detailTabBar}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab}
          style={styles.detailTab}
          onPress={() => onChange(tab)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.detailTabLabel,
              active === tab && styles.detailTabLabelActive,
            ]}
          >
            {tab}
          </Text>
          {active === tab && <View style={styles.detailTabUnderline} />}
        </TouchableOpacity>
      ))}
    </View>
  )
}

interface ConversationCardProps {
  conversation: ConversationWithPreview
  onPress: (conversation: ConversationWithPreview) => void
}

function ConversationCard({ conversation, onPress }: ConversationCardProps) {
  return (
    <TouchableOpacity
      style={styles.convCard}
      onPress={() => onPress(conversation)}
      activeOpacity={0.7}
    >
      <View style={styles.convCardTopRow}>
        <Text style={styles.convCardTitle} numberOfLines={1}>
          {conversation.title}
        </Text>
        <View style={styles.convCardTimeRow}>
          {conversation.synced === 0 && <View style={styles.pendingDot} />}
          <Text style={styles.convCardTime}>
            {formatRelativeTime(conversation.last_message_at)}
          </Text>
        </View>
      </View>
      <Text style={styles.convCardPreview} numberOfLines={1}>
        {conversation.last_message ?? 'No messages yet'}
      </Text>
    </TouchableOpacity>
  )
}

function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>No conversations yet.</Text>
      <TouchableOpacity onPress={onNewChat}>
        <Text style={styles.emptyStateLink}>Start your first chat →</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

interface NotebookDetailScreenProps {
  notebook: NotebookSummary
  onBack: () => void
  onOpenConversation?: (conversation: ConversationWithPreview) => void
}

export default function NotebookDetailScreen({
  notebook,
  onBack,
  onOpenConversation,
}: NotebookDetailScreenProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('Chats')
  const [conversations, setConversations] = useState<ConversationWithPreview[]>(
    [],
  )
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)

  const refreshFromLocal = useCallback(async () => {
    const rows = await getLocalConversations(notebook.id)
    setConversations(rows)
  }, [notebook.id])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      await refreshFromLocal()
      if (cancelled) return
      setLoading(false)

      try {
        await runSync()
        if (!cancelled) await refreshFromLocal()
      } catch (err) {
        console.error('Conversation sync failed:', err)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshFromLocal])

  const handleCreateChat = async (title: string) => {
    const tempId = `local-${Date.now()}`
    const createdAt = new Date().toISOString()

    // Local write first — instant, works offline.
    const localConv = await insertLocalConversation({
      id: tempId,
      module_id: notebook.id,
      user_id: 'local', // overwritten by the server's real user_id once synced
      title,
      created_at: createdAt,
    })
    await refreshFromLocal()

    // If the notebook itself hasn't reached Supabase yet (still has a
    // client-generated id), pushing this conversation now would fail —
    // the server has no module row to attach it to. Leave it queued;
    // runSync() pushes modules before conversations, so it'll catch up
    // automatically once the notebook syncs (e.g. on reconnect).
    if (notebook.id.startsWith('local-')) {
      console.warn(
        `Chat "${title}" queued — notebook ${notebook.id} hasn't synced to Supabase yet.`,
      )
      // Redirect with tempId
      onOpenConversation?.({
        ...localConv,
        message_count: 0,
        last_message: null,
        last_message_at: createdAt,
      })
      return
    }

    // Try to reach Supabase right away.
    try {
      const token = await getAccessToken()
      const res = await fetch(
        `${BACKEND_URL}/modules/${notebook.id}/conversations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title }),
        },
      )

      if (!res.ok) {
        // Backend reachable but rejected the request — log why, instead of
        // failing silently. Row stays queued (synced = 0); sync.ts retries.
        const errBody = await res.text().catch(() => '')
        console.error(
          `Failed to create conversation "${title}" (HTTP ${res.status}): ${errBody}`,
        )
        // Redirect with tempId since server rejected
        onOpenConversation?.({
          ...localConv,
          message_count: 0,
          last_message: null,
          last_message_at: createdAt,
        })
        return
      }

      const json = await res.json()
      await markConversationSynced(tempId, json.conversation)
      await refreshFromLocal()

      // Redirect with Authoritative Server Conversation!
      onOpenConversation?.({
        ...json.conversation,
        message_count: 0,
        last_message: null,
        last_message_at: createdAt,
        synced: 1,
      })
    } catch (err) {
      // Offline — row stays in SQLite with synced = 0
      console.error('Could not reach backend, chat queued for sync:', err)
      // Redirect with tempId (offline fallback)
      onOpenConversation?.({
        ...localConv,
        message_count: 0,
        last_message: null,
        last_message_at: createdAt,
      })
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={D.headerBg} />

      <Header notebookName={notebook.name} onBack={onBack} />

      <NewChatModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreate={handleCreateChat}
      />

      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <NotebookCard name={notebook.name} />

          <NewChatButton onPress={() => setModalVisible(true)} />

          <DetailTabBar active={activeTab} onChange={setActiveTab} />

          {activeTab === 'Chats' ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderLabel}>
                  RECENT CONVERSATIONS
                </Text>
                <Text style={styles.sectionHeaderMeta}>Sorted by time</Text>
              </View>

              {loading ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator color={D.green} />
                </View>
              ) : conversations.length === 0 ? (
                <EmptyState onNewChat={() => setModalVisible(true)} />
              ) : (
                <View style={styles.convList}>
                  {conversations.map((conv) => (
                    <ConversationCard
                      key={conv.id}
                      conversation={conv}
                      onPress={(c) => onOpenConversation?.(c)}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={styles.comingSoon}>
              <Text style={styles.comingSoonText}>
                {activeTab} coming soon.
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
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
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  backArrow: {
    fontSize: 18,
    color: D.green,
    fontWeight: '600',
  },
  backTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: D.green,
    flexShrink: 1,
  },
  cloudIcon: {
    fontSize: 16,
    color: D.textMuted,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: D.pagePadH,
    paddingTop: 16,
  },

  // Notebook hero card
  notebookCard: {
    backgroundColor: '#EEEEEE',
    borderRadius: D.cardRadius,
    borderWidth: 1,
    borderColor: D.cardBorder,
    padding: 16,
    marginBottom: 16,
  },
  notebookCardImagePlaceholder: {
    height: 64,
    borderRadius: 6,
    marginBottom: 28,
  },
  notebookCardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: D.textMuted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  notebookCardTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: D.textPrimary,
  },

  // New Chat button
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: D.green,
    borderRadius: D.cardRadius,
    paddingVertical: 14,
    marginBottom: 18,
    ...Platform.select({
      ios: {
        shadowColor: D.green,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  newChatPlus: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  newChatLabel: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Detail tab bar (segmented control under the New Chat button)
  detailTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: D.divider,
    marginBottom: 16,
  },
  detailTab: {
    marginRight: 22,
    paddingBottom: 10,
  },
  detailTabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: D.textTabInactive,
  },
  detailTabLabelActive: {
    color: D.green,
  },
  detailTabUnderline: {
    marginTop: 8,
    height: 2,
    backgroundColor: D.green,
    borderRadius: 1,
  },

  // Section header ("RECENT CONVERSATIONS · Sorted by time")
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: D.textMuted,
    letterSpacing: 0.5,
  },
  sectionHeaderMeta: {
    fontSize: 11,
    color: D.textMuted,
  },

  // Conversation list
  convList: { gap: 10 },
  convCard: {
    backgroundColor: D.cardBg,
    borderRadius: D.cardRadius,
    borderWidth: 1,
    borderColor: D.cardBorder,
    padding: 14,
  },
  convCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  convCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: D.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  convCardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFA500',
  },
  convCardTime: {
    fontSize: 11,
    color: D.textMuted,
  },
  convCardPreview: {
    fontSize: 12,
    color: D.textSecondary,
  },

  // Loading / empty / placeholder states
  loadingState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyStateText: {
    fontSize: 13,
    color: D.textMuted,
  },
  emptyStateLink: {
    fontSize: 13,
    color: D.green,
    fontWeight: '600',
  },
  comingSoon: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  comingSoonText: {
    fontSize: 13,
    color: D.textMuted,
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
