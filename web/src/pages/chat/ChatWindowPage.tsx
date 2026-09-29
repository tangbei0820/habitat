import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { ChatReadingBookItem, ChatToolCallPayload } from '@shared/events'
import type { LlmChatMessage } from '@shared/providers'
import type { ChatContextSummary, ChatMessage, ChatSession, MessageBlock, MessageStatus, RelationshipSnapshot, Sticker, ToolResultBlock } from '@shared/types'
import { VirtualList } from '../../components/VirtualList'
import { IconChevronLeft, IconClock, IconMic, IconSearch, IconSetting, IconToolbox } from '../../components/qixi/Icons'
import { useChatDisplay } from '../../app/useChatDisplay'
import {
  ChatBubble,
  itemKey,
  type BubbleActions,
  type ChatItem,
} from '../../features/chat/ChatBubble'
import { ActionSheet, type SheetAction } from '../../components/ActionSheet'
import { ChatSettingsSheet } from '../../features/chat/ChatSettingsSheet'
import { Composer } from '../../features/chat/Composer'
import { MessageAvatar } from '../../features/chat/MessageAvatar'
import { MiniTerminal } from '../../features/chat/MiniTerminal'
import { ChatHistoryPanel } from '../../features/chat/ChatHistoryPanel'
import { CallPanel } from '../../features/chat/CallPanel'
import { CallHistoryPanel } from '../../features/chat/CallHistoryPanel'
import {
  createMessageArtwork,
  createMessageBookmark,
  createMessagePhotos,
  addReadingAnnotation,
  addReadingVocabulary,
  getReadingBook,
  listReadingNotes,
  listMusicTracks,
  updateReadingVocabulary,
  updateReadingBookState,
} from '../../db/home'
import {
  addVersion,
  activeContextSummary,
  appendMessage,
  capPublicThought,
  capReasoning,
  countMessages,
  deleteMessage,
  deleteMessages,
  editContextSummary,
  editMessage,
  getContextCompression,
  getSession,
  listMessages,
  listMessagesAround,
  listMessagesPage,
  listMessagesPageAfter,
  messageText,
  newMessage,
  recallMessage,
  removeCandidateVersion,
  restoreMessage,
  saveContextSummary,
  selectCandidateVersion,
  setContextSummaryActive,
  textBlock,
  touchSession,
  updateMessage,
  updateSessionSettings,
} from '../../db/chat'
import { ApiRequestError } from '../../lib/api'
import { compactChatContext } from '../../lib/chatContext'
import { streamChat } from '../../lib/chatStream'
import { formatDayLabel, formatDuration, isSameDay } from '../../lib/format'
import { log } from '../../lib/log'
import { describeImage, generateImage, synthesizeSpeech, transcribeAudio } from '../../lib/media'
import { useOnlineStatus } from '../../features/offline/useOnlineStatus'
import { createStickerFromFile, getSticker, listStickers } from '../../db/stickers'
import { appendBookmarkLifeEvent, appendReadingLifeEvent } from '../../features/life/api'
import { usePhotoCollectionSettings } from '../../features/home/usePhotoCollectionSettings'
import {
  decideRelationshipRecovery,
  getRelationship,
  pauseRelationship,
  pokeRelationship,
  requestRelationshipRecovery,
} from '../../features/chat/relationship'

/** 首屏只拉最近这么多条（§9 风险8：按时间分页，不全量读）；向上翻页也用它 */
const PAGE_SIZE = 60
/** 自动命名会话时截取的字数 */
const TITLE_LIMIT = 18
/**
 * 流式草稿的落库节流：增量**不**逐 token 写 IndexedDB（那是每 token 一次磁盘写），
 * 按这个间隔合并落一次。刷新丢的最多是这不到一秒的内容，而不是整轮回复。
 */
const DRAFT_FLUSH_MS = 800
const TOAST_MS = 1800
/**
 * 开场动画窗口时长。大于入场动画本身（`--dur-card` = 300ms）留出余量 ——
 * 太短会让首批消息只播一半就被掐掉，太长会把「滚出来的新行」也算进去。
 */
const ENTER_ANIM_MS = 700
/** 压缩只归档较早历史，最近一小段始终以原始消息形式保留。 */
const COMPACT_KEEP_RECENT = 12
const COMPACT_MIN_ARCHIVE = 4

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LIMIT ? `${oneLine.slice(0, TITLE_LIMIT)}…` : oneLine
}

/**
 * 组装某一轮请求的历史：**截止到 `upToIndex`（含）**，其后的一律不送。
 *
 * 两条规则：
 * 1. 「换一个」与「重发」靠它把「同一轮」钉住 —— 换一个时若不截断，等于让模型接着自己
 *    刚写的那段往下续，出的东西必然跑偏。
 * 2. **撤回过的消息不进上下文**（SPEC §2.3.5）。这里是该语义的**唯一落点** ——
 *    刻意不放进 `messageText()`：那里的职责是「取纯文本投影」，与「这段该不该送出去」是两件事；
 *    混在一起会让所有复用它的地方（列表预览、版本登记）都被动地跟着改行为。
 *
 * 3. Phase 5 起，语音优先送真实转写、图片优先送视觉描述；服务未配置 / 失败时才送明确的
 *    `[未转写]` / `[未识别]` 占位。手动 MCP 结果投影成 assistant 摘要（它没有 LLM tool_call_id）。
 *    原始音频 / 图片 / 工具 JSON 不直接塞进文本上下文。
 */
function historyUpTo(messages: ChatMessage[], upToIndex: number, summary: ChatContextSummary | null = null): LlmChatMessage[] {
  const end = Math.min(upToIndex, messages.length - 1)
  const summaryIndex = summary === null
    ? -1
    : messages.findIndex((message) => message.id === summary.coveredToMessageId)
  const includeSummary = summary !== null && summaryIndex >= 0 && summaryIndex <= end
  const start = includeSummary ? summaryIndex + 1 : 0
  const projected: LlmChatMessage[] = []
  if (includeSummary && summary !== null) {
    projected.push({
      role: 'system',
      content: [
        '[历史摘要开始]',
        '以下内容是对更早对话的归纳，不是用户或小栖的逐字原话；如与最近原始消息冲突，以原始消息为准。',
        summary.text,
        '[历史摘要结束]',
      ].join('\n'),
    })
  }
  return projected.concat(messages
    .slice(start, end + 1)
    .filter((message) => message.recalledAt === null)
    // 关系事件只进入用户可见的 Chat / Life 时间线，不伪装成模型需要回答的文字。
    .filter((message) => message.metadata?.relationshipEvent === undefined)
    .map((message): LlmChatMessage => ({
      // Mini Terminal 是用户直接调用，不对应上游 LLM 的 tool_call_id；投影成 assistant 摘要，
      // 避免发送一条协议不完整的 role=tool 消息被 OpenAI 兼容端拒绝。
      role: message.role === 'tool' ? 'assistant' : message.role,
      content: messageText(message) || mediaContext(message),
    }))
    .filter((message) => message.content !== ''))
}

/** 非文本块在上下文里的安全文本投影。 */
function mediaContext(message: ChatMessage): string {
  const audio = message.blocks.find((block) => block.kind === 'audio')
  if (audio !== undefined && audio.kind === 'audio') {
    return audio.payload.transcript?.trim() || `[语音条 ${formatDuration(audio.payload.durationMs ?? 0)}，未转写]`
  }
  const image = message.blocks.find((block) => block.kind === 'image')
  if (image !== undefined && image.kind === 'image') return image.payload.alt?.trim() || '[图片，未识别]'
  const tool = message.blocks.find((block) => block.kind === 'tool-result')
  if (tool !== undefined && tool.kind === 'tool-result') return `[工具 ${tool.payload.toolName}：${tool.payload.summary ?? (tool.payload.ok ? '成功' : '失败')}]`
  const sticker = message.blocks.find((block) => block.kind === 'sticker')
  if (sticker !== undefined && sticker.kind === 'sticker') return `[表情包：${sticker.payload.name}]`
  return ''
}

function copyableText(message: ChatMessage): string {
  const plain = messageText(message)
  if (plain !== '') return plain
  const audio = message.blocks.find((block) => block.kind === 'audio')
  return audio?.kind === 'audio' ? audio.payload.transcript?.trim() ?? '' : ''
}

/** 把当前本地书架裁成聊天 Runtime 的短窗口；正文不进服务端持久层。 */
async function buildChatReadingCatalog(): Promise<ChatReadingBookItem[]> {
  const notes = await listReadingNotes()
  const result: ChatReadingBookItem[] = []
  for (const note of notes.slice(0, 8)) {
    const reader = getReadingBook(note)
    if (reader === null) continue
    const allParagraphs = reader.content.split('\n')
    if (allParagraphs.length === 0) continue
    const current = Math.min(Math.max(reader.currentParagraph, 0), allParagraphs.length - 1)
    const windowSize = 80
    const before = 24
    const start = allParagraphs.length <= windowSize
      ? 0
      : Math.min(Math.max(current - before, 0), allParagraphs.length - windowSize)
    const paragraphs: string[] = []
    let chars = 0
    for (let index = start; index < allParagraphs.length && paragraphs.length < windowSize; index += 1) {
      const value = allParagraphs[index] ?? ''
      const clipped = value.slice(0, 8_000)
      if (chars + clipped.length > 60_000 && index > current) break
      paragraphs.push(clipped)
      chars += clipped.length
    }
    if (paragraphs.length === 0) continue
    result.push({
      id: note.id,
      title: note.bookTitle,
      author: note.author,
      format: reader.format,
      currentParagraph: current,
      bookmarkParagraph: reader.bookmarkParagraph,
      readingSeconds: reader.readingSeconds,
      totalParagraphs: allParagraphs.length,
      paragraphOffset: start,
      paragraphs,
      annotations: reader.annotations.slice(-40).map((annotation) => ({
        id: annotation.id,
        paragraphIndex: annotation.paragraphIndex,
        text: annotation.text,
        note: annotation.note,
        author: annotation.author,
        createdAt: annotation.createdAt,
      })),
      vocabulary: reader.vocabulary.slice(-40).map((word) => ({
        id: word.id,
        paragraphIndex: word.paragraphIndex,
        term: word.term,
        note: word.note,
        createdAt: word.createdAt,
      })),
    })
  }
  return result
}

/**
 * 待回复消息条数（SPEC §2.4.3）：从末尾往回数连续的 `user` 消息，
 * 撞到 `assistant` 就说明「已经有人接了」。
 *
 * 不加字段 —— 这是能从消息序列直接算出来的状态，多存一份就多一份要维护的一致性
 * （撤回、删除、重发生成都会让它漂移）。
 */
function countUnreplied(messages: ChatMessage[]): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.recalledAt !== null) continue
    if (message.role === 'system' || message.role === 'tool') continue
    if (message.role === 'assistant') return count
    count += 1
  }
  return count
}

/** 破坏性操作统一走「先说清楚要动什么、再确认」——三个入口共用一份状态 */
type PendingConfirm =
  | { kind: 'recall'; ids: string[]; text: string }
  | { kind: 'delete'; ids: string[]; text: string }
  | { kind: 'regenerate'; ids: string[]; text: string; anchorId: string }

export function ChatWindowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusMessageId = searchParams.get('focus')
  const incomingCallId = searchParams.get('call')
  const [session, setSession] = useState<ChatSession | null | undefined>(undefined)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [hasMoreLater, setHasMoreLater] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [loadingLater, setLoadingLater] = useState(false)
  /**
   * 「刚打开这个会话」的入场窗口（`--dur-card` 300ms + 余量）。
   *
   * ⚠️ 为什么要有这么个开关，而不是让每条消息自己挂进入动画：
   * 消息流是**虚拟列表**，滚动过程中会不断挂载新行 —— 若动画挂在 `.msg-row` 上，
   * 往上翻历史时每一行都会淡入一次，看起来像「整页在不停重新加载」。
   * 所以动画只在打开会话那一瞬开，过了这个窗口就不再播。
   */
  const [entering, setEntering] = useState(false)

  /** 全局显示偏好（SPEC §9.1.3）：两侧头像开关拆开，在这里读一次再往下传，气泡保持纯展示组件 */
  const showCompanionAvatar = useChatDisplay((state) => state.showCompanionAvatar)
  const showUserAvatar = useChatDisplay((state) => state.showUserAvatar)
  const collectUserSent = usePhotoCollectionSettings((state) => state.collectUserSent)
  const collectAssistantSent = usePhotoCollectionSettings((state) => state.collectAssistantSent)
  const collectAssistantGenerated = usePhotoCollectionSettings((state) => state.collectAssistantGenerated)

  /* ---------- 消息对象操作（SPEC §2.3）的状态 ---------- */
  /** 离线时禁掉所有会发请求的消息动作（朗读 / 换一个 / 重发 / 重新生成） */
  const online = useOnlineStatus()
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [contextMessageCount, setContextMessageCount] = useState(0)
  const [contextCharacterCount, setContextCharacterCount] = useState(0)
  const [contextCompacting, setContextCompacting] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [callHistoryOpen, setCallHistoryOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [relationship, setRelationship] = useState<RelationshipSnapshot | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  /**
   * 同步守卫：`onReachTop` 在贴顶时会连着触发好几次，而 `setLoadingEarlier` 生效要等下一帧 ——
   * 只靠 state 拦不住重复请求。
   */
  const loadingEarlierRef = useRef(false)
  const loadingLaterRef = useRef(false)
  /** 供回调读最新消息列表，避免闭包读到旧数组 */
  const messagesRef = useRef<ChatMessage[]>([])
  const toastTimerRef = useRef<number | null>(null)
  const speechRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null)
  const highlightTimerRef = useRef<number | null>(null)

  /**
   * 自动收集只处理刚落库的新消息；消息 id + block.order 仍由仓储层负责稳定去重。
   * 历史消息不在打开会话时批量扫描，避免用户只想聊天却突然读取大量图片。
   */
  function autoCollectChatImages(message: ChatMessage): void {
    const imageOrders = message.blocks
      .filter((block) => block.kind === 'image')
      .map((block) => block.order)
    if (imageOrders.length === 0) return

    const source = message.metadata?.imageSource
    const orders = message.role === 'user'
      ? (collectUserSent ? imageOrders : [])
      : message.role === 'assistant' && source === 'generated'
        ? (collectAssistantGenerated ? imageOrders : [])
        : message.role === 'assistant' && collectAssistantSent
          ? imageOrders
          : []
    if (orders.length === 0) return

    void createMessagePhotos(message, { blockOrders: orders, throwOnAllSkipped: false })
      .catch((error: unknown) => {
        log.warn('聊天图片自动收集失败', error)
        showToast(`自动收集图片失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }

  useEffect(() => {
    let cancelled = false
    void listStickers()
      .then((items) => { if (!cancelled) setStickers(items) })
      .catch((err: unknown) => log.warn('读取表情图库失败', err))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 轻提示自己会走，别让它跟着会话一起留下来
  useEffect(() => {
    if (toast === null) return
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    }
  }, [toast])

  // 开场动画窗口自己会关，别一直开着（一直开着就等于每条新挂载的行都在播）
  useEffect(() => {
    if (!entering) return
    const timer = window.setTimeout(() => setEntering(false), ENTER_ANIM_MS)
    return () => window.clearTimeout(timer)
  }, [entering])

  useEffect(() => {
    if (sessionId === undefined) return
    // 换会话时把消息级操作状态清干净：残留的选中 / 待确认会作用到另一个会话的消息上
    setSheetFor(null)
    setEditingId(null)
    setEditDraft('')
    setSelectMode(false)
    setSelectedIds(new Set())
    setPendingConfirm(null)
    setSettingsOpen(false)
    setCallOpen(false)
    setCallHistoryOpen(false)
    setContextMessageCount(0)
    setContextCharacterCount(0)
    setHasMore(false)
    setHasMoreLater(false)
    setHistoryOpen(false)
    setHighlightedMessageId(null)
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current)
    let cancelled = false
    void (async () => {
      try {
        const loaded = await getSession(sessionId)
        const focusWindow = focusMessageId === null
          ? null
          : await listMessagesAround(sessionId, focusMessageId, PAGE_SIZE)
        const page = focusWindow?.messages ?? await listMessagesPage(sessionId, PAGE_SIZE)
        if (cancelled) return
        setSession(loaded)
        void countMessages(sessionId).then((count) => {
          if (!cancelled) setContextMessageCount(count)
        }).catch((err: unknown) => log.warn('读取消息数量失败', err))
        void listMessages(sessionId).then((all) => {
          if (!cancelled) {
            const chars = all.reduce((sum, message) => sum + (messageText(message) || mediaContext(message)).length, 0)
            setContextCharacterCount(chars)
          }
        }).catch((err: unknown) => log.warn('读取上下文估算失败', err))
        // 上一轮的流式草稿（刷新 / 关页留下的）在这里定性为「已停止」：
        // 它确实停了 —— 服务端连接随页面卸载而断开，不可能还在生成
        const stale = page.filter((m) => m.status === 'streaming' || m.status === 'pending')
        if (stale.length > 0) {
          const ids = new Set(stale.map((m) => m.id))
          setMessages(page.map((m) => (ids.has(m.id) ? { ...m, status: 'aborted' } : m)))
          void Promise.all(stale.map((m) => updateMessage(m.id, { status: 'aborted' }))).catch(
            (err: unknown) => log.error('标记中断消息失败', err),
          )
        } else {
          setMessages(page)
        }
        // 普通打开从尾部向前翻；历史定位只取目标附近窗口，再按上下游标继续翻，避免全量加载。
        setHasMore(focusWindow?.hasEarlier ?? (focusMessageId === null && page.length === PAGE_SIZE))
        setHasMoreLater(focusWindow?.hasLater ?? false)
        if (focusMessageId !== null) {
          const target = page.find((message) => message.id === focusMessageId)
          if (target === undefined) {
            setErrorText(focusWindow === null ? '原消息已删除，无法定位' : '原消息不属于这个会话，无法定位')
          } else {
            setHighlightedMessageId(target.id)
            highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 2600)
          }
        }
        // 开场动画窗口：只在「刚进来」这一瞬给，滚动挂载的新行不再播（见 entering 的注释）
        if (page.length > 0) setEntering(true)
      } catch (err) {
        log.error('读取会话失败', err)
        if (!cancelled) {
          setSession(null)
          setErrorText(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, focusMessageId])

  useEffect(() => {
    if (incomingCallId !== null && session?.id === sessionId) setCallOpen(true)
  }, [incomingCallId, session?.id, sessionId])

  // 关系状态是服务端事实源；轮询只用于到期自动恢复和 Companion 侧申请，不影响消息分页。
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void getRelationship()
        .then((snapshot) => { if (!cancelled) setRelationship(snapshot) })
        .catch((err: unknown) => log.warn('读取关系状态失败', err))
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sessionId])

  // 离开页面即中止在跑的流，避免白烧 token
  useEffect(
    () => () => {
      abortRef.current?.abort()
      speechRef.current?.audio.pause()
      if (speechRef.current !== null) URL.revokeObjectURL(speechRef.current.url)
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current)
    },
    [],
  )

  /** 向上翻一页。`before` 是「不含」语义，所以拿已加载的最早一条 (createdAt, id) 当游标 */
  async function loadEarlier(): Promise<void> {
    if (sessionId === undefined || loadingEarlierRef.current || !hasMore) return
    const oldest = messagesRef.current[0]
    if (oldest === undefined) return

    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    try {
      const earlier = await listMessagesPage(sessionId, PAGE_SIZE, {
        createdAt: oldest.createdAt,
        id: oldest.id,
      })
      if (earlier.length > 0) setMessages((prev) => [...earlier, ...prev])
      setHasMore(earlier.length === PAGE_SIZE)
    } catch (err) {
      log.error('加载更早的消息失败', err)
    } finally {
      loadingEarlierRef.current = false
      setLoadingEarlier(false)
    }
  }

  /** 历史定位窗口向下继续加载；普通尾部首屏没有后续页。 */
  async function loadLater(): Promise<void> {
    if (sessionId === undefined || loadingLaterRef.current || !hasMoreLater) return
    const newest = messagesRef.current[messagesRef.current.length - 1]
    if (newest === undefined) return
    loadingLaterRef.current = true
    setLoadingLater(true)
    try {
      const later = await listMessagesPageAfter(sessionId, PAGE_SIZE, { createdAt: newest.createdAt, id: newest.id })
      if (later.length > 0) setMessages((prev) => [...prev, ...later])
      setHasMoreLater(later.length === PAGE_SIZE)
    } catch (err) {
      log.error('加载较新的消息失败', err)
    } finally {
      loadingLaterRef.current = false
      setLoadingLater(false)
    }
  }

  /**
   * 一轮生成的完整生命周期：发送 / 重发 / 换一个 三条路共用，差别只在「结果写到哪」。
   * `targetId` 为空 = 新回复（先落一条 streaming 草稿，节流更新，收尾定性）；
   * 有值 = 给那条消息加一个版本（换一个，收尾才写，中间不写库）。
   */
  async function runGeneration(
    history: LlmChatMessage[],
    targetId: string | null,
    options: { webSearchQuery?: string; onReplyChunk?: (text: string) => void; interactionId?: string } = {},
  ): Promise<string> {
    if (sessionId === undefined) return ''
    const controller = new AbortController()
    abortRef.current = controller
    setSending(true)
    setErrorText(null)

    // 累加用局部变量而不是 state：回调里读 state 只会拿到闭包里的旧值
    let content = ''
    let publicThought = ''
    let providerReasoning = ''
    let failure: string | null = null
    const orderedBlocks: MessageBlock[] = [textBlock('')]

    function appendReplyText(fragment: string): void {
      if (fragment === '') return
      content += fragment
      const last = orderedBlocks[orderedBlocks.length - 1]
      if (last?.kind === 'text') last.payload.text += fragment
      else orderedBlocks.push(textBlock(fragment, orderedBlocks.length))
    }

    let draftId: string | null = null
    let lastFlush = 0
    if (targetId === null) {
      const assistant = newMessage({ sessionId, role: 'assistant', text: '', status: 'streaming' })
      await appendMessage(assistant)
      draftId = assistant.id
      lastFlush = Date.now()
      setMessages((prev) => [...prev, assistant])
    }

    const flushDraft = async (force = false): Promise<void> => {
      if (draftId === null) return
      const now = Date.now()
      if (!force && now - lastFlush < DRAFT_FLUSH_MS) return
      lastFlush = now
      const metadata = {
        ...(publicThought === '' ? {} : { publicThought: capPublicThought(publicThought) }),
        ...(providerReasoning === '' ? {} : { providerReasoning: capReasoning(providerReasoning) }),
      }
      const patch = {
        blocks: orderedBlocks.map((block, index) => ({ ...block, order: index })),
        ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
      }
      try {
        await updateMessage(draftId, patch)
        setMessages((prev) => prev.map((m) => (m.id === draftId ? { ...m, ...patch } : m)))
      } catch (err) {
        // 草稿落库失败不中断生成：收尾还会再写一次
        log.error('流式草稿落库失败', err)
      }
    }

    try {
      const stickerCatalog = stickers.length === 0
        ? await listStickers()
        : stickers
      const listeningCatalog = await listMusicTracks()
      const readingCatalog = await buildChatReadingCatalog()
      await streamChat(
        {
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(options.interactionId === undefined ? {} : { interactionId: options.interactionId }),
          messages: history,
          ...(options.webSearchQuery === undefined ? {} : { webSearch: { query: options.webSearchQuery } }),
          ...(stickerCatalog.length === 0 ? {} : {
            stickerCatalog: stickerCatalog.map((sticker) => ({
              id: sticker.id,
              name: sticker.name,
              category: sticker.category,
              tags: sticker.tags,
            })),
          }),
          ...(listeningCatalog.length === 0 ? {} : {
            listeningCatalog: listeningCatalog.slice(0, 100).map((track) => ({
              id: track.id,
              title: track.title,
              artist: track.artist,
              externalUrl: track.externalUrl,
            })),
          }),
          ...(readingCatalog.length === 0 ? {} : { readingCatalog }),
        },
        {
          onDelta: (delta) => {
            if (delta.content !== undefined) {
              appendReplyText(delta.content)
              options.onReplyChunk?.(delta.content)
            }
            if (delta.reasoning !== undefined) providerReasoning += delta.reasoning
            void flushDraft()
          },
          onThought: (thought) => {
            publicThought += thought.content
            void flushDraft()
          },
          onToolCall: (call) => {
            void appendToolCall(call, draftId ?? targetId, orderedBlocks).then(() => void flushDraft(true))
          },
          onError: (err) => {
            failure = err.message
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户主动停止：保留已收到的内容，不算失败
      } else if (err instanceof ApiRequestError) {
        failure = err.message
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        // 同上
      } else {
        failure = err instanceof Error ? err.message : String(err)
        log.error('生成失败', err)
      }
    }

    const status: MessageStatus = controller.signal.aborted
      ? 'aborted'
      : failure === null
        ? 'done'
        : 'error'

    // 按「这轮结果写到哪」分支：目标消息存在 = 换一个（加版本）；否则 = 新回复（收尾定性草稿）
    if (targetId !== null) {
      // 换一个：正文非空才替换，失败 / 空回复时保住旧版本，用户不会有损失
      if (content !== '') {
        const updated = await addVersion(targetId, {
          content,
          status,
          publicThought,
          providerReasoning,
          blocks: orderedBlocks.map((block, index) => ({ ...block, order: index })),
        })
        if (updated !== null) {
          setMessages((prev) => prev.map((m) => (m.id === targetId ? updated : m)))
        }
      }
    } else if (draftId !== null) {
      if (content !== '') {
        // 收尾定性：内容 + 状态一次写回，刷新后这轮的成果完整可见
        const metadata = {
          ...(publicThought === '' ? {} : { publicThought: capPublicThought(publicThought) }),
          ...(providerReasoning === '' ? {} : { providerReasoning: capReasoning(providerReasoning) }),
        }
        const finalPatch = {
          blocks: orderedBlocks.map((block, index) => ({ ...block, order: index })),
          status,
          ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
        }
        await updateMessage(draftId, finalPatch)
        setMessages((prev) => prev.map((m) => (m.id === draftId ? { ...m, ...finalPatch } : m)))
        await touchSession(sessionId)
      } else {
        // 失败换来的空回复不留垃圾记录
        await deleteMessage(draftId)
        setMessages((prev) => prev.filter((m) => m.id !== draftId))
      }
    }

    abortRef.current = null
    setSending(false)
    setErrorText(failure)
    return content
  }

  function currentContextSummary(): ChatContextSummary | null {
    return session === null || session === undefined ? null : activeContextSummary(session)
  }

  /** 有摘要时必须取全量消息来找到覆盖边界；仅取首屏尾页会把摘要误判成失效。 */
  async function buildHistoryThrough(messageId: string, fallback: ChatMessage[]): Promise<LlmChatMessage[]> {
    if (sessionId === undefined) return []
    const summary = currentContextSummary()
    const source = summary === null ? fallback : await listMessages(sessionId)
    const index = source.findIndex((message) => message.id === messageId)
    return index < 0 ? [] : historyUpTo(source, index, summary)
  }

  /**
   * 落一条**用户消息**，并按模式决定要不要接着请求回复（SPEC §2.4.3）。
   *
   * 文本与语音条走同一条路 —— SPEC §2.4.4 明确要求语音条不另开链路。
   * 差别只在 blocks 怎么来。
   */
  async function submitUserMessage(input: {
    text: string
    blocks?: MessageBlock[]
    metadata?: Record<string, unknown>
    requestReply: boolean
    /** 本轮是否由“联网搜索”入口明确授权 */
    webSearchQuery?: string
    /** 「只发送」时给用户的确认语；语音条有自己的一句 */
    toast?: string
    /** 通话模式可在模型生成时把正文增量交给句级 TTS 队列。 */
    onReplyChunk?: (text: string) => void
  }): Promise<string | null> {
    if (sessionId === undefined) return null

    // 1. 用户消息先落库（本地权威，§6.2），不等模型
    const userMessage = newMessage({
      sessionId,
      role: 'user',
      text: input.text,
      ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    })
    await appendMessage(userMessage)
    setMessages((prev) => [...prev, userMessage])
    autoCollectChatImages(userMessage)
    setErrorText(null)

    // 2. 首条消息顺便给会话起名（否则一直叫「新的对话」）。
    //    语音条没有文本投影，`titleFrom('')` 会得到一个空标题 —— 那就别改，保住原标题
    const isFirst = messagesRef.current.length === 0
    const title = isFirst && input.text !== '' ? titleFrom(input.text) : undefined
    await touchSession(sessionId, title)
    if (title !== undefined) {
      setSession((prev) => (prev === null || prev === undefined ? prev : { ...prev, title }))
    }

    if (!input.requestReply) {
      if (input.toast !== undefined) showToast(input.toast)
      return null
    }

    // 3. 历史由前端组装随请求送出（服务端不存聊天记录）
    return runGeneration(
      await buildHistoryThrough(userMessage.id, [...messagesRef.current, userMessage]),
      null,
      {
        ...(input.webSearchQuery === undefined ? {} : { webSearchQuery: input.webSearchQuery }),
        ...(input.onReplyChunk === undefined ? {} : { onReplyChunk: input.onReplyChunk }),
        interactionId: userMessage.id,
      },
    )
  }

  /** 「发送」= 发送并请求回复（SPEC §2.4.3 的默认行为） */
  async function send(text: string, options: { requestReply: boolean }): Promise<void> {
    if (sending) return
    // 先清输入框：内容已经交给下面这条链路了，留在框里会让人以为没发出去
    setDraft('')
    await submitUserMessage({
      text,
      requestReply: options.requestReply,
      // 让「只发送」有明确回声：否则点了发送却什么都没发生，看起来像坏了
      toast: options.requestReply ? undefined : '已发送，未请求回复',
    })
  }

  /** “联网搜索”是一次带明确授权的普通提问：先把原问题落成本地消息，再让服务端
   * 只在这一轮开放 web_search，并把来源卡片与模型结果一起留在会话里。 */
  async function webSearch(query: string): Promise<void> {
    if (sending || sessionId === undefined) return
    const normalized = query.trim()
    if (normalized === '') {
      setErrorText('先在输入框写下想搜索的问题')
      return
    }
    setDraft('')
    await submitUserMessage({ text: normalized, requestReply: true, webSearchQuery: normalized })
  }

  /**
   * 「请求回复」：把截止到当前**全部**消息的历史送出，走与普通发送完全相同的生成链路。
   *
   * 一次请求处理的是整批未回复消息（SPEC §2.4.3）—— 用户连发三条后点一下就够了，
   * 不需要点三次。逐条补回复属于主动行为，P2 再说。
   */
  async function requestReply(): Promise<void> {
    if (sending || sessionId === undefined) return
    const summary = currentContextSummary()
    const list = summary === null ? messagesRef.current : await listMessages(sessionId)
    if (list.length === 0) return
    const lastUser = [...list].reverse().find((message) => message.role === 'user')
    await runGeneration(historyUpTo(list, list.length - 1, summary), null, {
      ...(lastUser === undefined ? {} : { interactionId: lastUser.id }),
    })
  }

  /** 语音条（SPEC §2.4.4）：与文本消息同一套发送规则，只是块是音频 */
  async function sendVoice(dataUrl: string, durationMs: number): Promise<void> {
    if (sending || mediaBusy) return
    setMediaBusy(true)
    let transcript: string | undefined
    let transcriptionFailed = false
    try {
      transcript = (await transcribeAudio(dataUrl)).text
      setErrorText(null)
    } catch (err) {
      transcriptionFailed = true
      log.warn('语音转写未完成', err)
      setErrorText(`语音已保留，但未转写：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setMediaBusy(false)
    }
    await submitUserMessage({
      text: '',
      blocks: [{ kind: 'audio', payload: { url: dataUrl, durationMs, ...(transcript === undefined ? {} : { transcript }) }, order: 0 }],
      requestReply: true,
    })
    if (transcriptionFailed) showToast('语音已发送，但未转写；原音仍可播放')
  }

  /** 通话模式的一轮：沿用普通语音消息与聊天生成链路，回复正文交给 CallPanel 朗读。 */
  async function callTurn(dataUrl: string, durationMs: number, onReplyChunk?: (text: string) => void): Promise<{ reply: string; transcript: string }> {
    if (sessionId === undefined) throw new Error('当前会话还没有准备好')
    if (sending || mediaBusy) throw new Error('当前正在处理上一轮，请稍候')
    setMediaBusy(true)
    setErrorText(null)
    try {
      let transcript: string
      try {
        transcript = (await transcribeAudio(dataUrl)).text.trim()
      } catch (error) {
        throw new Error(`通话转写失败：${error instanceof Error ? error.message : String(error)}`)
      }
      if (transcript === '') throw new Error('没有识别到清晰的语音，请再试一次')
      const reply = await submitUserMessage({
        text: '',
        blocks: [{ kind: 'audio', payload: { url: dataUrl, durationMs, transcript }, order: 0 }],
        requestReply: true,
        onReplyChunk,
      })
      return { reply: reply ?? '', transcript }
    } finally {
      setMediaBusy(false)
    }
  }

  /** 连续语音识别的最终句子：不伪造音频块，直接把真实转写作为普通用户消息留痕。 */
  async function callTurnText(text: string, onReplyChunk?: (chunk: string) => void): Promise<string> {
    const normalized = text.trim()
    if (normalized === '') throw new Error('没有识别到清晰的语音，请再试一次')
    if (sessionId === undefined) throw new Error('当前会话还没有准备好')
    if (sending || mediaBusy) throw new Error('当前正在处理上一轮，请稍候')
    setMediaBusy(true)
    setErrorText(null)
    try {
      return await submitUserMessage({ text: normalized, requestReply: true, onReplyChunk }) ?? ''
    } finally {
      setMediaBusy(false)
    }
  }

  async function sendImage(dataUrl: string): Promise<void> {
    if (sending || mediaBusy) return
    setMediaBusy(true)
    let description: string | undefined
    let visionFailed = false
    try {
      description = (await describeImage(dataUrl)).description
      setErrorText(null)
    } catch (err) {
      visionFailed = true
      log.warn('图片识别未完成', err)
      setErrorText(`图片已保留，但未识别：${err instanceof Error ? err.message : String(err)}`)
    } finally { setMediaBusy(false) }
    await submitUserMessage({
      text: '',
      blocks: [{ kind: 'image', payload: { url: dataUrl, ...(description === undefined ? {} : { alt: description }) }, order: 0 }],
      metadata: { imageSource: 'user' },
      requestReply: true,
    })
    if (visionFailed) showToast('图片已发送，但视觉识别未完成')
  }

  async function importSticker(file: File, options?: { name?: string; category?: string | null; tags?: string[] }): Promise<void> {
    try {
      const sticker = await createStickerFromFile(file, options)
      setStickers((prev) => [sticker, ...prev])
      showToast('表情包已加入图库')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  async function sendSticker(sticker: Sticker): Promise<void> {
    if (sending || mediaBusy || sessionId === undefined) return
    await submitUserMessage({
      text: '',
      blocks: [{
        kind: 'sticker',
        payload: {
          stickerId: sticker.id,
          name: sticker.name,
          imageDataUrl: sticker.imageDataUrl,
          mimeType: sticker.mimeType,
          source: '本地图库',
          tags: sticker.tags,
        },
        order: 0,
      }],
      requestReply: true,
    })
  }

  async function createGeneratedImage(prompt: string): Promise<void> {
    if (sessionId === undefined || sending || mediaBusy) return
    setMediaBusy(true); setErrorText(null)
    try {
      const result = await generateImage(prompt)
      const requestMessage = newMessage({ sessionId, role: 'user', text: `[生成图片] ${prompt}` })
      const message = newMessage({
        sessionId,
        role: 'assistant',
        metadata: { imageSource: 'generated' },
        blocks: [
          { kind: 'text', payload: { text: `已按描述生成图片：${prompt}` }, order: 0 },
          { kind: 'image', payload: { url: result.dataUrl, alt: prompt }, order: 1 },
        ],
      })
      await appendMessage(requestMessage); await appendMessage(message)
      setMessages((prev) => [...prev, requestMessage, message]); await touchSession(sessionId)
      autoCollectChatImages(message)
      showToast('图片已生成')
    } catch (err) {
      log.error('生成图片失败', err); setErrorText(err instanceof Error ? err.message : String(err))
    } finally { setMediaBusy(false) }
  }

  async function speakText(text: string): Promise<void> {
    if (text === '') return
    if (speechRef.current !== null) {
      speechRef.current.audio.pause(); URL.revokeObjectURL(speechRef.current.url); speechRef.current = null
    }
    setMediaBusy(true); setErrorText(null)
    try {
      const blob = await synthesizeSpeech(text)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      speechRef.current = { audio, url }
      audio.onended = () => { URL.revokeObjectURL(url); if (speechRef.current?.url === url) speechRef.current = null }
      audio.onerror = () => { URL.revokeObjectURL(url); if (speechRef.current?.url === url) speechRef.current = null }
      await audio.play(); showToast('正在朗读，再点“停止朗读”可停下')
    } catch (err) {
      if (speechRef.current !== null) {
        speechRef.current.audio.pause(); URL.revokeObjectURL(speechRef.current.url); speechRef.current = null
      }
      setErrorText(err instanceof Error ? err.message : String(err))
    } finally { setMediaBusy(false) }
  }

  async function speakMessage(message: ChatMessage): Promise<void> {
    await speakText(messageText(message))
  }

  function stopSpeaking(): void {
    if (speechRef.current === null) return
    speechRef.current.audio.pause(); URL.revokeObjectURL(speechRef.current.url); speechRef.current = null; showToast('已停止朗读')
  }

  async function appendToolResult(block: ToolResultBlock): Promise<void> {
    if (sessionId === undefined) return
    const message = newMessage({ sessionId, role: 'tool', blocks: [block] })
    await appendMessage(message); setMessages((prev) => [...prev, message]); await touchSession(sessionId)
  }

  /**
   * AI **自主发起**的一次工具调用（Phase 6.5）：与 Mini Terminal 的手动调用同一种块，
   * 区别是它由服务端的 `tool-call` 帧驱动，用户没点任何东西。
   *
   * 工具卡现在直接写入当轮助手消息的 blocks，与正文共享顺序；刷新后仍能还原「正文 → 工具 → 后续正文」。
   */
  async function appendToolCall(call: ChatToolCallPayload, hostMessageId: string | null = null, hostBlocks?: MessageBlock[]): Promise<void> {
    if (sessionId === undefined) return
    const block: ToolResultBlock = {
      kind: 'tool-result',
      payload: {
        toolName: call.name,
        ok: call.ok,
        summary: call.summary,
        source: call.source,
        label: call.label,
        ...(call.occurredAt === undefined ? {} : { occurredAt: call.occurredAt }),
        ...(call.detail === undefined ? {} : { result: call.detail }),
        // 挂起的事件 id：块里**必须**存下来，否则刷新后确认卡拿不到事件（只剩一句「等待确认」的文字）
        ...(call.eventId === undefined ? {} : { eventId: call.eventId }),
      },
      order: 0,
    }
    if (hostMessageId !== null && hostBlocks !== undefined) {
      // 工具卡属于同一次助手回复：直接插入同一消息块，渲染器按 order 保留真实发生顺序。
      hostBlocks.push({ ...block, order: hostBlocks.length })
    } else {
      const message = newMessage({ sessionId, role: 'tool', blocks: [block] })
      try {
        await appendMessage(message)
        setMessages((prev) => [...prev, message])
      } catch (err) {
        // 卡片没落库不该把回复本身作废（正文还在流）；但必须留痕，不能静默
        log.error('工具调用卡片落库失败', err)
      }
    }
    if (call.ok && call.stickerId !== undefined) {
      let sticker
      try {
        sticker = await getSticker(call.stickerId)
      } catch (err) {
        log.error('读取 AI 表情包失败', err)
        setErrorText('AI 选中的表情包读取失败，未发送')
        return
      }
      if (sticker === null) {
        setErrorText('AI 选中的表情包已不在本地图库中，未发送')
        return
      }
      const stickerMessage = newMessage({
        sessionId,
        role: 'assistant',
        blocks: [{
          kind: 'sticker',
          payload: {
            stickerId: sticker.id,
            name: sticker.name,
            imageDataUrl: sticker.imageDataUrl,
            mimeType: sticker.mimeType,
            source: 'AI 自主选择',
            tags: sticker.tags,
          },
          order: 0,
        }],
      })
      try {
        await appendMessage(stickerMessage)
      } catch (err) {
        log.error('保存 AI 表情包消息失败', err)
        setErrorText('AI 选中的表情包保存失败，未发送')
        return
      }
      setMessages((prev) => [...prev, stickerMessage])
      await touchSession(sessionId)
    }
    if (call.ok && call.readingAnnotation !== undefined) {
      const { bookId, paragraphIndex, text, note } = call.readingAnnotation
      try {
        const books = await listReadingNotes()
        const book = books.find((item) => item.id === bookId)
        const reader = book === undefined ? null : getReadingBook(book)
        if (book === undefined || reader === null) {
          setErrorText('AI 的共读批注找不到对应书籍，未写入本地书架')
          return
        }
        const duplicate = reader.annotations.some((annotation) => annotation.author === 'companion' && annotation.paragraphIndex === paragraphIndex && annotation.text === text && annotation.note === note)
        if (duplicate) {
          showToast('这条共读批注已经存在')
          return
        }
        const updated = await addReadingAnnotation(bookId, paragraphIndex, text, note, 'companion')
        const updatedReader = getReadingBook(updated)
        void appendReadingLifeEvent({
          eventType: 'reading.annotation',
          bookId,
          bookTitle: book.bookTitle,
          paragraphIndex,
          mode: 'reader',
          annotationAuthor: 'companion',
          ...(updatedReader === null ? {} : { readingSecondsTotal: updatedReader.readingSeconds }),
        }).catch((err) => log.error('记录 AI 共读批注 Life 事实失败', err))
        showToast(`小栖已在《${book.bookTitle}》留下批注`)
      } catch (err) {
        log.error('保存 AI 共读批注失败', err)
        setErrorText('AI 的共读批注保存失败')
      }
    }
    if (call.ok && call.readingNavigation !== undefined) {
      const { bookId, paragraphIndex } = call.readingNavigation
      try {
        const books = await listReadingNotes()
        const book = books.find((item) => item.id === bookId)
        const reader = book === undefined ? null : getReadingBook(book)
        const totalParagraphs = reader?.content.split('\n').length ?? 0
        if (book === undefined || reader === null || paragraphIndex < 0 || paragraphIndex >= totalParagraphs) {
          setErrorText('AI 的共读翻页位置无效，未改动本地进度')
          return
        }
        const updated = await updateReadingBookState(bookId, { currentParagraph: paragraphIndex })
        const updatedReader = getReadingBook(updated)
        void appendReadingLifeEvent({
          eventType: 'reading.progress',
          bookId,
          bookTitle: book.bookTitle,
          paragraphIndex,
          mode: 'reader',
          ...(updatedReader === null ? {} : {
            progressPercent: totalParagraphs <= 0 ? 0 : Math.round(((paragraphIndex + 1) / totalParagraphs) * 100),
            readingSecondsTotal: updatedReader.readingSeconds,
          }),
        }).catch((err) => log.error('记录 AI 共读翻页 Life 事实失败', err))
        showToast(`小栖把《${book.bookTitle}》翻到第 ${paragraphIndex + 1} 段`)
      } catch (err) {
        log.error('保存 AI 共读翻页失败', err)
        setErrorText('AI 的共读翻页保存失败')
      }
    }
    if (call.ok && call.readingVocabulary !== undefined) {
      const { bookId, paragraphIndex, term, note } = call.readingVocabulary
      try {
        const books = await listReadingNotes()
        const book = books.find((item) => item.id === bookId)
        const reader = book === undefined ? null : getReadingBook(book)
        if (book === undefined || reader === null) {
          setErrorText('AI 的共读生词找不到对应书籍，未写入本地书架')
          return
        }
        const duplicate = reader.vocabulary.some((word) => word.paragraphIndex === paragraphIndex && word.term === term)
        if (duplicate) {
          showToast(`「${term}」已经在生词本里`)
          return
        }
        const updated = await addReadingVocabulary(bookId, paragraphIndex, term, note)
        const updatedReader = getReadingBook(updated)
        void appendReadingLifeEvent({
          eventType: 'reading.vocabulary',
          bookId,
          bookTitle: book.bookTitle,
          paragraphIndex,
          mode: 'reader',
          ...(updatedReader === null ? {} : { readingSecondsTotal: updatedReader.readingSeconds }),
        }).catch((err) => log.error('记录 AI 共读生词 Life 事实失败', err))
        showToast(`小栖把「${term}」记进了《${book.bookTitle}》生词本`)
      } catch (err) {
        log.error('保存 AI 共读生词失败', err)
        setErrorText('AI 的共读生词保存失败')
      }
    }
    if (call.ok && call.readingVocabularyUpdate !== undefined) {
      const { bookId, vocabularyId, paragraphIndex, term, note } = call.readingVocabularyUpdate
      try {
        const books = await listReadingNotes()
        const book = books.find((item) => item.id === bookId)
        const reader = book === undefined ? null : getReadingBook(book)
        const word = reader?.vocabulary.find((item) => item.id === vocabularyId)
        if (book === undefined || reader === null || word === undefined) {
          setErrorText('AI 的共读生词解释找不到对应条目，未改动本地生词本')
          return
        }
        if (word.paragraphIndex !== paragraphIndex || word.term !== term) {
          setErrorText('AI 的共读生词解释锚点不匹配，未改动本地生词本')
          return
        }
        if (word.note === note) {
          showToast(`「${term}」的解释已经相同`)
          return
        }
        const updated = await updateReadingVocabulary(bookId, vocabularyId, note)
        const updatedReader = getReadingBook(updated)
        void appendReadingLifeEvent({
          eventType: 'reading.vocabulary',
          bookId,
          bookTitle: book.bookTitle,
          paragraphIndex,
          mode: 'reader',
          ...(updatedReader === null ? {} : { readingSecondsTotal: updatedReader.readingSeconds }),
        }).catch((err) => log.error('记录 AI 更新共读生词 Life 事实失败', err))
        showToast(`小栖补充了《${book.bookTitle}》里「${term}」的解释`)
      } catch (err) {
        log.error('保存 AI 更新共读生词失败', err)
        setErrorText('AI 的共读生词解释保存失败')
      }
    }
  }

  /** 重发：这一轮没拿到回复，按原样再跑一次（历史截止到那条用户消息） */
  async function resend(userMessageId: string): Promise<void> {
    if (sending) return
    const history = await buildHistoryThrough(userMessageId, messages)
    if (history.length === 0) return
    await runGeneration(history, null, { interactionId: userMessageId })
  }

  /** 换一个：重新生成同一条回复，旧正文进版本历史（可切回） */
  async function reroll(assistantMessageId: string): Promise<void> {
    if (sending) return
    const summary = currentContextSummary()
    const source = summary === null ? messages : (sessionId === undefined ? messages : await listMessages(sessionId))
    const index = source.findIndex((message) => message.id === assistantMessageId)
    // 截止到「这条回复之前那条用户消息」：把回复自己送回上游等于让它接着自己写，必然跑偏
    if (index <= 0 || source[index - 1]?.role !== 'user') return
    await runGeneration(historyUpTo(source, index - 1, summary), assistantMessageId)
  }

  async function selectVersion(messageId: string, index: number): Promise<void> {
    if (sending) return
    const updated = await selectCandidateVersion(messageId, index)
    if (updated !== null) {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)))
    }
  }

  /* ---------- 消息对象操作：菜单 / 编辑 / 撤回 / 多选（SPEC §2.3） ---------- */

  function showToast(text: string): void {
    setToast(text)
  }

  /** 关系事件也进入当前聊天时间线，但作为 system 记录，不会被当作普通上下文或回复。 */
  async function appendRelationshipTimeline(text: string, event: string): Promise<void> {
    if (sessionId === undefined) return
    const message = newMessage({
      sessionId,
      role: 'system',
      text,
      metadata: { relationshipEvent: event },
    })
    await appendMessage(message)
    setMessages((prev) => [...prev, message])
    await touchSession(sessionId)
  }

  async function handleRelationshipPoke(): Promise<void> {
    if (!online) { showToast('当前离线，暂时不能拍一拍'); return }
    try {
      const result = await pokeRelationship()
      setRelationship(result.snapshot)
      await appendRelationshipTimeline('你拍了拍小栖。', 'poke')
      showToast('已拍一拍，不会触发普通回复')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRelationshipPause(): Promise<void> {
    if (!online) { showToast('当前离线，暂时不能暂停聊天'); return }
    try {
      const snapshot = await pauseRelationship(undefined, 60)
      setRelationship(snapshot)
      await appendRelationshipTimeline('你暂时暂停了聊天（最长 60 分钟）。系统通知与恢复申请仍可达。', 'paused')
      showToast('聊天已暂停，60 分钟内自动恢复')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRelationshipRecoveryRequest(): Promise<void> {
    if (!online) { showToast('当前离线，暂时不能申请恢复'); return }
    try {
      const result = await requestRelationshipRecovery()
      setRelationship(result.snapshot)
      await appendRelationshipTimeline('你申请恢复聊天，等待小栖决定。', 'recovery-requested')
      showToast('恢复申请已送出')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRelationshipDecision(id: string, decision: 'approve' | 'deny'): Promise<void> {
    if (!online) { showToast('当前离线，暂时不能处理申请'); return }
    try {
      const snapshot = await decideRelationshipRecovery(id, decision)
      setRelationship(snapshot)
      await appendRelationshipTimeline(decision === 'approve' ? '你同意了小栖的恢复申请，聊天已恢复。' : '你拒绝了小栖的恢复申请，暂停仍然有效。', `recovery-${decision}`)
      showToast(decision === 'approve' ? '聊天已恢复' : '已拒绝恢复申请')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  /** 把仓储层返回的新记录贴回列表；null 表示那条消息已经不在了，静默忽略 */
  function applyMessage(updated: ChatMessage | null): void {
    if (updated === null) return
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
  }

  function exitSelectMode(): void {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 当前菜单该显示哪些项 —— 随对象类型与状态动态变化（SPEC §2.3.3）。
   * 撤回态只剩「恢复」与「删除」：正文已经不在界面上，谈「编辑 / 复制」没有意义。
   */
  const sheetActions = useMemo<SheetAction[] | null>(() => {
    if (sheetFor === null) return null
    const message = messages.find((m) => m.id === sheetFor)
    if (message === undefined) return null
    const isUser = message.role === 'user'
    const isLast = messages[messages.length - 1]?.id === message.id
    const hasText = messageText(message) !== ''
    const hasCopyText = copyableText(message) !== ''
    const hasImage = message.blocks.some((block) => block.kind === 'image')
    const index = messages.findIndex((m) => m.id === message.id)

    if (message.recalledAt !== null) {
      return [
        { id: 'restore', label: '恢复这条消息' },
        { id: 'delete', label: '删除', danger: true },
      ]
    }

    const items: SheetAction[] = []
    if (hasCopyText) items.push({ id: 'copy', label: hasText ? '复制' : '复制转写文本' })
    if (message.candidates.length > 1) items.push({ id: 'delete-version', label: '删除当前候选版本', danger: true })
    // 「停止朗读」是纯本地动作，离线也留着；「朗读」要打 TTS 接口，离线时干脆不给这一项
    if (!isUser && hasText) {
      const speaking = speechRef.current !== null
      if (speaking || online) items.push({ id: speaking ? 'stop-speech' : 'speak', label: speaking ? '停止朗读' : '朗读' })
    }
    items.push({ id: 'edit', label: '编辑' })
    items.push({ id: 'bookmark', label: '收藏' })
    items.push({ id: 'artwork', label: '收录至作品' })
    if (hasImage) items.push({ id: 'album', label: '加入相册' })
    items.push({ id: 'multi', label: '多选' })
    // SPEC §2.3.3：AI 消息按当前状态追加「换一个 / 重发 / 切换历史候选」
    if (!isUser && isLast && hasText && online) items.push({ id: 'reroll', label: '换一个' })
    if (isUser && isLast && online) items.push({ id: 'resend', label: '重发' })
    // SPEC §2.3.4：编辑用户消息后，截断其后内容并重生成必须是**显式**动作
    if (isUser && !isLast && index >= 0 && index < messages.length - 1 && online) {
      items.push({ id: 'regenerate', label: '从这条重新生成' })
    }
    items.push({ id: 'recall', label: '撤回' })
    items.push({ id: 'delete', label: '删除', danger: true })
    return items
  }, [sheetFor, messages, online])

  async function runSheetAction(actionId: string): Promise<void> {
    const id = sheetFor
    setSheetFor(null)
    if (id === null) return
    const index = messages.findIndex((m) => m.id === id)
    const message = index < 0 ? undefined : messages[index]
    if (message === undefined) return

    switch (actionId) {
      case 'copy': {
        try {
          await navigator.clipboard.writeText(copyableText(message))
          showToast('已复制')
        } catch (err) {
          // 非安全上下文 / 权限被拒时剪贴板不可用。明确告诉用户，而不是静默失败
          log.error('复制失败', err)
          setErrorText('复制失败：浏览器拒绝了剪贴板写入')
        }
        break
      }
      case 'speak':
        await speakMessage(message)
        break
      case 'stop-speech':
        stopSpeaking()
        break
      case 'edit':
        setEditingId(id)
        setEditDraft(messageText(message))
        break
      case 'delete-version': {
        const selected = message.candidates.findIndex((candidate) => candidate.selected)
        const updated = await removeCandidateVersion(id, selected)
        if (updated === null) {
          setErrorText('当前候选版本无法删除，至少需要保留一版')
        } else {
          setMessages((prev) => prev.map((item) => item.id === id ? updated : item))
          showToast('已删除当前候选版本')
        }
        break
      }
      case 'bookmark':
        try {
          const created = await createMessageBookmark(message)
          void appendBookmarkLifeEvent({ eventType: 'bookmark.created', bookmarkId: created.id, targetType: created.targetType, title: created.title }).catch(() => undefined)
          setErrorText(null)
          showToast('已加入收藏')
        } catch (err) {
          // 重复收藏属于用户可恢复的业务反馈，不应污染「控制台零异常」基线
          log.warn('收藏消息未完成', err)
          setErrorText(err instanceof Error ? err.message : String(err))
        }
        break
      case 'artwork':
        try {
          await createMessageArtwork(message)
          setErrorText(null)
          showToast('已收录至作品')
        } catch (err) {
          log.warn('收录消息至作品未完成', err)
          setErrorText(err instanceof Error ? err.message : String(err))
        }
        break
      case 'album':
        try {
          const result = await createMessagePhotos(message)
          setErrorText(null)
          const suffix = result.skipped > 0 ? `，${result.skipped} 张已存在` : ''
          showToast(`已加入相册 ${result.added.length} 张${suffix}`)
        } catch (err) {
          log.warn('聊天图片加入相册未完成', err)
          setErrorText(err instanceof Error ? err.message : String(err))
        }
        break
      case 'multi':
        setSelectMode(true)
        setSelectedIds(new Set([id]))
        break
      case 'reroll':
        await reroll(id)
        break
      case 'resend':
        await resend(id)
        break
      case 'recall':
        setPendingConfirm({
          kind: 'recall',
          ids: [id],
          text: '撤回这条消息？撤回后它不再进入对话上下文，但可以恢复。',
        })
        break
      case 'restore': {
        applyMessage(await restoreMessage(id))
        showToast('已恢复')
        break
      }
      case 'regenerate': {
        const following = messages.slice(index + 1)
        setPendingConfirm({
          kind: 'regenerate',
          ids: following.map((m) => m.id),
          text: `从这条重新生成？会移除其后的 ${following.length} 条消息，且不可恢复。`,
          anchorId: id,
        })
        break
      }
      case 'delete':
        setPendingConfirm({ kind: 'delete', ids: [id], text: '删除这条消息？此操作不可恢复。' })
        break
      default:
        break
    }
  }

  async function confirmPending(): Promise<void> {
    const pending = pendingConfirm
    if (pending === null) return
    setPendingConfirm(null)
    try {
      if (pending.kind === 'recall') {
        for (const id of pending.ids) applyMessage(await recallMessage(id))
        showToast('已撤回')
        return
      }
      if (pending.kind === 'regenerate') {
        // 先把历史算出来再删：删完 `messages` 就成了被截断的那份，没法再当上下文用
        const summary = currentContextSummary()
        const source = summary === null || sessionId === undefined ? messages : await listMessages(sessionId)
        const anchorIndex = source.findIndex((message) => message.id === pending.anchorId)
        if (anchorIndex < 0) throw new Error('找不到重新生成的原消息')
        const history = historyUpTo(source, anchorIndex, summary)
        await deleteMessages(pending.ids)
        setMessages((prev) => prev.filter((m) => !pending.ids.includes(m.id)))
        exitSelectMode()
        await runGeneration(history, null)
        return
      }
      await deleteMessages(pending.ids)
      setMessages((prev) => prev.filter((m) => !pending.ids.includes(m.id)))
      showToast(pending.ids.length > 1 ? `已删除 ${pending.ids.length} 条` : '已删除')
      exitSelectMode()
    } catch (err) {
      log.error('消息操作失败', err)
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  /** 生成一份可恢复的历史摘要：保留最近一小段原始消息，旧消息永不删除。 */
  async function compactContext(): Promise<void> {
    if (sessionId === undefined || contextCompacting || sending) return
    setContextCompacting(true)
    setErrorText(null)
    try {
      const all = await listMessages(sessionId)
      const archiveEnd = all.length - COMPACT_KEEP_RECENT - 1
      if (archiveEnd + 1 < COMPACT_MIN_ARCHIVE) {
        throw new Error(`消息还不够压缩：至少需要 ${COMPACT_MIN_ARCHIVE + COMPACT_KEEP_RECENT} 条消息`)
      }
      const archived = all.slice(0, archiveEnd + 1)
      const history = historyUpTo(all, archiveEnd)
      if (history.length === 0) throw new Error('较早消息没有可用于摘要的正文')
      const result = await compactChatContext(history)
      const first = archived[0]
      const last = archived[archived.length - 1]
      if (first === undefined || last === undefined) throw new Error('无法确定摘要覆盖范围')
      const now = Date.now()
      const updated = await saveContextSummary(sessionId, {
        id: crypto.randomUUID(),
        text: result.summary,
        coveredFromMessageId: first.id,
        coveredToMessageId: last.id,
        coveredMessageCount: archived.length,
        coveredFrom: first.createdAt,
        coveredTo: last.createdAt,
        generatedAt: now,
        updatedAt: now,
        model: result.model,
        profileId: result.profileId,
        version: 1,
        source: 'model',
      })
      if (updated === null) throw new Error('会话不存在或已被删除')
      setSession(updated)
      showToast(`已压缩较早的 ${archived.length} 条消息，最近 ${COMPACT_KEEP_RECENT} 条仍保留原文`)
    } catch (err) {
      log.error('上下文压缩失败', err)
      setErrorText(err instanceof Error ? err.message : String(err))
    } finally {
      setContextCompacting(false)
    }
  }

  async function editSummary(summaryId: string, text: string): Promise<void> {
    if (sessionId === undefined) return
    try {
      const updated = await editContextSummary(sessionId, summaryId, text)
      if (updated === null) throw new Error('会话不存在或已被删除')
      setSession(updated)
      showToast('摘要已保存，后续回复会使用新内容')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  async function setSummaryActive(summaryId: string | null): Promise<void> {
    if (sessionId === undefined) return
    try {
      const updated = await setContextSummaryActive(sessionId, summaryId)
      if (updated === null) throw new Error('会话不存在或已被删除')
      setSession(updated)
      showToast(summaryId === null ? '已停用历史摘要，后续回复使用原始消息' : '已恢复这版摘要')
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 保存编辑。以气泡自带的 id 为准（而不是页面级的 `editingId`）——
   * 两者本该一致，但万一编辑期间会话切了，写错地方比写不进去糟得多。
   *
   * 只改这一条，**不碰后续** —— SPEC §2.3.4 定的是「不自动删除、不自动重生成后续」；
   * 要截断后续得走菜单里的「从这条重新生成」，那是个显式动作。
   */
  async function saveEditFor(id: string): Promise<void> {
    const text = editDraft
    setEditingId(null)
    setEditDraft('')
    try {
      applyMessage(await editMessage(id, text))
    } catch (err) {
      log.error('编辑消息失败', err)
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveSettings(input: Parameters<typeof updateSessionSettings>[1]): Promise<void> {
    if (sessionId === undefined) return
    setSettingsSaving(true)
    try {
      const updated = await updateSessionSettings(sessionId, input)
      if (updated === null) throw new Error('会话不存在或已被删除')
      setSession(updated)
      setSettingsOpen(false)
      setErrorText(null)
      showToast('聊天设置已保存')
    } catch (err) {
      log.error('保存聊天设置失败', err)
      setErrorText(err instanceof Error ? err.message : String(err))
    } finally {
      setSettingsSaving(false)
    }
  }

  function navigateHistory(targetSessionId: string, messageId: string): void {
    if (targetSessionId !== sessionId) return
    setHistoryOpen(false)
    const next = new URLSearchParams(searchParams)
    next.set('focus', messageId)
    setSearchParams(next, { replace: true })
  }

  const items = useMemo<ChatItem[]>(() => {
    const now = Date.now()
    return messages.map((message, index) => {
      // 跨天才插日期分隔。判据用**自然日**而不是毫秒差：今天 00:10 与昨天 23:50 只差 20 分钟，
      // 但它们不是同一天 —— 用毫秒差会把它归成一天，分隔永远不出现。
      const previous = index === 0 ? null : messages[index - 1]
      const crossDay = previous === null || !isSameDay(previous.createdAt, message.createdAt)
      return {
        message,
        text: messageText(message),
        isLast: index === messages.length - 1,
        dayLabel: crossDay ? formatDayLabel(message.createdAt, now) : null,
      }
    })
  }, [messages])

  // 刻意不做 memo：这些回调都读最新 state，缓存住反而会闭包读到旧数组
  const actions: BubbleActions = {
    busy: sending,
    selectMode,
    editDraft,
    onReroll: (id) => void reroll(id),
    onResend: (id) => void resend(id),
    onSelectVersion: (id, index) => void selectVersion(id, index),
    onOpenMenu: (id) => setSheetFor(id),
    onToggleSelect: toggleSelect,
    onEditDraftChange: setEditDraft,
    onEditSave: (id) => void saveEditFor(id),
    onEditCancel: () => {
      setEditingId(null)
      setEditDraft('')
    },
  }

  const renderItem = useCallback(
    (item: ChatItem) => (
      <ChatBubble
        item={item}
        actions={actions}
        selected={selectedIds.has(item.message.id)}
        editing={editingId === item.message.id}
        highlighted={highlightedMessageId === item.message.id}
        bubbleMode={session?.bubbleMode ?? 'chat'}
        showCompanionAvatar={showCompanionAvatar}
        showUserAvatar={showUserAvatar}
      />
    ),
    // actions 每次渲染都是新对象（刻意为之），所以这里等于「总是重渲」——正是我们要的
    [actions, selectedIds, editingId, highlightedMessageId, session?.bubbleMode, showCompanionAvatar, showUserAvatar],
  )

  const unrepliedCount = useMemo(() => countUnreplied(messages), [messages])

  /**
   * 顶栏第二行的状态文案。**只说真话** ——
   * 设计稿那里写的是「在线 · 正在听雨」，但栖息地并没有「听雨」这件事，
   * 照抄就等于在界面上凭空宣称一个不存在的状态。这里换成三个真实状态。
   */
  const statusText = !online ? '离线' : sending ? '正在回复…' : '在线'
  const relationshipPaused = relationship?.state.status === 'paused'
  const pendingCompanionRecovery = relationship?.requests.find((request) => request.status === 'pending' && request.decider === 'user') ?? null
  const remainingMinutes = relationship?.state.expiresAt === null || relationship?.state.expiresAt === undefined
    ? null
    : Math.max(1, Math.ceil((relationship.state.expiresAt - Date.now()) / 60_000))

  return (
    <div className="flex h-full min-h-0 flex-col" data-page="chat">
      {/*
        低存在感顶栏（设计 §9.2）：头像 + 名字 + 状态点，没有实线分隔、没有底色。
        ⚠️ 与设计稿的两处差异，都是栖息地的真实需要：
        ① 左侧多一个返回 —— 会话页是沉浸式路由（不显示底栏），这里是**唯一**的回程入口；
        ② 右侧保留「工具 / 设置」两个入口（设计稿没有），它们对应 Mini Terminal 与聊天设置，
           是既有能力，不能因为换皮就丢掉。
        ⚠️ 顶栏那个头像**不是**消息头像（`inMessage={false}`）：它不受「显示头像」开关管辖，
           也不该被验收里「数消息头像个数」的断言算进去。
      */}
      <header className="topbar" data-testid="chat-topbar">
        <Link to="/chat" data-testid="chat-back" aria-label="返回会话列表" className="icon-btn">
          <IconChevronLeft size={20} />
        </Link>
        <MessageAvatar role="assistant" size={36} inMessage={false} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="topbar-title truncate">
            {session === undefined ? '加载中…' : (session?.title ?? '会话不存在')}
          </h1>
          <span className="topbar-status" data-testid="chat-status" data-online={String(online)}>
            {/* 离线时点要**退成灰色**：绿色脉冲点配「离线」两个字，是把两件相反的事说在一起 */}
            <span
              className={`dot${online ? ' pulse' : ''}`}
              style={online ? undefined : { backgroundColor: 'var(--text-tertiary)' }}
            />
            {statusText}
          </span>
        </div>
        <button
          type="button"
          data-testid="chat-history-open"
          aria-label="搜索当前会话"
          onClick={() => setHistoryOpen(true)}
          className="icon-btn"
        >
          <IconSearch size={18} />
        </button>
        <button
          type="button"
          data-testid="mini-terminal-open"
          aria-label="打开工具面板"
          onClick={() => setTerminalOpen(true)}
          className="icon-btn"
        >
          <IconToolbox size={19} />
        </button>
        <button
          type="button"
          data-testid="chat-call-open"
          aria-label="开始通话"
          disabled={!online || session === undefined || session === null || sending || mediaBusy}
          onClick={() => setCallOpen(true)}
          className="icon-btn disabled:opacity-40"
        >
          <IconMic size={19} />
        </button>
        <button
          type="button"
          data-testid="chat-call-history-open"
          aria-label="通话记录"
          disabled={session === undefined || session === null}
          onClick={() => setCallHistoryOpen(true)}
          className="icon-btn disabled:opacity-40"
        >
          <IconClock size={18} />
        </button>
        <button
          type="button"
          data-testid="chat-settings-open"
          aria-label="聊天设置"
          disabled={session === undefined || session === null}
          onClick={() => setSettingsOpen(true)}
          className="icon-btn disabled:opacity-40"
        >
          <IconSetting size={19} />
        </button>
      </header>

      <section
        data-testid="relationship-bar"
        className="mx-3 mt-2 flex shrink-0 flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-xs"
        style={{
          backgroundColor: relationshipPaused ? 'color-mix(in srgb, var(--accent-soft) 76%, var(--bg-card))' : 'var(--bg-subtle)',
          color: 'var(--text-secondary)',
        }}
      >
        {relationshipPaused ? (
          <>
            <span className="flex-1 min-w-[180px]">
              聊天暂时暂停 · {relationship?.state.pausedBy === 'companion' ? '小栖发起' : '你发起'}
              {remainingMinutes === null ? '' : ` · 约 ${remainingMinutes} 分钟后自动恢复`}
            </span>
            {pendingCompanionRecovery !== null ? (
              <>
                <span>小栖申请恢复：</span>
                <button type="button" className="btn-pill btn-strong" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }} onClick={() => void handleRelationshipDecision(pendingCompanionRecovery.id, 'approve')}>同意</button>
                <button type="button" className="btn-pill btn-ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }} onClick={() => void handleRelationshipDecision(pendingCompanionRecovery.id, 'deny')}>拒绝</button>
              </>
            ) : (
              <button
                type="button"
                data-testid="relationship-recovery"
                className="btn-pill btn-ghost"
                style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }}
                onClick={() => void handleRelationshipRecoveryRequest()}
              >
                申请恢复
              </button>
            )}
          </>
        ) : (
          <>
            <span className="flex-1 min-w-[120px]">关系互动</span>
            <button type="button" data-testid="relationship-poke" className="btn-pill btn-ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }} onClick={() => void handleRelationshipPoke()}>拍一拍</button>
            <button type="button" data-testid="relationship-pause" className="btn-pill btn-ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }} onClick={() => void handleRelationshipPause()}>暂时拒绝回复</button>
          </>
        )}
      </section>

      {historyOpen && (
        <ChatHistoryPanel
          scope="session"
          sessionId={sessionId}
          onClose={() => setHistoryOpen(false)}
          onNavigate={navigateHistory}
        />
      )}

      {callHistoryOpen && sessionId !== undefined && (
        <CallHistoryPanel chatSessionId={sessionId} onClose={() => setCallHistoryOpen(false)} onPlayText={(text) => void speakText(text)} />
      )}

      <div
        data-testid="chat-message-area"
        className="relative min-h-0 flex-1"
        style={{ backgroundColor: session?.background ?? 'transparent' }}
      >
        {terminalOpen && <MiniTerminal onClose={() => setTerminalOpen(false)} onResult={(block) => void appendToolResult(block)} />}
        <VirtualList
          items={items}
          getKey={itemKey}
          renderItem={renderItem}
          scrollToKey={highlightedMessageId}
          // 估值只影响「还没被测量过」的行。换装后一条消息 = 上下内边距 22 + 气泡 46 + 时间行 20，
          // 估值贴近真实高度能少几次「滚起来忽长忽短」的抖动
          estimateHeight={96}
          onReachTop={() => void loadEarlier()}
          onReachBottom={() => void loadLater()}
          className={`chat-scroll is-virtual h-full${entering ? ' is-entering' : ''}`}
        />
        {(loadingEarlier || loadingLater) && (
          <div
            className="chip pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-xs"
          >
            {loadingEarlier ? '正在加载更早的消息…' : '正在加载较新的消息…'}
          </div>
        )}
      </div>

      {items.length === 0 && (
        <div className="pb-4 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
          和小栖说点什么吧
        </div>
      )}

      {errorText !== null && (
        <div className="shrink-0 px-4 pb-2 text-center text-xs" style={{ color: 'var(--danger)' }}>
          {errorText}
        </div>
      )}

      {/* 二次确认条：撤回 / 删除 / 重新生成 三个入口共用。刻意不自动作废 ——
          用户正在读确认语时按钮自己消失，比多留一会儿更恼人 */}
      {pendingConfirm !== null && (
        <div
          data-testid="confirm-bar"
          className="card mx-3 mb-1 flex shrink-0 items-center gap-3"
          style={{ padding: '10px 14px' }}
        >
          <span data-testid="confirm-text" className="flex-1 text-xs">
            {pendingConfirm.text}
          </span>
          <button
            type="button"
            data-testid="confirm-yes"
            onClick={() => void confirmPending()}
            className="btn-pill btn-danger shrink-0"
            style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}
          >
            确认
          </button>
          <button
            type="button"
            data-testid="confirm-no"
            onClick={() => setPendingConfirm(null)}
            className="btn-pill btn-ghost shrink-0"
            style={{ minHeight: 32, padding: '0 16px', fontSize: 12.5 }}
          >
            取消
          </button>
        </div>
      )}

      {selectMode ? (
        <div
          data-testid="select-bar"
          className="card mx-3 mb-1 flex shrink-0 items-center gap-3"
          style={{ padding: '10px 14px' }}
        >
          <span data-testid="select-count" className="flex-1 text-sm">
            已选 {selectedIds.size} 项
          </span>
          <button
            type="button"
            data-testid="select-delete"
            disabled={selectedIds.size === 0}
            onClick={() =>
              setPendingConfirm({
                kind: 'delete',
                ids: [...selectedIds],
                text: `删除选中的 ${selectedIds.size} 条消息？此操作不可恢复。`,
              })
            }
            className="btn-pill btn-danger shrink-0 disabled:opacity-40"
            style={{ minHeight: 32, padding: '0 16px', fontSize: 13 }}
          >
            删除
          </button>
          <button
            type="button"
            data-testid="select-cancel"
            onClick={exitSelectMode}
            className="btn-pill btn-ghost shrink-0"
            style={{ minHeight: 32, padding: '0 16px', fontSize: 13 }}
          >
            取消
          </button>
        </div>
      ) : (
        <>
          {/* 待回复提示条（SPEC §2.4.3）：把「还有几条没被回复」摆到明面上。
              只靠快捷栏那个数字，用户很容易根本没注意到自己按了「只发送」 */}
          {unrepliedCount > 0 && (
            <div
              data-testid="unreplied-hint"
              className="flex shrink-0 justify-center px-3 pt-2"
            >
              <span className="chip text-xs">
                {unrepliedCount} 条消息还没请求回复
              </span>
            </div>
          )}
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            sending={sending || mediaBusy || callOpen}
            interactionDisabled={relationshipPaused}
            unrepliedCount={unrepliedCount}
            onSend={(text, options) => void send(text, options)}
            onRequestReply={() => void requestReply()}
            onSendVoice={(dataUrl, durationMs) => void sendVoice(dataUrl, durationMs)}
            onSendImage={(dataUrl) => void sendImage(dataUrl)}
            onGenerateImage={(prompt) => void createGeneratedImage(prompt)}
            onWebSearch={(query) => void webSearch(query)}
            stickers={stickers}
            onSendSticker={(sticker) => void sendSticker(sticker)}
            onImportSticker={(file, options) => void importSticker(file, options)}
            onAbort={() => abortRef.current?.abort()}
            onError={setErrorText}
          />
        </>
      )}

      {toast !== null && (
        <div
          data-testid="toast"
          className="chip pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2"
        >
          {toast}
        </div>
      )}

      {settingsOpen && session !== undefined && session !== null && (
        <ChatSettingsSheet
          session={session}
          saving={settingsSaving}
          contextMessageCount={contextMessageCount}
          contextTokenEstimate={Math.ceil(contextCharacterCount / 4)}
          contextState={getContextCompression(session)}
          compacting={contextCompacting}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onCompact={() => void compactContext()}
          onEditSummary={(summaryId, text) => void editSummary(summaryId, text)}
          onSetSummaryActive={(summaryId) => void setSummaryActive(summaryId)}
        />
      )}

      <CallPanel
        open={callOpen}
        disabled={!online || session === undefined || session === null || sending || mediaBusy}
        chatSessionId={sessionId ?? ''}
        incomingCallId={incomingCallId}
        onClose={() => {
          setCallOpen(false)
          if (incomingCallId !== null) {
            const next = new URLSearchParams(searchParams)
            next.delete('call')
            setSearchParams(next, { replace: true })
          }
        }}
        onTurn={callTurn}
        onTurnText={callTurnText}
        onError={setErrorText}
      />

      <ActionSheet
        actions={sheetActions}
        onSelect={(id) => void runSheetAction(id)}
        onClose={() => setSheetFor(null)}
      />
    </div>
  )
}
