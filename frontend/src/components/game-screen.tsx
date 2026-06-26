import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { getLocalModules, type LocalModule } from '../../db/modules'
import { getLocalFlashcards, type LocalFlashcard } from '../../db/flashcards'
import { sendFlashcardsToUnity, isElectron } from '../lib/unity-bridge'

// ─── Design Tokens ───────────────────────────────────────────────────────────
// Mirrors library-screen.tsx / notebook-detail-screen.tsx so the Game tab feels
// like one app.

const D = {
  pageBg: '#F2F4EF',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  tabBarBg: '#FFFFFF',
  green: '#5A8A1F',
  greenLight: '#EBF3DF',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  cardBorder: '#E5ECD9',
  divider: '#EEEEEE',
  accentBar: '#6B9E1E',
  pagePadH: 16,
  cardRadius: 12,
} as const

// ─── Bottom tab bar ───────────────────────────────────────────────────────────
// A local copy of the library bottom bar with the Game tab marked active. Kept
// here (rather than shared) so the Game screen is self-contained.

type IconName = keyof typeof Ionicons.glyphMap

function TabItem({
  icon,
  label,
  active,
}: {
  icon: IconName
  label: string
  active?: boolean
}) {
  return (
    <View style={styles.tabItem}>
      <Ionicons name={icon} size={22} color={active ? '#6B9E1E' : '#94a3b8'} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </View>
  )
}

function BottomTabBar({
  onLibraryPress,
  onSettingsPress,
}: {
  onLibraryPress?: () => void
  onSettingsPress?: () => void
}) {
  return (
    <View style={styles.tabBar}>
      <TouchableOpacity style={{ flex: 1 }} onPress={onLibraryPress} activeOpacity={0.7}>
        <TabItem icon="library-outline" label="Library" />
      </TouchableOpacity>
      <TabItem icon="school-outline" label="Study" />
      <TabItem icon="game-controller-outline" label="Game" active />
      <TouchableOpacity style={{ flex: 1 }} onPress={onSettingsPress} activeOpacity={0.7}>
        <TabItem icon="settings-outline" label="Settings" />
      </TouchableOpacity>
    </View>
  )
}

// ─── Notebook dropdown ────────────────────────────────────────────────────────

interface NotebookDropdownProps {
  notebook: LocalModule
  expanded: boolean
  onToggle: () => void
  cards: LocalFlashcard[] | undefined // undefined = not loaded yet
  loadingCards: boolean
  selected: Record<string, boolean>
  onToggleCard: (cardId: string) => void
  onToggleAll: () => void
  onSend: () => void
}

function NotebookDropdown({
  notebook,
  expanded,
  onToggle,
  cards,
  loadingCards,
  selected,
  onToggleCard,
  onToggleAll,
  onSend,
}: NotebookDropdownProps) {
  const total = cards?.length ?? 0
  const selectedCount = cards
    ? cards.filter((c) => selected[c.id]).length
    : 0
  const allSelected = total > 0 && selectedCount === total
  const electron = isElectron()

  return (
    <View style={styles.dropdown}>
      {/* Header row — tap to expand/collapse */}
      <TouchableOpacity
        style={styles.dropdownHeader}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={styles.accentBar} />
        <View style={styles.dropdownTitleWrap}>
          <Text style={styles.dropdownTitle} numberOfLines={1}>
            {notebook.title}
          </Text>
          <Text style={styles.dropdownSubtitle}>
            {expanded
              ? total === 0
                ? 'No flashcards yet'
                : `${selectedCount} of ${total} selected`
              : 'Tap to pick flashcards'}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={D.textSecondary}
        />
      </TouchableOpacity>

      {/* Expanded body — flashcard picker */}
      {expanded && (
        <View style={styles.dropdownBody}>
          {loadingCards ? (
            <View style={styles.cardsLoading}>
              <ActivityIndicator color={D.green} />
            </View>
          ) : total === 0 ? (
            <Text style={styles.emptyCards}>
              This notebook has no compiled flashcards. Open it from the Library
              and compile a deck first.
            </Text>
          ) : (
            <>
              {/* Select-all toggle */}
              <TouchableOpacity
                style={styles.selectAllRow}
                onPress={onToggleAll}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={allSelected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={allSelected ? D.green : D.textMuted}
                />
                <Text style={styles.selectAllText}>
                  {allSelected ? 'Deselect all' : 'Select all'}
                </Text>
              </TouchableOpacity>

              {/* Flashcard rows (front / back) */}
              {cards!.map((card) => {
                const isOn = !!selected[card.id]
                return (
                  <TouchableOpacity
                    key={card.id}
                    style={styles.cardRow}
                    onPress={() => onToggleCard(card.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isOn ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isOn ? D.green : D.textMuted}
                      style={{ marginTop: 1 }}
                    />
                    <View style={styles.cardText}>
                      <Text style={styles.cardFront} numberOfLines={2}>
                        {card.front}
                      </Text>
                      <Text style={styles.cardBack} numberOfLines={2}>
                        {card.back}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )
              })}

              {/* Send button */}
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  (selectedCount === 0 || !electron) && styles.sendBtnDisabled,
                ]}
                onPress={onSend}
                disabled={selectedCount === 0 || !electron}
                activeOpacity={0.85}
              >
                <Ionicons name="game-controller" size={18} color="#FFFFFF" />
                <Text style={styles.sendBtnText}>
                  {electron
                    ? `Send ${selectedCount} ${selectedCount === 1 ? 'card' : 'cards'} to Game`
                    : 'Open the desktop app to send'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

interface GameScreenProps {
  onNavigateToLibrary?: () => void
  onNavigateToSettings?: () => void
}

export default function GameScreen({
  onNavigateToLibrary,
  onNavigateToSettings,
}: GameScreenProps) {
  const [notebooks, setNotebooks] = useState<LocalModule[]>([])
  const [loading, setLoading] = useState(true)

  // Which notebook dropdown is open (only one at a time).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Flashcards cached per notebook id; key absent = not loaded yet.
  const [cardsByNotebook, setCardsByNotebook] = useState<
    Record<string, LocalFlashcard[]>
  >({})
  const [loadingCardsId, setLoadingCardsId] = useState<string | null>(null)
  // Selected card ids, per notebook id.
  const [selected, setSelected] = useState<
    Record<string, Record<string, boolean>>
  >({})

  // Load the notebooks (modules) on mount.
  useEffect(() => {
    let cancelled = false
    getLocalModules()
      .then((mods) => {
        if (!cancelled) setNotebooks(mods)
      })
      .catch((err) => console.error('Failed to load notebooks:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Expand/collapse a notebook; lazily load its flashcards the first time.
  const handleToggle = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null)
        return
      }
      setExpandedId(id)

      if (!cardsByNotebook[id]) {
        setLoadingCardsId(id)
        try {
          const cards = await getLocalFlashcards(id)
          setCardsByNotebook((prev) => ({ ...prev, [id]: cards }))
          // Pre-select every card so a one-tap "send the whole deck" works.
          setSelected((prev) => ({
            ...prev,
            [id]: Object.fromEntries(cards.map((c) => [c.id, true])),
          }))
        } catch (err) {
          console.error('Failed to load flashcards:', err)
          Alert.alert('Error', 'Could not load this notebook’s flashcards.')
        } finally {
          setLoadingCardsId(null)
        }
      }
    },
    [expandedId, cardsByNotebook],
  )

  const handleToggleCard = useCallback((notebookId: string, cardId: string) => {
    setSelected((prev) => {
      const forNotebook = prev[notebookId] ?? {}
      return {
        ...prev,
        [notebookId]: { ...forNotebook, [cardId]: !forNotebook[cardId] },
      }
    })
  }, [])

  const handleToggleAll = useCallback(
    (notebookId: string) => {
      const cards = cardsByNotebook[notebookId] ?? []
      const sel = selected[notebookId] ?? {}
      const allOn = cards.length > 0 && cards.every((c) => sel[c.id])
      setSelected((prev) => ({
        ...prev,
        [notebookId]: Object.fromEntries(
          cards.map((c) => [c.id, !allOn]),
        ),
      }))
    },
    [cardsByNotebook, selected],
  )

  // Step #3 — send the selected flashcards (front + back) to Unity.
  const handleSend = useCallback(
    (notebook: LocalModule) => {
      const cards = cardsByNotebook[notebook.id] ?? []
      const sel = selected[notebook.id] ?? {}
      const chosen = cards
        .filter((c) => sel[c.id])
        .map((c) => ({ id: c.id, front: c.front, back: c.back }))

      if (chosen.length === 0) {
        Alert.alert('No cards selected', 'Pick at least one flashcard to send.')
        return
      }

      const ok = sendFlashcardsToUnity({
        deckId: notebook.id,
        deckTitle: notebook.title,
        cards: chosen,
      })

      if (ok) {
        Alert.alert(
          'Sent to Game',
          `Sent ${chosen.length} ${chosen.length === 1 ? 'flashcard' : 'flashcards'} from “${notebook.title}” to the Unity game.`,
        )
      } else {
        Alert.alert(
          'Game not connected',
          'The game bridge is only available in the desktop app. Launch the Electron app to send flashcards to Unity.',
        )
      }
    },
    [cardsByNotebook, selected],
  )

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.brand}>AI Tutor</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>Game</Text>
            <Text style={styles.pageSubtitle}>
              Pick flashcards from a notebook and send them to the Unity game.
            </Text>
          </View>

          {/* Tell the user when the bridge isn't available (plain browser). */}
          {!isElectron() && (
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={18} color={D.green} />
              <Text style={styles.noticeText}>
                The game bridge only works in the desktop (Electron) app. You can
                browse decks here, but sending is disabled in the browser.
              </Text>
            </View>
          )}

          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={D.green} />
            </View>
          ) : notebooks.length === 0 ? (
            <Text style={styles.emptyState}>
              No notebooks yet. Create one in the Library tab to get started.
            </Text>
          ) : (
            <View style={styles.list}>
              {notebooks.map((nb) => (
                <NotebookDropdown
                  key={nb.id}
                  notebook={nb}
                  expanded={expandedId === nb.id}
                  onToggle={() => handleToggle(nb.id)}
                  cards={cardsByNotebook[nb.id]}
                  loadingCards={loadingCardsId === nb.id}
                  selected={selected[nb.id] ?? {}}
                  onToggleCard={(cardId) => handleToggleCard(nb.id, cardId)}
                  onToggleAll={() => handleToggleAll(nb.id)}
                  onSend={() => handleSend(nb)}
                />
              ))}
            </View>
          )}

          <View style={{ height: 80 }} />
        </ScrollView>

        <BottomTabBar
          onLibraryPress={onNavigateToLibrary}
          onSettingsPress={onNavigateToSettings}
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
    backgroundColor: D.headerBg,
    paddingHorizontal: D.pagePadH,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: D.divider,
  },
  brand: {
    fontSize: 16,
    fontWeight: '700',
    color: D.textPrimary,
  },

  // Scroll body
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: D.pagePadH,
  },
  pageHeader: {
    paddingTop: 20,
    paddingBottom: 12,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: D.textPrimary,
  },
  pageSubtitle: {
    fontSize: 14,
    color: D.textSecondary,
    marginTop: 4,
  },

  notice: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: D.greenLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    color: D.textSecondary,
    lineHeight: 18,
  },

  loadingState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyState: {
    fontSize: 14,
    color: D.textMuted,
    textAlign: 'center',
    paddingVertical: 40,
  },

  list: {
    gap: 12,
  },

  // Dropdown
  dropdown: {
    backgroundColor: D.cardBg,
    borderRadius: D.cardRadius,
    borderWidth: 1,
    borderColor: D.cardBorder,
    overflow: 'hidden',
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingRight: 14,
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
    backgroundColor: D.accentBar,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginRight: 12,
  },
  dropdownTitleWrap: {
    flex: 1,
  },
  dropdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: D.textPrimary,
  },
  dropdownSubtitle: {
    fontSize: 12,
    color: D.textMuted,
    marginTop: 2,
  },

  dropdownBody: {
    borderTopWidth: 1,
    borderTopColor: D.divider,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
  },
  cardsLoading: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyCards: {
    fontSize: 13,
    color: D.textMuted,
    lineHeight: 18,
    paddingVertical: 12,
  },

  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: D.green,
  },

  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: D.divider,
  },
  cardText: {
    flex: 1,
  },
  cardFront: {
    fontSize: 14,
    fontWeight: '600',
    color: D.textPrimary,
  },
  cardBack: {
    fontSize: 13,
    color: D.textSecondary,
    marginTop: 2,
  },

  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: D.green,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },
  sendBtnDisabled: {
    backgroundColor: '#B9C7A6',
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
})
