import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
  ActivityIndicator,
  Switch,
  Alert,
  Animated,
  Modal,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import NetInfo from '@react-native-community/netinfo'
import * as DocumentPicker from 'expo-document-picker'
import {
  getLocalChats,
  insertLocalChat,
  insertOrReplaceChats,
  type LocalChat,
} from '../../db/chats'
import { markConversationSynced } from '../../db/conversations'
import { getResourceForModule, type LocalResource } from '../../db/resources'
import {
  getSourcesForConversation,
  insertConversationSource,
  removeConversationSource,
  type LocalConversationSource,
} from '../../db/conversation-sources'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getAccessToken } from '../../db/auth-storage'
import { BACKEND_URL } from '../lib/api'
import {
  getLocalFlashcardsForConversation,
  upsertLocalFlashcardProgress,
  type LocalFlashcard,
} from '../../db/flashcards'


// ─── Design Tokens ───────────────────────────────────────────────────────────
const D = {
  pageBg: '#F8F9FA',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  green: '#5A8A1F',
  greenLight: '#E8F5E9',
  accentGreen: '#6B9E1E',
  textPrimary: '#1A1A1A',
  textSecondary: '#4A5568',
  textMuted: '#A0AEC0',
  border: '#E2E8F0',
  bubbleBgAssistant: '#F4F5F0',
  bubbleBgUser: '#FFFFFF',
} as const

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

interface ChatScreenProps {
  notebook: { id: string; name: string }
  conversation: { id: string; title: string }
  onBack: () => void
  onNavigateToSettings?: () => void
  onNavigateToLibrary?: () => void
}

export default function ChatScreen({
  notebook,
  conversation,
  onBack,
  onNavigateToSettings,
  onNavigateToLibrary,
}: ChatScreenProps) {
  const [messages, setMessages] = useState<LocalChat[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState(
    conversation.id,
  )
  const [sources, setSources] = useState<LocalConversationSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [isCompiling, setIsCompiling] = useState(false)
  const [flashcardCount, setFlashcardCount] = useState(0)
  const [practiceVisible, setPracticeVisible] = useState(false)

  const scrollViewRef = useRef<ScrollView>(null)

  const loadFlashcardCount = useCallback(async (convId: string) => {
    if (!convId || convId.startsWith('local-')) {
      setFlashcardCount(0)
      return
    }
    try {
      const cards = await getLocalFlashcardsForConversation(convId)
      setFlashcardCount(cards.length)
    } catch (err) {
      console.warn('Failed to load flashcard count:', err)
      setFlashcardCount(0)
    }
  }, [])


  // Load and refresh conversation sources
  const loadSources = useCallback(
    async (convId: string) => {
      // 1. Show local cache immediately
      const local = await getSourcesForConversation(convId)
      setSources(local)

      // 2. Refresh from server if online and conversation is synced
      if (convId.startsWith('local-')) return
      try {
        const token = await getAccessToken()
        const res = await fetch(
          `${BACKEND_URL}/modules/${notebook.id}/conversations/${convId}/sources`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return
        const json = await res.json()

        // Upsert resource records returned with sources
        const { upsertLocalResource } = await import('../../db/resources')
        for (const s of json.sources_with_resource ?? []) {
          if (s.resource)
            await upsertLocalResource({
              ...s.resource,
              user_id: s.resource.user_id ?? '',
            })
        }

        // Replace local source list with fresh server data
        const { replaceConversationSources } =
          await import('../../db/conversation-sources')
        await replaceConversationSources(convId, json.sources ?? [])

        const updated = await getSourcesForConversation(convId)
        setSources(updated)
      } catch {
        // offline — local cache is fine
      }
    },
    [notebook.id],
  )

  useEffect(() => {
    loadSources(currentConversationId)
    loadFlashcardCount(currentConversationId)
  }, [currentConversationId, loadSources, loadFlashcardCount])


  const handleAddSource = async (resourceId: string) => {
    if (currentConversationId.startsWith('local-')) return
    setSourcesLoading(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(
        `${BACKEND_URL}/modules/${notebook.id}/conversations/${currentConversationId}/sources`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ resourceId }),
        },
      )
      if (res.ok) {
        const json = await res.json()
        if (json.source) {
          await insertConversationSource({
            id: json.source.id,
            conversation_id: currentConversationId,
            resource_id: resourceId,
            added_at: json.source.added_at,
          })
          if (json.resource) {
            const { upsertLocalResource } = await import('../../db/resources')
            await upsertLocalResource({
              ...json.resource,
              user_id: json.resource.user_id ?? '',
            })
          }
          await loadSources(currentConversationId)
        }
      }
    } catch (err) {
      console.error('Failed to add source:', err)
    } finally {
      setSourcesLoading(false)
    }
  }

  const handleRemoveSource = async (resourceId: string) => {
    if (currentConversationId.startsWith('local-')) return
    // Optimistic local remove
    await removeConversationSource(currentConversationId, resourceId)
    setSources((prev) => prev.filter((s) => s.resource_id !== resourceId))
    try {
      const token = await getAccessToken()
      await fetch(
        `${BACKEND_URL}/modules/${notebook.id}/conversations/${currentConversationId}/sources/${resourceId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
    } catch (err) {
      console.error('Failed to remove source, will re-sync:', err)
      // Re-load to correct state
      await loadSources(currentConversationId)
    }
  }

  // Lets the user pick a PDF from their device, uploads it to the backend
  // (which stores it in Supabase Storage and extracts its text), then
  // attaches the resulting resource to the current conversation.
  const handlePickAndUploadSource = async () => {
    if (currentConversationId.startsWith('local-')) {
      Alert.alert(
        'Hold on',
        'This conversation hasn\u2019t synced yet. Send a message first, then try adding a source.',
      )
      return
    }

    if (isOffline) {
      Alert.alert(
        'You\u2019re offline',
        'Uploading a source needs an internet connection. Try again once you\u2019re back online.',
      )
      return
    }

    let result: DocumentPicker.DocumentPickerResult
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      })
    } catch (err) {
      console.error('Document picker failed:', err)
      return
    }

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return
    }

    const file = result.assets[0]
    setSourcesLoading(true)
    try {
      const token = await getAccessToken()

      const formData = new FormData()
      // React Native's fetch knows how to turn this shape into a multipart
      // file part — don't set Content-Type manually, it needs the boundary
      // that fetch generates itself.
      formData.append('file', {
        uri: file.uri,
        name: file.name ?? 'document',
        type: file.mimeType ?? 'application/pdf',
      } as any)
      // Also send mimeType as a plain field so the backend can branch on
      // PDF vs image handling without having to sniff the buffer itself.
      formData.append('mimeType', file.mimeType ?? 'application/pdf')

      const uploadRes = await fetch(`${BACKEND_URL}/resources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })

      if (!uploadRes.ok) {
        const errBody = await uploadRes.text().catch(() => '')
        throw new Error(`Upload failed (HTTP ${uploadRes.status}): ${errBody}`)
      }

      const uploadJson = await uploadRes.json()
      const resource = uploadJson.resource
      if (!resource) {
        throw new Error('Upload succeeded but no resource was returned')
      }

      const { upsertLocalResource } = await import('../../db/resources')
      await upsertLocalResource({
        ...resource,
        user_id: resource.user_id ?? '',
      })

      // Attach the newly uploaded resource to this conversation
      await handleAddSource(resource.id)
    } catch (err) {
      console.error('Failed to upload source:', err)
      Alert.alert(
        'Upload failed',
        'Could not upload that file. Please check your connection and try again.',
      )
    } finally {
      setSourcesLoading(false)
    }
  }

  useEffect(() => {
    setCurrentConversationId(conversation.id)
  }, [conversation.id])

  // Sync messages from backend if online
  const pullLatestMessages = useCallback(async () => {
    if (isOffline) return
    if (currentConversationId.startsWith('local-')) return
    try {
      const token = await getAccessToken()
      const res = await fetch(
        `${BACKEND_URL}/modules/${notebook.id}/conversations/${currentConversationId}/messages`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      if (res.ok) {
        const json = await res.json()
        if (json.messages && json.messages.length > 0) {
          await insertOrReplaceChats(json.messages)
          const updated = await getLocalChats(currentConversationId)
          setMessages(updated)
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }
      }
    } catch (err) {
      console.warn('Failed to pull fresh chats:', err)
    }
  }, [isOffline, notebook.id, currentConversationId])

  // Load chat messages on mount
  useEffect(() => {
    async function loadChats() {
      const localMsgs = await getLocalChats(currentConversationId)
      setMessages(localMsgs)
      setTimeout(
        () => scrollViewRef.current?.scrollToEnd({ animated: true }),
        100,
      )

      // Pull fresh messages from backend if online
      await pullLatestMessages()
      await loadFlashcardCount(currentConversationId)
    }
    loadChats()

    // Check real connectivity on mount, then listen for changes
    NetInfo.fetch().then((state) => {
      setIsOffline(!state.isConnected)
    })
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!state.isConnected) {
        setIsOffline(true)
      }
    })
    return () => unsubscribe()
  }, [notebook.id, currentConversationId, isOffline, pullLatestMessages, loadFlashcardCount])


  const handleCompileFlashcards = async () => {
    if (currentConversationId.startsWith('local-')) {
      Alert.alert(
        'Hold on',
        'Please send at least one message to sync this conversation before compiling flashcards.',
      )
      return
    }
    if (isOffline) {
      Alert.alert(
        'You\u2019re offline',
        'Compiling flashcards requires an internet connection.',
      )
      return
    }

    setIsCompiling(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(
        `${BACKEND_URL}/modules/${notebook.id}/conversations/${currentConversationId}/flashcards/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      )

      if (!res.ok) {
        const errMsg = await res.text()
        throw new Error(errMsg || 'Failed to compile flashcards')
      }

      const json = await res.json()
      // Now run sync to pull the newly created flashcards from the server!
      const { runSync } = await import('../../db/sync')
      await runSync()

      await loadFlashcardCount(currentConversationId)

      Alert.alert(
        'Success!',
        `Generated ${json.flashcards?.length ?? 0} flashcards from this chat. Would you like to practice them now?`,
        [
          { text: 'Maybe Later', style: 'cancel' },
          { text: 'Practice Now', onPress: () => setPracticeVisible(true) },
        ],
      )
    } catch (err: any) {
      console.error('Error generating flashcards:', err)
      Alert.alert('Error', err.message || 'Could not compile flashcards. Please try again.')
    } finally {
      setIsCompiling(false)
    }
  }


  // Handle send message
  const handleSend = async () => {
    if (!inputText.trim()) return

    const userText = inputText.trim()
    setInputText('')

    const messageId = generateUUID()
    const createdAt = new Date().toISOString()

    // 1. Insert user message locally with synced = 0
    const newUserMsg = await insertLocalChat({
      id: messageId,
      module_id: notebook.id,
      conversation_id: currentConversationId,
      user_id: 'local',
      role: 'user',
      content: userText,
      created_at: createdAt,
      synced: isOffline ? 0 : 1,
    })

    setMessages((prev) => [...prev, newUserMsg])
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50)

    if (isOffline) {
      // SIMULATE LOCAL OFFLINE MODEL RESPONSE
      setIsTyping(true)
      setTimeout(async () => {
        const assistantMsgId = generateUUID()
        const assistantCreatedAt = new Date().toISOString()

        const offlineReply = `You're currently in offline mode, so I can't connect to the AI tutor right now. Your message has been saved and will be answered once you're back online.\n\nTip: Toggle the offline switch in the header to try reconnecting.`

        const assistantMsg = await insertLocalChat({
          id: assistantMsgId,
          module_id: notebook.id,
          conversation_id: currentConversationId,
          user_id: 'local',
          role: 'assistant',
          content: offlineReply,
          created_at: assistantCreatedAt,
          synced: 0,
        })

        setIsTyping(false)
        setMessages((prev) => [...prev, assistantMsg])
        setTimeout(
          () => scrollViewRef.current?.scrollToEnd({ animated: true }),
          100,
        )
      }, 1000)
    } else {
      // CALL REAL BACKEND GROQ AI
      setLoading(true)
      try {
        let activeConvId = currentConversationId

        // If the conversation is still local, sync/create it on Supabase first
        if (activeConvId.startsWith('local-')) {
          const token = await getAccessToken()
          const res = await fetch(
            `${BACKEND_URL}/modules/${notebook.id}/conversations`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ title: conversation.title }),
            },
          )
          if (!res.ok) {
            throw new Error(
              `Failed to pre-sync conversation: HTTP ${res.status}`,
            )
          }

          const json = await res.json()
          await markConversationSynced(activeConvId, json.conversation)
          activeConvId = json.conversation.id
          setCurrentConversationId(activeConvId)
        }

        const token = await getAccessToken()
        const res = await fetch(
          `${BACKEND_URL}/modules/${notebook.id}/conversations/${activeConvId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              messageId,
              content: userText,
            }),
          },
        )

        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`)
        }

        const json = await res.json()

        // Store both user and assistant messages in local SQLite as synced
        await insertLocalChat({
          id: json.userMessage.id,
          module_id: notebook.id,
          conversation_id: activeConvId,
          user_id: json.userMessage.user_id,
          role: 'user',
          content: json.userMessage.content,
          created_at: json.userMessage.created_at,
          synced: 1,
        })
        await insertLocalChat({
          id: json.assistantMessage.id,
          module_id: notebook.id,
          conversation_id: activeConvId,
          user_id: json.assistantMessage.user_id,
          role: 'assistant',
          content: json.assistantMessage.content,
          created_at: json.assistantMessage.created_at,
          synced: 1,
        })

        const updated = await getLocalChats(activeConvId)
        setMessages(updated)
      } catch (err) {
        console.error(
          'Failed to send online message, falling back to local queue:',
          err,
        )
        // Message is left as synced = 0 in local db, sync.ts will sync it later.
      } finally {
        setLoading(false)
        setTimeout(
          () => scrollViewRef.current?.scrollToEnd({ animated: true }),
          100,
        )
      }
    }
  }

  // Format timestamp (e.g., "10:42 AM")
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      let hours = d.getHours()
      const minutes = d.getMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      hours = hours % 12
      hours = hours ? hours : 12 // the hour '0' should be '12'
      const minStr = minutes < 10 ? '0' + minutes : minutes
      return `${hours}:${minStr} ${ampm}`
    } catch {
      return ''
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={D.headerBg} />

      {/* ─── Header ─── */}
      <SafeAreaView
        style={{
          backgroundColor: D.headerBg,
          borderBottomWidth: 1,
          borderBottomColor: D.border,
        }}
        edges={['top']}
      >
        <View style={styles.topBar}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color={D.green} />
            </TouchableOpacity>
            <Ionicons name="school" size={24} color={D.green} />
            <Text
              style={styles.appTitle}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {conversation.title || 'Untitled Chat'}
            </Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.historyBtn}>
              <Ionicons name="time-outline" size={22} color={D.textSecondary} />
            </TouchableOpacity>
            <View style={styles.offlineToggleRow}>
              <Text style={styles.offlineLabel}>Offline</Text>
              <Switch
                value={isOffline}
                onValueChange={setIsOffline}
                trackColor={{ false: '#CBD5E0', true: D.green }}
                thumbColor={Platform.OS === 'ios' ? undefined : '#FFFFFF'}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* ─── Sub-header banner ─── */}
      <View style={styles.banner}>
        <Ionicons
          name={isOffline ? 'shield-checkmark-outline' : 'globe-outline'}
          size={16}
          color="#4A5568"
        />
        <Text style={styles.bannerText}>
          {isOffline
            ? 'Running on Local Model - No Internet Required'
            : 'Connected to Cloud Tutor - Real-time Groq API'}
        </Text>
      </View>

      {/* ─── Active Sources ─── */}
      <View style={styles.sourcesContainer}>
        <View style={styles.sourcesHeader}>
          <Text style={styles.sourcesTitle}>
            Active Sources{sources.length > 0 ? ` (${sources.length})` : ''}
          </Text>
          <TouchableOpacity
            style={styles.addSourceBtn}
            onPress={handlePickAndUploadSource}
            disabled={sourcesLoading}
          >
            <Text style={styles.addSourceText}>+ Add Source</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sourcesScroll}
        >
          {sourcesLoading && (
            <View style={styles.sourceBadgeLoading}>
              <ActivityIndicator size="small" color={D.textSecondary} />
            </View>
          )}

          {!sourcesLoading && sources.length === 0 && (
            <View style={styles.sourceBadgeNone}>
              <Ionicons name="document-outline" size={14} color={D.textMuted} />
              <Text style={styles.sourceTextNone}>No sources attached</Text>
            </View>
          )}

          {sources.map((source) => (
            <TouchableOpacity
              key={source.resource_id}
              style={styles.sourceBadgeActive}
              onLongPress={() => handleRemoveSource(source.resource_id)}
              activeOpacity={0.8}
            >
              <Ionicons name="document-text" size={14} color="#FFFFFF" />
              <Text style={styles.sourceTextActive} numberOfLines={1}>
                {source.resource_title ?? source.resource_id}
              </Text>
              <TouchableOpacity
                onPress={() => handleRemoveSource(source.resource_id)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons
                  name="close-circle"
                  size={14}
                  color="rgba(255,255,255,0.7)"
                />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ─── Chat Scroll ─── */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatScrollContent}
        >
          {messages.map((msg) => {
            const isUser = msg.role === 'user'
            return (
              <View
                key={msg.id}
                style={isUser ? styles.msgRowUser : styles.msgRowAssistant}
              >
                {!isUser && (
                  <View style={styles.avatarContainer}>
                    <View style={styles.avatarCircle}>
                      <Ionicons
                        name="hardware-chip"
                        size={16}
                        color="#FFFFFF"
                      />
                    </View>
                    <Text style={styles.assistantName}>Iskolaro Tutor</Text>
                  </View>
                )}

                <View
                  style={isUser ? styles.bubbleUser : styles.bubbleAssistant}
                >
                  <Text
                    style={
                      isUser
                        ? styles.bubbleTextUser
                        : styles.bubbleTextAssistant
                    }
                  >
                    {msg.content}
                  </Text>
                </View>

                <View
                  style={isUser ? styles.timeRowUser : styles.timeRowAssistant}
                >
                  {msg.synced === 0 && (
                    <Ionicons
                      name="time-outline"
                      size={12}
                      color="#FFA500"
                      style={{ marginRight: 3 }}
                    />
                  )}
                  <Text style={styles.timeText}>
                    {formatTime(msg.created_at)}
                  </Text>
                </View>
              </View>
            )
          })}

          {isTyping && (
            <View style={styles.msgRowAssistant}>
              <View style={styles.avatarContainer}>
                <View style={styles.avatarCircle}>
                  <Ionicons name="hardware-chip" size={16} color="#FFFFFF" />
                </View>
                <Text style={styles.assistantName}>Iskolaro Tutor</Text>
              </View>
              <View style={[styles.bubbleAssistant, styles.typingBubble]}>
                <ActivityIndicator size="small" color={D.green} />
              </View>
            </View>
          )}
        </ScrollView>

        {/* ─── Bottom Input Bar ─── */}
        <View style={styles.inputCard}>
          <TextInput
            style={styles.textInput}
            placeholder="Ask about your documents..."
            placeholderTextColor={D.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <View style={styles.inputActionsRow}>
            <View style={styles.inputActionsLeft}>
              <TouchableOpacity style={styles.actionBtn}>
                <Ionicons
                  name="sparkles-outline"
                  size={18}
                  color={D.textSecondary}
                />
                <Text style={styles.actionBtnText}>Study</Text>
              </TouchableOpacity>
              {messages.some((m) => m.role === 'assistant') && (
                <TouchableOpacity
                  style={[styles.actionBtn, { marginLeft: 12 }]}
                  onPress={handleCompileFlashcards}
                  disabled={isCompiling || isOffline}
                >
                  {isCompiling ? (
                    <ActivityIndicator size="small" color={D.green} />
                  ) : (
                    <>
                      <Ionicons
                        name="albums-outline"
                        size={18}
                        color={isOffline ? D.textMuted : D.green}
                      />
                      <Text
                        style={[
                          styles.actionBtnText,
                          { color: isOffline ? D.textMuted : D.green, marginLeft: 4 },
                        ]}
                      >
                        Compile Cards
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {flashcardCount > 0 && (
                <TouchableOpacity
                  style={[styles.actionBtn, { marginLeft: 12 }]}
                  onPress={() => setPracticeVisible(true)}
                >
                  <Ionicons name="play-circle-outline" size={18} color={D.green} />
                  <Text style={[styles.actionBtnText, { color: D.green, marginLeft: 4 }]}>
                    Practice ({flashcardCount})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              onPress={handleSend}
              style={styles.sendBtn}
              activeOpacity={0.8}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="send" size={16} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ─── Bottom Tab Bar ─── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={onNavigateToLibrary ?? onBack}
        >
          <Ionicons name="library-outline" size={22} color="#94A3B8" />
          <Text style={styles.tabLabel}>Library</Text>
        </TouchableOpacity>

        <View style={styles.tabItem}>
          <Ionicons name="school" size={22} color={D.green} />
          <Text style={[styles.tabLabel, styles.tabLabelActive]}>Study</Text>
        </View>

        <TouchableOpacity style={styles.tabItem}>
          <Ionicons name="game-controller-outline" size={22} color="#94A3B8" />
          <Text style={styles.tabLabel}>Game</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabItem} onPress={onNavigateToSettings}>
          <Ionicons name="settings-outline" size={22} color="#94A3B8" />
          <Text style={styles.tabLabel}>Settings</Text>
        </TouchableOpacity>
      </View>
      <PracticeModal
        visible={practiceVisible}
        conversationId={currentConversationId}
        conversationTitle={conversation.title}
        onClose={() => {
          setPracticeVisible(false)
          loadFlashcardCount(currentConversationId)
        }}
      />
    </View>
  )
}

// ─── Practice Modal Component ──────────────────────────────────────────────
interface PracticeModalProps {
  visible: boolean
  conversationId: string
  conversationTitle: string
  onClose: () => void
}

function PracticeModal({
  visible,
  conversationId,
  conversationTitle,
  onClose,
}: PracticeModalProps) {
  const [flashcards, setFlashcards] = useState<LocalFlashcard[]>([])
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [incorrectCount, setIncorrectCount] = useState(0)
  const [completed, setCompleted] = useState(false)

  const flipAnim = useRef(new Animated.Value(0)).current

  const loadCards = useCallback(async () => {
    if (!conversationId || conversationId.startsWith('local-')) return
    setLoading(true)
    try {
      const cards = await getLocalFlashcardsForConversation(conversationId)
      setFlashcards(cards)
      setCurrentIndex(0)
      setIsFlipped(false)
      setCorrectCount(0)
      setIncorrectCount(0)
      setCompleted(false)
      flipAnim.setValue(0)
    } catch (err) {
      console.error('Failed to load conversation flashcards:', err)
    } finally {
      setLoading(false)
    }
  }, [conversationId, flipAnim])

  useEffect(() => {
    if (visible) {
      loadCards()
    }
  }, [visible, loadCards])

  const handleFlip = () => {
    if (isFlipped) {
      Animated.spring(flipAnim, {
        toValue: 0,
        friction: 8,
        tension: 10,
        useNativeDriver: Platform.OS !== 'web',
      }).start()
    } else {
      Animated.spring(flipAnim, {
        toValue: 180,
        friction: 8,
        tension: 10,
        useNativeDriver: Platform.OS !== 'web',
      }).start()
    }
    setIsFlipped(!isFlipped)
  }

  const handleAnswer = async (wasCorrect: boolean) => {
    const currentCard = flashcards[currentIndex]
    if (!currentCard) return

    if (wasCorrect) {
      setCorrectCount((prev) => prev + 1)
    } else {
      setIncorrectCount((prev) => prev + 1)
    }

    try {
      await upsertLocalFlashcardProgress({
        flashcardId: currentCard.id,
        wasCorrect,
      })
      const { runSync } = await import('../../db/sync')
      runSync().catch((err: any) => console.error('Sync progress error:', err))
    } catch (err) {
      console.error('Failed to save flashcard progress:', err)
    }

    if (currentIndex + 1 < flashcards.length) {
      if (isFlipped) {
        Animated.timing(flipAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: Platform.OS !== 'web',
        }).start(() => {
          setIsFlipped(false)
          setCurrentIndex((prev) => prev + 1)
        })
      } else {
        setCurrentIndex((prev) => prev + 1)
      }
    } else {
      setCompleted(true)
    }
  }

  const handleRestart = () => {
    setCurrentIndex(0)
    setIsFlipped(false)
    setCorrectCount(0)
    setIncorrectCount(0)
    setCompleted(false)
    flipAnim.setValue(0)
  }

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.modalLoadingState}>
          <ActivityIndicator color={D.green} size="large" />
        </View>
      )
    }

    if (flashcards.length === 0) {
      return (
        <View style={styles.modalEmptyStateContainer}>
          <View style={styles.modalEmptyStateIconCircle}>
            <Ionicons name="albums-outline" size={32} color={D.textSecondary} />
          </View>
          <Text style={styles.modalEmptyStateTitle}>No Flashcards yet</Text>
          <Text style={styles.modalEmptyStateDescription}>
            Compile cards from your conversation with the AI tutor first to practice here.
          </Text>
          <TouchableOpacity style={styles.modalBtnCloseFull} onPress={onClose}>
            <Text style={styles.modalBtnCloseFullText}>Close</Text>
          </TouchableOpacity>
        </View>
      )
    }

    if (completed) {
      const total = flashcards.length
      const accuracy = Math.round((correctCount / total) * 100)

      return (
        <View style={styles.modalCompletedContainer}>
          <View style={styles.modalCelebrationCircle}>
            <Ionicons name="trophy" size={44} color="#EAB308" />
          </View>
          <Text style={styles.modalCompletedTitle}>Round Complete!</Text>
          <Text style={styles.modalCompletedSubtitle}>
            You've reviewed all compiled flashcards for this chat.
          </Text>

          <View style={styles.modalStatsGrid}>
            <View style={styles.modalStatBox}>
              <Text style={styles.modalStatValue}>{total}</Text>
              <Text style={styles.modalStatLabel}>Reviewed</Text>
            </View>
            <View style={styles.modalStatBox}>
              <Text style={[styles.modalStatValue, { color: accuracy >= 70 ? D.green : '#E11D48' }]}>
                {accuracy}%
              </Text>
              <Text style={styles.modalStatLabel}>Accuracy</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 8 }}>
            <TouchableOpacity style={[styles.modalBtnPrimary, { flex: 1 }]} onPress={handleRestart}>
              <Text style={styles.modalBtnPrimaryText}>Practice Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalBtnPrimary,
                { flex: 1, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
              ]}
              onPress={onClose}
            >
              <Text style={[styles.modalBtnPrimaryText, { color: D.textSecondary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )
    }

    const currentCard = flashcards[currentIndex]
    const total = flashcards.length

    const frontInterpolate = flipAnim.interpolate({
      inputRange: [0, 180],
      outputRange: ['0deg', '180deg'],
    })
    const backInterpolate = flipAnim.interpolate({
      inputRange: [0, 180],
      outputRange: ['180deg', '360deg'],
    })

    const frontAnimatedStyle = {
      transform: [{ rotateY: frontInterpolate }],
    }
    const backAnimatedStyle = {
      transform: [{ rotateY: backInterpolate }],
    }

    return (
      <View style={styles.modalGameWrapper}>
        <View style={styles.modalProgressHeader}>
          <View style={styles.modalProgressTextRow}>
            <Text style={styles.modalProgressCount}>
              Card {currentIndex + 1} of {total}
            </Text>
          </View>
          <View style={styles.modalProgressBarBg}>
            <View
              style={[
                styles.modalProgressBarFill,
                { width: `${((currentIndex + 1) / total) * 100}%` },
              ]}
            />
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.95}
          onPress={handleFlip}
          style={styles.modalCardTouchArea}
        >
          <View style={styles.modalCardContainer}>
            <Animated.View
              style={[
                styles.modalFlashcard,
                frontAnimatedStyle,
                isFlipped ? { opacity: 0 } : { opacity: 1 },
              ]}
            >
              <View style={styles.modalCardHeader}>
                <Text style={styles.modalCardSideLabel}>QUESTION</Text>
                <Ionicons name="help-circle-outline" size={20} color={D.green} />
              </View>
              <ScrollView
                contentContainerStyle={styles.modalCardTextScroll}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.modalCardTextFront}>{currentCard.front}</Text>
              </ScrollView>
              <Text style={styles.modalCardActionHint}>Tap card to reveal answer</Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.modalFlashcard,
                styles.modalFlashcardBack,
                backAnimatedStyle,
                isFlipped ? { opacity: 1 } : { opacity: 0 },
              ]}
            >
              <View style={styles.modalCardHeader}>
                <Text style={[styles.modalCardSideLabel, { color: '#EAB308' }]}>ANSWER</Text>
                <Ionicons name="bulb-outline" size={20} color="#EAB308" />
              </View>
              <ScrollView
                contentContainerStyle={styles.modalCardTextScroll}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.modalCardTextBack}>{currentCard.back}</Text>
              </ScrollView>
              <Text style={styles.modalCardActionHint}>Tap card to show question</Text>
            </Animated.View>
          </View>
        </TouchableOpacity>

        <View style={styles.modalControlsRow}>
          <TouchableOpacity
            style={[styles.modalBtnAnswer, styles.modalBtnIncorrect]}
            onPress={() => handleAnswer(false)}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle-outline" size={20} color="#E11D48" />
            <Text style={styles.modalBtnIncorrectText}>Review</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modalBtnAnswer, styles.modalBtnCorrect]}
            onPress={() => handleAnswer(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={D.green} />
            <Text style={styles.modalBtnCorrectText}>Got It!</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalFullscreenOverlay}>
        <View style={styles.modalPracticeContainer}>
          {/* Header */}
          <View style={styles.modalPracticeHeader}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.modalPracticeTitle}>Practice Session</Text>
              <Text style={styles.modalPracticeSubtitle} numberOfLines={1}>
                {conversationTitle}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalPracticeCloseBtn}>
              <Ionicons name="close" size={24} color={D.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.modalPracticeContent}>{renderContent()}</View>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: D.pageBg,
  },
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: D.headerBg,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  backButton: {
    marginRight: 2,
    padding: 2,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: D.green,
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyBtn: {
    padding: 4,
  },
  offlineToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  offlineLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: D.textSecondary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0F2F5',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: D.border,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: D.textSecondary,
  },
  sourcesContainer: {
    backgroundColor: D.headerBg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: D.border,
  },
  sourcesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  sourcesTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: D.textSecondary,
  },
  addSourceBtn: {
    alignSelf: 'flex-start',
  },
  addSourceText: {
    fontSize: 12,
    fontWeight: '600',
    color: D.green,
  },
  sourcesScroll: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceBadgeActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: D.green,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 220,
  },
  sourceTextActive: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  sourceBadgeInactive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDF2F7',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 200,
  },
  sourceTextInactive: {
    fontSize: 12,
    fontWeight: '600',
    color: D.textSecondary,
  },
  sourceBadgeLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EDF2F7',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sourceBadgeNone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F7F7F7',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: D.border,
    borderStyle: 'dashed',
  },
  sourceTextNone: {
    fontSize: 12,
    fontWeight: '500',
    color: D.textMuted,
  },
  chatScroll: {
    flex: 1,
  },
  chatScrollContent: {
    padding: 16,
    gap: 16,
  },
  msgRowUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    maxWidth: '85%',
  },
  msgRowAssistant: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
    maxWidth: '85%',
  },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  avatarCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: D.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantName: {
    fontSize: 13,
    fontWeight: '700',
    color: D.green,
  },
  bubbleUser: {
    backgroundColor: D.bubbleBgUser,
    borderWidth: 1,
    borderColor: D.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: { elevation: 1 },
    }),
  },
  bubbleAssistant: {
    backgroundColor: D.bubbleBgAssistant,
    borderLeftWidth: 4,
    borderLeftColor: D.green,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bubbleTextUser: {
    fontSize: 14,
    lineHeight: 20,
    color: D.textPrimary,
  },
  bubbleTextAssistant: {
    fontSize: 14,
    lineHeight: 21,
    color: D.textPrimary,
  },
  typingBubble: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRowUser: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeRowAssistant: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  timeText: {
    fontSize: 10,
    color: D.textMuted,
  },
  inputCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: D.border,
    borderRadius: 12,
    margin: 16,
    padding: 12,
    gap: 10,
  },
  textInput: {
    fontSize: 14,
    color: D.textPrimary,
    maxHeight: 100,
    minHeight: 40,
    padding: 0,
    textAlignVertical: 'top',
    ...Platform.select({ web: { outlineStyle: 'none' as any } }),
  },
  inputActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputActionsLeft: {
    flexDirection: 'row',
    gap: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: D.textSecondary,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: D.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: D.border,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
    height: Platform.OS === 'ios' ? 76 : 64,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
  },
  tabLabelActive: {
    color: D.green,
    fontWeight: '700',
  },
  // Modal styles for practice game
  modalFullscreenOverlay: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  modalPracticeContainer: {
    flex: 1,
  },
  modalPracticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: D.border,
    backgroundColor: '#FFFFFF',
  },
  modalPracticeTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: D.textPrimary,
  },
  modalPracticeSubtitle: {
    fontSize: 12,
    color: D.textSecondary,
    marginTop: 2,
  },
  modalPracticeCloseBtn: {
    padding: 4,
  },
  modalPracticeContent: {
    flex: 1,
    padding: 16,
  },
  modalLoadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEmptyStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.border,
    gap: 16,
    marginVertical: 40,
  },
  modalEmptyStateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F4F5F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEmptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: D.textPrimary,
  },
  modalEmptyStateDescription: {
    fontSize: 14,
    color: D.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalBtnCloseFull: {
    backgroundColor: D.green,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 12,
  },
  modalBtnCloseFullText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  modalCompletedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.border,
    gap: 16,
    paddingVertical: 40,
  },
  modalCelebrationCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF9C3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FDE047',
  },
  modalCompletedTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: D.textPrimary,
  },
  modalCompletedSubtitle: {
    fontSize: 14,
    color: D.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalStatsGrid: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 8,
  },
  modalStatBox: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: D.textPrimary,
    marginBottom: 2,
  },
  modalStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: D.textMuted,
  },
  modalBtnPrimary: {
    backgroundColor: D.green,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: D.green,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  modalBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  modalGameWrapper: {
    flex: 1,
    paddingTop: 8,
    gap: 16,
  },
  modalProgressHeader: {
    gap: 8,
  },
  modalProgressTextRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalProgressCount: {
    fontSize: 13,
    fontWeight: '600',
    color: D.textSecondary,
  },
  modalProgressBarBg: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  modalProgressBarFill: {
    height: '100%',
    backgroundColor: D.green,
    borderRadius: 4,
  },
  modalCardTouchArea: {
    flex: 1,
    minHeight: 280,
    marginVertical: 12,
  },
  modalCardContainer: {
    width: '100%',
    height: '100%',
  },
  modalFlashcard: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.border,
    padding: 20,
    backfaceVisibility: 'hidden',
    justifyContent: 'space-between',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
      web: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
    }),
  },
  modalFlashcardBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderColor: '#FEF08A',
  },
  modalCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: D.border,
    paddingBottom: 8,
    marginBottom: 12,
  },
  modalCardSideLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: D.green,
    letterSpacing: 1,
  },
  modalCardTextScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCardTextFront: {
    fontSize: 18,
    fontWeight: '700',
    color: D.textPrimary,
    textAlign: 'center',
    lineHeight: 26,
  },
  modalCardTextBack: {
    fontSize: 16,
    fontWeight: '500',
    color: D.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  modalCardActionHint: {
    fontSize: 12,
    color: D.textMuted,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
  modalControlsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? 10 : 0,
  },
  modalBtnAnswer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalBtnIncorrect: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  modalBtnIncorrectText: {
    color: '#E11D48',
    fontWeight: '700',
    fontSize: 15,
  },
  modalBtnCorrect: {
    backgroundColor: '#F0FDF4',
    borderColor: '#DCFCE7',
  },
  modalBtnCorrectText: {
    color: D.green,
    fontWeight: '700',
    fontSize: 15,
  },
})

