import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  Animated,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import {
  getLocalConversations,
  insertLocalConversation,
  markConversationSynced,
  type ConversationWithPreview,
} from '../../db/conversations'
import { getLocalFlashcards, upsertLocalFlashcardProgress, type LocalFlashcard } from '../../db/flashcards'
import { getLocalQuestions, type LocalQuestion } from '../../db/questions'
import { getLocalModuleProgress, upsertLocalModuleProgress } from '../../db/module-progress'
import { getAccessToken } from '../../db/auth-storage'
import { runSync } from '../../db/sync'
import { BACKEND_URL } from '../lib/api'

// ─── Design Tokens ───────────────────────────────────────────────────────────
// Matches library-screen.tsx so the two screens feel like one app.

const D = {
  pageBg: '#F2F4EF',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  tabBarBg: '#FFFFFF',
  green: '#5A8A1F',
  greenAdd: '#5A8A1F',
  textPrimary: '#1A1A1A',
  textSecondary: '#666666',
  textMuted: '#9CA3AF',
  textTabActive: '#5A8A1F',
  textTabInactive: '#94a3b8',
  cardBorder: '#E8E8E8',
  dashedBorder: '#CCCCCC',
  accentBar: '#6B9E1E',
  divider: '#EEEEEE',
  tabDivider: '#E2E8F0',
  overlay: 'rgba(0,0,0,0.45)',
  pagePadH: 16,
  cardRadius: 8,
} as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotebookSummary {
  id: string
  name: string
}

type DetailTab = 'Chats' | 'Quizzes' | 'Flashcards'

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
  const tabs: DetailTab[] = ['Chats', 'Quizzes', 'Flashcards']
  return (
    <View style={styles.detailTabBar}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab}
          style={styles.detailTab}
          onPress={() => onChange(tab)}
          activeOpacity={0.7}
        >
          {/* Label + text-width underline sit inside a self-sizing column */}
          <View style={styles.detailTabInner}>
            <Text
              style={[
                styles.detailTabLabel,
                active === tab && styles.detailTabLabelActive,
              ]}
            >
              {tab}
            </Text>
            {active === tab && <View style={styles.detailTabUnderline} />}
          </View>
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

interface FlashcardGameSectionProps {
  moduleId: string
  conversations: ConversationWithPreview[]
}

function FlashcardGameSection({ moduleId, conversations }: FlashcardGameSectionProps) {
  const [flashcards, setFlashcards] = useState<LocalFlashcard[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [compilingId, setCompilingId] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [incorrectCount, setIncorrectCount] = useState(0)
  const [completed, setCompleted] = useState(false)

  const flipAnim = useRef(new Animated.Value(0)).current

  const loadCards = useCallback(async () => {
    setLoading(true)
    try {
      const cards = await getLocalFlashcards(moduleId)
      setFlashcards(cards)
      setCurrentIndex(0)
      setIsFlipped(false)
      setCorrectCount(0)
      setIncorrectCount(0)
      setCompleted(false)
      flipAnim.setValue(0)
    } catch (err) {
      console.error('Failed to load flashcards:', err)
    } finally {
      setLoading(false)
    }
  }, [moduleId])

  useEffect(() => {
    loadCards()
  }, [loadCards])

  // Compile flashcards for a specific conversation directly from selection screen
  const handleCompileConversation = async (convId: string) => {
    if (convId.startsWith('local-')) {
      Alert.alert(
        'Hold on',
        'Please wait for this conversation to sync with the server before compiling flashcards.',
      )
      return
    }
    setCompilingId(convId)
    try {
      const token = await getAccessToken()
      const res = await fetch(
        `${BACKEND_URL}/modules/${moduleId}/conversations/${convId}/flashcards/generate`,
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
      // Run sync to pull the newly created flashcards from the server!
      const { runSync } = await import('../../db/sync')
      await runSync()
      
      // Reload flashcards from local SQLite database
      const cards = await getLocalFlashcards(moduleId)
      setFlashcards(cards)

      Alert.alert(
        'Success!',
        `Generated ${json.flashcards?.length ?? 0} flashcards for this conversation.`,
      )
    } catch (err: any) {
      console.error('Error compiling flashcards:', err)
      Alert.alert('Error', err.message || 'Could not compile flashcards. Please try again.')
    } finally {
      setCompilingId(null)
    }
  }

  const handleResetDeckPress = (convId: string) => {
    Alert.alert(
      'Reset Flashcards',
      'Choose how you would like to reset this conversation\'s deck:',
      [
        {
          text: 'Reset Study Progress Only',
          onPress: async () => {
            try {
              const { resetFlashcardProgressForConversation } = await import('../../db/flashcards')
              await resetFlashcardProgressForConversation(convId)
              Alert.alert('Reset Complete', 'Your study progress has been reset for this deck.')
              await loadCards()
            } catch (err) {
              console.error('Failed to reset flashcard progress:', err)
              Alert.alert('Error', 'Could not reset progress. Please try again.')
            }
          }
        },
        {
          text: 'Delete Compiled Cards',
          style: 'destructive',
          onPress: async () => {
            try {
              const { clearFlashcardsForConversation } = await import('../../db/flashcards')
              await clearFlashcardsForConversation(convId)
              Alert.alert('Deleted', 'All compiled flashcards for this deck have been deleted.')
              await loadCards()
            } catch (err) {
              console.error('Failed to clear flashcards:', err)
              Alert.alert('Error', 'Could not delete flashcards. Please try again.')
            }
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    )
  }

  // Filter cards to play based on selection
  const activeDeck = React.useMemo(() => {
    if (selectedConversationId === 'legacy') {
      return flashcards.filter((fc) => !fc.conversation_id)
    }
    if (selectedConversationId) {
      return flashcards.filter((fc) => fc.conversation_id === selectedConversationId)
    }
    return []
  }, [flashcards, selectedConversationId])

  // Grouping helpers
  const conversationsWithCards = React.useMemo(() => {
    return conversations.filter((conv) =>
      flashcards.some((fc) => fc.conversation_id === conv.id)
    )
  }, [conversations, flashcards])


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
    const currentCard = activeDeck[currentIndex]
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
      runSync().catch((err) => console.error('Sync progress error:', err))
    } catch (err) {
      console.error('Failed to save flashcard progress:', err)
    }

    if (currentIndex + 1 < activeDeck.length) {
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

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={D.green} />
      </View>
    )
  }

  // 1. Selection Screen (User chooses which deck/conversation's cards to practice, or compiles them)
  if (selectedConversationId === null) {
    return (
      <View style={styles.selectionContainer}>
        <Text style={styles.selectionTitle}>Choose a Deck to Practice</Text>
        <Text style={styles.selectionSubtitle}>
          Generate or practice flashcards directly from any past conversation. Each conversation's flashcards are kept completely separate.
        </Text>

        <ScrollView style={styles.selectionScroll} showsVerticalScrollIndicator={false}>
          {conversations.map((conv) => {
            const conversationCards = flashcards.filter((fc) => fc.conversation_id === conv.id)
            const count = conversationCards.length
            const isCompiling = compilingId === conv.id
            const hasMessages = conv.message_count > 0 || !!conv.last_message

            // Calculate if there are new prompts since last flashcard compile
            const latestCardTime = conversationCards.reduce((max, fc) => {
              if (!fc.created_at) return max
              return fc.created_at > max ? fc.created_at : max
            }, '')
            const hasNewPrompts = conv.last_message_at && latestCardTime ? conv.last_message_at > latestCardTime : false

            return (
              <View key={conv.id} style={styles.selectionCard}>
                <View style={styles.selectionCardTop}>
                  <View style={styles.selectionCardContent}>
                    <Ionicons
                      name={count > 0 ? "albums" : "chatbubbles-outline"}
                      size={22}
                      color={count > 0 ? D.green : D.textTabInactive}
                    />
                    <View style={styles.selectionCardText}>
                      <Text style={styles.selectionCardTitle} numberOfLines={1}>{conv.title}</Text>
                      <Text style={styles.selectionCardMeta}>
                        {count > 0
                          ? `${count} flashcards compiled${hasNewPrompts ? ' • New content!' : ''}`
                          : hasMessages
                          ? 'Not compiled yet'
                          : 'No messages yet'}
                      </Text>
                    </View>
                  </View>

                  {count === 0 && (
                    <View style={styles.selectionCardActions}>
                      {isCompiling ? (
                        <ActivityIndicator size="small" color={D.green} />
                      ) : hasMessages ? (
                        <TouchableOpacity
                          style={styles.compileBtn}
                          onPress={() => handleCompileConversation(conv.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.compileBtnText}>Compile</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.disabledText}>Empty</Text>
                      )}
                    </View>
                  )}
                </View>

                {count > 0 && (
                  <View style={styles.selectionCardBottomActions}>
                    {isCompiling ? (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
                        <ActivityIndicator size="small" color={D.green} />
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.practiceBtnDeck}
                          onPress={() => setSelectedConversationId(conv.id)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="play" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                          <Text style={styles.practiceBtnTextDeck}>Practice</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.recompileBtnDeck,
                            hasNewPrompts ? styles.recompileBtnDeckActive : null
                          ]}
                          onPress={() => handleCompileConversation(conv.id)}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name="sync"
                            size={14}
                            color={hasNewPrompts ? '#FFFFFF' : D.textSecondary}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={[
                              styles.recompileBtnTextDeck,
                              { color: hasNewPrompts ? '#FFFFFF' : D.textSecondary }
                            ]}
                          >
                            {hasNewPrompts ? 'Compile New' : 'Compile Again'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.resetBtnDeck}
                          onPress={() => handleResetDeckPress(conv.id)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            )
          })}
        </ScrollView>
      </View>
    )
  }

  // 2. Completed State Screen
  if (completed) {
    const total = activeDeck.length
    const accuracy = Math.round((correctCount / total) * 100)

    return (
      <View style={styles.completedContainer}>
        <View style={styles.celebrationCircle}>
          <Ionicons name="trophy" size={44} color="#EAB308" />
        </View>
        <Text style={styles.completedTitle}>Round Complete!</Text>
        <Text style={styles.completedSubtitle}>
          You've reviewed all selected flashcards.
        </Text>

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{total}</Text>
            <Text style={styles.statLabel}>Reviewed</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: accuracy >= 70 ? D.green : '#E11D48' }]}>
              {accuracy}%
            </Text>
            <Text style={styles.statLabel}>Accuracy</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 8 }}>
          <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={handleRestart}>
            <Text style={styles.btnPrimaryText}>Practice Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, { flex: 1, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }]}
            onPress={() => {
              handleRestart()
              setSelectedConversationId(null)
            }}
          >
            <Text style={[styles.btnPrimaryText, { color: D.textSecondary }]}>Change Deck</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const currentCard = activeDeck[currentIndex]
  const total = activeDeck.length

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
    <View style={styles.gameWrapper}>
      <View style={styles.progressHeader}>
        <View style={styles.progressTextRow}>
          <TouchableOpacity
            style={styles.backToDecksBtn}
            onPress={() => setSelectedConversationId(null)}
          >
            <Ionicons name="chevron-back" size={14} color={D.textSecondary} />
            <Text style={styles.backToDecksText}>Decks</Text>
          </TouchableOpacity>
          <Text style={styles.progressCount}>
            Card {currentIndex + 1} of {total}
          </Text>
        </View>
        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${((currentIndex + 1) / total) * 100}%` },
            ]}
          />
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={0.95}
        onPress={handleFlip}
        style={styles.cardTouchArea}
      >
        <View style={styles.cardContainer}>
          <Animated.View
            style={[
              styles.flashcard,
              frontAnimatedStyle,
              isFlipped ? { opacity: 0 } : { opacity: 1 },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardSideLabel}>QUESTION</Text>
              <Ionicons name="help-circle-outline" size={20} color={D.green} />
            </View>
            <ScrollView
              contentContainerStyle={styles.cardTextScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.cardTextFront}>{currentCard.front}</Text>
            </ScrollView>
            <Text style={styles.cardActionHint}>Tap card to reveal answer</Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.flashcard,
              styles.flashcardBack,
              backAnimatedStyle,
              isFlipped ? { opacity: 1 } : { opacity: 0 },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.cardSideLabel, { color: '#EAB308' }]}>ANSWER</Text>
              <Ionicons name="bulb-outline" size={20} color="#EAB308" />
            </View>
            <ScrollView
              contentContainerStyle={styles.cardTextScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.cardTextBack}>{currentCard.back}</Text>
            </ScrollView>
            <Text style={styles.cardActionHint}>Tap card to show question</Text>
          </Animated.View>
        </View>
      </TouchableOpacity>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.btnAnswer, styles.btnIncorrect]}
          onPress={() => handleAnswer(false)}
          activeOpacity={0.8}
        >
          <Ionicons name="close-circle-outline" size={20} color="#E11D48" />
          <Text style={styles.btnIncorrectText}>Review</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnAnswer, styles.btnCorrect]}
          onPress={() => handleAnswer(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color={D.green} />
          <Text style={styles.btnCorrectText}>Got It!</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

interface QuizGameSectionProps {
  moduleId: string
  conversations: ConversationWithPreview[]
}

function QuizGameSection({ moduleId, conversations }: QuizGameSectionProps) {
  const [questions, setQuestions] = useState<LocalQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false)
  const [score, setScore] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [moduleProgress, setModuleProgress] = useState<any>(null)

  const loadProgressAndQuiz = useCallback(async () => {
    setLoading(true)
    try {
      const prog = await getLocalModuleProgress(moduleId)
      setModuleProgress(prog)
      const allQuestions = await getLocalQuestions(moduleId)
      setQuestions(allQuestions)
    } catch (err) {
      console.error('Failed to load quiz progress/questions:', err)
    } finally {
      setLoading(false)
    }
  }, [moduleId])

  useEffect(() => {
    loadProgressAndQuiz()
  }, [loadProgressAndQuiz])

  const activeQuestions = React.useMemo(() => {
    return questions.filter((q) => q.difficulty === selectedDifficulty)
  }, [questions, selectedDifficulty])

  const handleGenerateQuiz = async () => {
    setGenerating(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(
        `${BACKEND_URL}/modules/${moduleId}/questions/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ difficulty: selectedDifficulty }),
        },
      )

      if (!res.ok) {
        const errMsg = await res.text()
        throw new Error(errMsg || 'Failed to generate quiz')
      }

      const json = await res.json()
      // Run sync to pull the newly created questions from the server!
      const { runSync } = await import('../../db/sync')
      await runSync()

      // Reload questions and progress from local database
      await loadProgressAndQuiz()

      Alert.alert(
        'Success!',
        `Generated ${json.questions?.length ?? 0} questions for this difficulty level. Ready to test?`,
      )
    } catch (err: any) {
      console.error('Error generating quiz:', err)
      Alert.alert('Error', err.message || 'Could not generate quiz. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const handleStartQuiz = () => {
    if (activeQuestions.length === 0) return
    setCurrentIndex(0)
    setSelectedAnswer(null)
    setIsAnswerSubmitted(false)
    setScore(0)
    setCompleted(false)
    setIsPlaying(true)
  }

  const handleOptionPress = (option: string) => {
    if (isAnswerSubmitted) return
    setSelectedAnswer(option)
  }

  const handleSubmitAnswer = () => {
    if (!selectedAnswer || isAnswerSubmitted) return
    setIsAnswerSubmitted(true)
    const currentQ = activeQuestions[currentIndex]
    if (selectedAnswer === currentQ.correct_answer) {
      setScore((prev) => prev + 1)
    }
  }

  const handleNext = async () => {
    if (currentIndex + 1 < activeQuestions.length) {
      setCurrentIndex((prev) => prev + 1)
      setSelectedAnswer(null)
      setIsAnswerSubmitted(false)
    } else {
      // Completed! Save progress
      setIsPlaying(false)
      setCompleted(true)
      
      const finalScore = score + (selectedAnswer === activeQuestions[currentIndex].correct_answer ? 1 : 0)
      const masteryScore = finalScore / activeQuestions.length
      
      try {
        const { progress, justCompleted } = await upsertLocalModuleProgress({
          moduleId,
          masteryScore,
        })
        setModuleProgress(progress)
        
        if (justCompleted) {
          Alert.alert(
            'Incredible!',
            'You have mastered this module! +50 XP Awarded (will sync to profile).',
          )
        }
      } catch (err) {
        console.error('Failed to save quiz progress:', err)
      }
    }
  }

  const handleRestart = () => {
    setCurrentIndex(0)
    setSelectedAnswer(null)
    setIsAnswerSubmitted(false)
    setScore(0)
    setCompleted(false)
    setIsPlaying(true)
  }

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={D.green} />
      </View>
    )
  }

  if (generating) {
    return (
      <View style={styles.completedContainer}>
        <ActivityIndicator size="large" color={D.green} style={{ marginBottom: 16 }} />
        <Text style={styles.completedTitle}>Generating Quiz...</Text>
        <Text style={styles.completedSubtitle}>
          AI is reading your notebook resource texts to design 5 multiple-choice questions. This will take a few moments.
        </Text>
      </View>
    )
  }

  if (completed) {
    const total = activeQuestions.length
    const finalScore = score
    const accuracy = Math.round((finalScore / total) * 100)

    return (
      <View style={styles.completedContainer}>
        <View style={styles.celebrationCircle}>
          <Ionicons name="trophy" size={44} color="#EAB308" />
        </View>
        <Text style={styles.completedTitle}>Quiz Finished!</Text>
        <Text style={styles.completedSubtitle}>
          Difficulty: {selectedDifficulty.toUpperCase()}
        </Text>

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{finalScore} / {total}</Text>
            <Text style={styles.statLabel}>Score</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: accuracy >= 80 ? D.green : '#E11D48' }]}>
              {accuracy}%
            </Text>
            <Text style={styles.statLabel}>Accuracy</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 8 }}>
          <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={handleRestart}>
            <Text style={styles.btnPrimaryText}>Retake Quiz</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, { flex: 1, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' }]}
            onPress={() => {
              setCompleted(false)
              setIsPlaying(false)
            }}
          >
            <Text style={[styles.btnPrimaryText, { color: D.textSecondary }]}>Difficulty Select</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (isPlaying) {
    const currentQ = activeQuestions[currentIndex]
    const total = activeQuestions.length
    let parsedChoices: string[] = []
    try {
      if (currentQ.choices) {
        parsedChoices = typeof currentQ.choices === 'string' ? JSON.parse(currentQ.choices) : currentQ.choices
      }
    } catch (e) {
      console.error('Failed to parse options choices:', e)
    }

    return (
      <View style={styles.gameWrapper}>
        <View style={styles.progressHeader}>
          <View style={styles.progressTextRow}>
            <TouchableOpacity
              style={styles.backToDecksBtn}
              onPress={() => setIsPlaying(false)}
            >
              <Ionicons name="chevron-back" size={14} color={D.textSecondary} />
              <Text style={styles.backToDecksText}>Exit Quiz</Text>
            </TouchableOpacity>
            <Text style={styles.progressCount}>
              Question {currentIndex + 1} of {total}
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${((currentIndex + 1) / total) * 100}%` },
              ]}
            />
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
          <View style={styles.quizQuestionCard}>
            <Text style={styles.quizQuestionText}>{currentQ.question_text}</Text>
          </View>

          <View style={styles.quizChoicesContainer}>
            {parsedChoices.map((choice, i) => {
              const isSelected = selectedAnswer === choice
              const isCorrect = choice === currentQ.correct_answer
              
              let choiceStyle: any[] = [styles.quizChoiceCard]
              let choiceTextStyle: any[] = [styles.quizChoiceText]
              let rightIcon = null

              if (isAnswerSubmitted) {
                if (isCorrect) {
                  choiceStyle.push(styles.quizChoiceCardCorrect)
                  choiceTextStyle.push(styles.quizChoiceTextCorrect)
                  rightIcon = <Ionicons name="checkmark-circle" size={18} color="#15803D" />
                } else if (isSelected) {
                  choiceStyle.push(styles.quizChoiceCardIncorrect)
                  choiceTextStyle.push(styles.quizChoiceTextIncorrect)
                  rightIcon = <Ionicons name="close-circle" size={18} color="#B91C1C" />
                } else {
                  choiceStyle.push(styles.quizChoiceCardDisabled)
                }
              } else if (isSelected) {
                choiceStyle.push(styles.quizChoiceCardSelected)
                choiceTextStyle.push(styles.quizChoiceTextSelected)
              }

              return (
                <TouchableOpacity
                  key={i}
                  style={choiceStyle}
                  onPress={() => handleOptionPress(choice)}
                  activeOpacity={0.8}
                  disabled={isAnswerSubmitted}
                >
                  <Text style={choiceTextStyle}>{choice}</Text>
                  {rightIcon}
                </TouchableOpacity>
              )
            })}
          </View>
        </ScrollView>

        <View style={styles.quizActionsRow}>
          {!isAnswerSubmitted ? (
            <TouchableOpacity
              style={[styles.btnPrimary, !selectedAnswer ? styles.btnPrimaryDisabled : null]}
              onPress={handleSubmitAnswer}
              disabled={!selectedAnswer}
            >
              <Text style={styles.btnPrimaryText}>Submit Answer</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={handleNext}
            >
              <Text style={styles.btnPrimaryText}>
                {currentIndex + 1 === total ? 'Finish Quiz' : 'Next Question'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  // Selection view (difficulty selectors & details)
  const count = activeQuestions.length

  return (
    <View style={styles.selectionContainer}>
      <Text style={styles.selectionTitle}>Choose Quiz Difficulty</Text>
      <Text style={styles.selectionSubtitle}>
        AI will generate multiple choice questions tailored to your current notebook documents.
      </Text>

      <View style={styles.difficultySelectionRow}>
        {(['easy', 'medium', 'hard'] as const).map((diff) => {
          const isSelected = selectedDifficulty === diff
          const btnStyle: any[] = [
            styles.difficultyBtn,
            isSelected && styles.difficultyBtnSelected,
            isSelected && diff === 'easy' && { borderColor: D.green, backgroundColor: '#ECFDF5' },
            isSelected && diff === 'medium' && { borderColor: '#EAB308', backgroundColor: '#FEF9C3' },
            isSelected && diff === 'hard' && { borderColor: '#EF4444', backgroundColor: '#FEE2E2' },
          ]
          const labelStyle: any[] = [
            styles.difficultyLabel,
            isSelected && { fontWeight: 'bold' as const },
            isSelected && diff === 'easy' && { color: D.green },
            isSelected && diff === 'medium' && { color: '#A16207' },
            isSelected && diff === 'hard' && { color: '#B91C1C' },
          ]

          return (
            <TouchableOpacity
              key={diff}
              style={btnStyle}
              onPress={() => setSelectedDifficulty(diff)}
              activeOpacity={0.7}
            >
              <Text style={labelStyle}>{diff.toUpperCase()}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={styles.difficultyDescriptionBox}>
        {selectedDifficulty === 'easy' && (
          <>
            <Text style={styles.diffDescTitle}>🟢 Easy Level</Text>
            <Text style={styles.diffDescText}>
              Simple factual recall, core definitions, and basic terminology based directly on the module notes. Recommended for getting started.
            </Text>
          </>
        )}
        {selectedDifficulty === 'medium' && (
          <>
            <Text style={styles.diffDescTitle}>🟡 Medium Level</Text>
            <Text style={styles.diffDescText}>
              Conceptual understanding, comparing ideas, and basic application logic. Test if you understand *how* concepts tie together.
            </Text>
          </>
        )}
        {selectedDifficulty === 'hard' && (
          <>
            <Text style={styles.diffDescTitle}>🔴 Hard Level</Text>
            <Text style={styles.diffDescText}>
              Deep analysis, synthesis, evaluation, and solving complex scenarios derived from the material. Designed to push your knowledge limits!
            </Text>
          </>
        )}

        <View style={styles.progressStatusContainer}>
          <Text style={styles.progressStatusText}>
            Current Module Mastery: <Text style={{ fontWeight: 'bold', color: D.green }}>{Math.round((moduleProgress?.mastery_score ?? 0) * 100)}%</Text>
          </Text>
          <Text style={styles.progressStatusText}>
            Times Quiz Taken: <Text style={{ fontWeight: 'bold' }}>{moduleProgress?.times_reviewed ?? 0}</Text>
          </Text>
        </View>
      </View>

      <View style={styles.quizStartActions}>
        {count > 0 ? (
          <>
            <TouchableOpacity style={styles.btnPrimary} onPress={handleStartQuiz}>
              <Text style={styles.btnPrimaryText}>Start Quiz ({count} Questions)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', marginTop: 12 }]}
              onPress={handleGenerateQuiz}
            >
              <Text style={[styles.btnPrimaryText, { color: D.textSecondary }]}>Regenerate AI Quiz</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.btnPrimary} onPress={handleGenerateQuiz}>
            <Text style={styles.btnPrimaryText}>Generate Quiz with AI</Text>
          </TouchableOpacity>
        )}
      </View>
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
          ) : activeTab === 'Flashcards' ? (
            <FlashcardGameSection moduleId={notebook.id} conversations={conversations} />
          ) : (
            <QuizGameSection moduleId={notebook.id} conversations={conversations} />
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

  // Detail tab bar
  detailTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: D.tabDivider,
    marginBottom: 16,
  },
  detailTab: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 0,
  },
  // Inner column — shrinks to hug the label text width
  detailTabInner: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  detailTabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: D.textTabInactive,
  },
  detailTabLabelActive: {
    color: D.green,
    fontWeight: '600',
  },
  // Underline sized to the text — alignSelf: 'stretch' fills the inner wrapper
  // which is already shrink-wrapped to the label via alignItems: 'center'
  detailTabUnderline: {
    marginTop: 6,
    height: 2.5,
    width: '100%',
    backgroundColor: D.green,
    borderRadius: 2,
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
    fontWeight: '600',
    color: D.textMuted,
    letterSpacing: 0.6,
  },
  sectionHeaderMeta: {
    fontSize: 11,
    fontWeight: '400',
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
  // Selection Styles
  selectionContainer: {
    backgroundColor: D.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.cardBorder,
    padding: 20,
    gap: 12,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: D.textPrimary,
  },
  selectionSubtitle: {
    fontSize: 13,
    color: D.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  selectionScroll: {
    maxHeight: 340,
  },
  selectionCard: {
    flexDirection: 'column',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: D.cardBorder,
    padding: 14,
    marginBottom: 10,
  },
  selectionCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  selectionCardBottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    width: '100%',
  },
  practiceBtnDeck: {
    flex: 2,
    flexDirection: 'row',
    backgroundColor: D.green,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  practiceBtnTextDeck: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  recompileBtnDeck: {
    flex: 2,
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recompileBtnDeckActive: {
    backgroundColor: D.green,
    borderColor: D.green,
  },
  recompileBtnTextDeck: {
    fontSize: 12,
    fontWeight: '700',
  },
  resetBtnDeck: {
    width: 36,
    height: 36,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  selectionCardText: {
    flex: 1,
  },
  selectionCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: D.textPrimary,
  },
  selectionCardMeta: {
    fontSize: 11,
    color: D.textMuted,
    marginTop: 2,
  },
  backToDecksBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  backToDecksText: {
    fontSize: 12,
    fontWeight: '700',
    color: D.textSecondary,
  },
  // Game Wrapper
  gameWrapper: {
    paddingTop: 8,
    gap: 16,
  },
  progressHeader: {
    gap: 8,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressCount: {
    fontSize: 13,
    fontWeight: '600',
    color: D.textSecondary,
  },
  xpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF9C3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  xpBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#854D0E',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: D.green,
    borderRadius: 4,
  },

  // Interactive Flip Card
  cardTouchArea: {
    width: '100%',
    height: 320,
    marginVertical: 12,
  },
  cardContainer: {
    width: '100%',
    height: '100%',
  },
  flashcard: {
    width: '100%',
    height: '100%',
    backgroundColor: D.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.cardBorder,
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
        cursor: 'pointer',
      },
    }),
  },
  flashcardBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderColor: '#FEF08A',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: D.divider,
    paddingBottom: 8,
    marginBottom: 12,
  },
  cardSideLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: D.green,
    letterSpacing: 1,
  },
  cardTextScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTextFront: {
    fontSize: 18,
    fontWeight: '700',
    color: D.textPrimary,
    textAlign: 'center',
    lineHeight: 26,
  },
  cardTextBack: {
    fontSize: 16,
    fontWeight: '500',
    color: D.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  cardActionHint: {
    fontSize: 12,
    color: D.textMuted,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },

  // Controls
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btnAnswer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  btnIncorrect: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  btnIncorrectText: {
    color: '#E11D48',
    fontWeight: '700',
    fontSize: 15,
  },
  btnCorrect: {
    backgroundColor: '#F0FDF4',
    borderColor: '#DCFCE7',
  },
  btnCorrectText: {
    color: D.green,
    fontWeight: '700',
    fontSize: 15,
  },

  // Empty / Completed States
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
    backgroundColor: D.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.cardBorder,
    gap: 12,
  },
  emptyStateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F4F5F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: D.textPrimary,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: D.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  completedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
    backgroundColor: D.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.cardBorder,
    gap: 16,
  },
  celebrationCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF9C3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FDE047',
  },
  completedTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: D.textPrimary,
  },
  completedSubtitle: {
    fontSize: 14,
    color: D.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: D.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: D.textMuted,
  },
  btnPrimary: {
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
  btnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  selectionCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  practiceBtn: {
    backgroundColor: D.green,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  practiceBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  recompileBtn: {
    backgroundColor: '#F1F5F9',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  compileBtn: {
    borderWidth: 1,
    borderColor: D.green,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F0FDF4',
  },
  compileBtnText: {
    color: D.green,
    fontSize: 12,
    fontWeight: '700',
  },
  disabledText: {
    color: D.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    paddingHorizontal: 8,
  },
  // Quiz Styles
  difficultySelectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginVertical: 16,
  },
  difficultyBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  difficultyBtnSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  difficultyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: D.textSecondary,
  },
  difficultyDescriptionBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: D.cardBorder,
    borderRadius: D.cardRadius,
    padding: 16,
    marginBottom: 20,
  },
  diffDescTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: D.textPrimary,
    marginBottom: 8,
  },
  diffDescText: {
    fontSize: 13,
    color: D.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  progressStatusContainer: {
    borderTopWidth: 1,
    borderColor: D.divider,
    paddingTop: 12,
    marginTop: 4,
    gap: 6,
  },
  progressStatusText: {
    fontSize: 12,
    color: D.textSecondary,
  },
  quizStartActions: {
    width: '100%',
    marginTop: 8,
  },
  quizQuestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: D.cardRadius,
    borderWidth: 1,
    borderColor: D.cardBorder,
    padding: 20,
    marginBottom: 16,
    minHeight: 100,
    justifyContent: 'center',
  },
  quizQuestionText: {
    fontSize: 16,
    fontWeight: '700',
    color: D.textPrimary,
    lineHeight: 22,
  },
  quizChoicesContainer: {
    gap: 10,
    marginBottom: 20,
  },
  quizChoiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: D.cardRadius,
    borderWidth: 1,
    borderColor: D.cardBorder,
    padding: 16,
  },
  quizChoiceCardSelected: {
    borderColor: D.green,
    backgroundColor: '#F7FEE7',
  },
  quizChoiceCardCorrect: {
    borderColor: '#22C55E',
    backgroundColor: '#DCFCE7',
  },
  quizChoiceCardIncorrect: {
    borderColor: '#EF4444',
    backgroundColor: '#FEE2E2',
  },
  quizChoiceCardDisabled: {
    opacity: 0.6,
  },
  quizChoiceText: {
    fontSize: 14,
    color: D.textPrimary,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  quizChoiceTextSelected: {
    color: '#3F6212',
    fontWeight: '700',
  },
  quizChoiceTextCorrect: {
    color: '#166534',
    fontWeight: '700',
  },
  quizChoiceTextIncorrect: {
    color: '#991B1B',
    fontWeight: '700',
  },
  quizActionsRow: {
    width: '100%',
    paddingVertical: 8,
  },
  btnPrimaryDisabled: {
    backgroundColor: D.textMuted,
    opacity: 0.7,
  },
})
