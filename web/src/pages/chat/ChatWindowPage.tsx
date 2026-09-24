import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ChatToolCallPayload } from '@shared/events'
import type { LlmChatMessage } from '@shared/providers'
import type { ChatMessage, ChatSession, MessageBlock, MessageStatus, ToolResultBlock } from '@shared/types'
import { VirtualList } from '../../components/VirtualList'
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
import { MiniTerminal } from '../../features/chat/MiniTerminal'
import {
  createMessageArtwork,
  createMessageBookmark,
  createMessagePhotos,
} from '../../db/home'
import {
  addVersion,
  appendMessage,
  capReasoning,
  deleteMessage,
  deleteMessages,
  editMessage,
  getSession,
  listMessagesPage,
  messageText,
  newMessage,
  recallMessage,
  restoreMessage,
  selectCandidateVersion,
  textBlock,
  touchSession,
  updateMessage,
  updateSessionSettings,
} from '../../db/chat'
import { ApiRequestError } from '../../lib/api'
import { streamChat } from '../../lib/chatStream'
import { formatDuration } from '../../lib/format'
import { log } from '../../lib/log'
import { describeImage, generateImage, synthesizeSpeech, transcribeAudio } from '../../lib/media'
import { useOnlineStatus } from '../../features/offline/useOnlineStatus'

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
function historyUpTo(messages: ChatMessage[], upToIndex: number): LlmChatMessage[] {
  return messages
    .slice(0, upToIndex + 1)
    .filter((message) => message.recalledAt === null)
    .map((message): LlmChatMessage => ({
      // Mini Terminal 是用户直接调用，不对应上游 LLM 的 tool_call_id；投影成 assistant 摘要，
      // 避免发送一条协议不完整的 role=tool 消息被 OpenAI 兼容端拒绝。
      role: message.role === 'tool' ? 'assistant' : message.role,
      content: messageText(message) || mediaContext(message),
    }))
    .filter((message) => message.content !== '')
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
  return ''
}

function copyableText(message: ChatMessage): string {
  const plain = messageText(message)
  if (plain !== '') return plain
  const audio = message.blocks.find((block) => block.kind === 'audio')
  return audio?.kind === 'audio' ? audio.payload.transcript?.trim() ?? '' : ''
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
  | { kind: 'regenerate'; ids: string[]; text: string; index: number }

export function ChatWindowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<ChatSession | null | undefined>(undefined)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)

  /** 全局显示偏好（SPEC §9.1.3）：头像开关。在这里读一次再往下传，气泡保持纯展示组件 */
  const showAvatars = useChatDisplay((state) => state.showAvatars)

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
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  /**
   * 同步守卫：`onReachTop` 在贴顶时会连着触发好几次，而 `setLoadingEarlier` 生效要等下一帧 ——
   * 只靠 state 拦不住重复请求。
   */
  const loadingEarlierRef = useRef(false)
  /** 供回调读最新消息列表，避免闭包读到旧数组 */
  const messagesRef = useRef<ChatMessage[]>([])
  const toastTimerRef = useRef<number | null>(null)
  const speechRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null)

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
    let cancelled = false
    void (async () => {
      try {
        const [loaded, page] = await Promise.all([
          getSession(sessionId),
          listMessagesPage(sessionId, PAGE_SIZE),
        ])
        if (cancelled) return
        setSession(loaded)
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
        // 拉满一页说明前面可能还有；不满则已知到底
        setHasMore(page.length === PAGE_SIZE)
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
  }, [sessionId])

  // 离开页面即中止在跑的流，避免白烧 token
  useEffect(
    () => () => {
      abortRef.current?.abort()
      speechRef.current?.audio.pause()
      if (speechRef.current !== null) URL.revokeObjectURL(speechRef.current.url)
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

  /**
   * 一轮生成的完整生命周期：发送 / 重发 / 换一个 三条路共用，差别只在「结果写到哪」。
   * `targetId` 为空 = 新回复（先落一条 streaming 草稿，节流更新，收尾定性）；
   * 有值 = 给那条消息加一个版本（换一个，收尾才写，中间不写库）。
   */
  async function runGeneration(history: LlmChatMessage[], targetId: string | null): Promise<void> {
    if (sessionId === undefined) return
    const controller = new AbortController()
    abortRef.current = controller
    setSending(true)
    setErrorText(null)

    // 累加用局部变量而不是 state：回调里读 state 只会拿到闭包里的旧值
    let content = ''
    let reasoning = ''
    let failure: string | null = null

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
      const patch = {
        blocks: [textBlock(content)],
        ...(reasoning === '' ? {} : { metadata: { reasoning: capReasoning(reasoning) } }),
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
      await streamChat(
        { messages: history },
        {
          onDelta: (delta) => {
            if (delta.content !== undefined) content += delta.content
            if (delta.reasoning !== undefined) reasoning += delta.reasoning
            void flushDraft()
          },
          onToolCall: (call) => {
            void appendToolCall(call)
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
        const updated = await addVersion(targetId, { content, status, reasoning })
        if (updated !== null) {
          setMessages((prev) => prev.map((m) => (m.id === targetId ? updated : m)))
        }
      }
    } else if (draftId !== null) {
      if (content !== '') {
        // 收尾定性：内容 + 状态一次写回，刷新后这轮的成果完整可见
        const finalPatch = {
          blocks: [textBlock(content)],
          status,
          ...(reasoning === '' ? {} : { metadata: { reasoning: capReasoning(reasoning) } }),
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
    requestReply: boolean
    /** 「只发送」时给用户的确认语；语音条有自己的一句 */
    toast?: string
  }): Promise<void> {
    if (sessionId === undefined) return

    // 1. 用户消息先落库（本地权威，§6.2），不等模型
    const userMessage = newMessage({
      sessionId,
      role: 'user',
      text: input.text,
      ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
    })
    await appendMessage(userMessage)
    setMessages((prev) => [...prev, userMessage])
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
      return
    }

    // 3. 历史由前端组装随请求送出（服务端不存聊天记录）
    await runGeneration(historyUpTo([...messagesRef.current, userMessage], messagesRef.current.length), null)
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

  /**
   * 「请求回复」：把截止到当前**全部**消息的历史送出，走与普通发送完全相同的生成链路。
   *
   * 一次请求处理的是整批未回复消息（SPEC §2.4.3）—— 用户连发三条后点一下就够了，
   * 不需要点三次。逐条补回复属于主动行为，P2 再说。
   */
  async function requestReply(): Promise<void> {
    if (sending || sessionId === undefined) return
    const list = messagesRef.current
    if (list.length === 0) return
    await runGeneration(historyUpTo(list, list.length - 1), null)
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
      requestReply: true,
    })
    if (visionFailed) showToast('图片已发送，但视觉识别未完成')
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
        blocks: [
          { kind: 'text', payload: { text: `已按描述生成图片：${prompt}` }, order: 0 },
          { kind: 'image', payload: { url: result.dataUrl, alt: prompt }, order: 1 },
        ],
      })
      await appendMessage(requestMessage); await appendMessage(message)
      setMessages((prev) => [...prev, requestMessage, message]); await touchSession(sessionId)
      showToast('图片已生成')
    } catch (err) {
      log.error('生成图片失败', err); setErrorText(err instanceof Error ? err.message : String(err))
    } finally { setMediaBusy(false) }
  }

  async function speakMessage(message: ChatMessage): Promise<void> {
    const text = messageText(message)
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
   * ⚠️ 已知的呈现局限（P1 处理，已记 TASKS）：卡片总是排在当轮助手气泡**之后**。
   * 模型若在工具调用**之后**又说了话，那段话会被并进同一个气泡、显示在卡片上方，
   * 顺序与真实发生的时间相反。要修得把「一次回复」拆成多段气泡，属于消息模型改动，
   * 不在本轮范围。
   */
  async function appendToolCall(call: ChatToolCallPayload): Promise<void> {
    if (sessionId === undefined) return
    const block: ToolResultBlock = {
      kind: 'tool-result',
      payload: {
        toolName: call.name,
        ok: call.ok,
        summary: call.summary,
        source: call.source,
        label: call.label,
        ...(call.detail === undefined ? {} : { result: call.detail }),
        // 挂起的事件 id：块里**必须**存下来，否则刷新后确认卡拿不到事件（只剩一句「等待确认」的文字）
        ...(call.eventId === undefined ? {} : { eventId: call.eventId }),
      },
      order: 0,
    }
    const message = newMessage({ sessionId, role: 'tool', blocks: [block] })
    try {
      await appendMessage(message)
      setMessages((prev) => [...prev, message])
    } catch (err) {
      // 卡片没落库不该把回复本身作废（正文还在流）；但必须留痕，不能静默
      log.error('工具调用卡片落库失败', err)
    }
  }

  /** 重发：这一轮没拿到回复，按原样再跑一次（历史截止到那条用户消息） */
  async function resend(userMessageId: string): Promise<void> {
    if (sending) return
    const index = messages.findIndex((message) => message.id === userMessageId)
    if (index < 0) return
    await runGeneration(historyUpTo(messages, index), null)
  }

  /** 换一个：重新生成同一条回复，旧正文进版本历史（可切回） */
  async function reroll(assistantMessageId: string): Promise<void> {
    if (sending) return
    const index = messages.findIndex((message) => message.id === assistantMessageId)
    // 截止到「这条回复之前那条用户消息」：把回复自己送回上游等于让它接着自己写，必然跑偏
    if (index <= 0 || messages[index - 1]?.role !== 'user') return
    await runGeneration(historyUpTo(messages, index - 1), assistantMessageId)
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
      case 'bookmark':
        try {
          await createMessageBookmark(message)
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
          index,
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
        const history = historyUpTo(messages, pending.index)
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

  const items = useMemo<ChatItem[]>(
    () =>
      messages.map((message, index) => ({
        message,
        text: messageText(message),
        isLast: index === messages.length - 1,
      })),
    [messages],
  )

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
        bubbleMode={session?.bubbleMode ?? 'chat'}
        showAvatars={showAvatars}
      />
    ),
    // actions 每次渲染都是新对象（刻意为之），所以这里等于「总是重渲」——正是我们要的
    [actions, selectedIds, editingId, session?.bubbleMode, showAvatars],
  )

  const unrepliedCount = useMemo(() => countUnreplied(messages), [messages])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className="flex shrink-0 items-center gap-2 border-b px-3 py-3"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <Link to="/chat" className="text-lg" style={{ color: 'var(--color-primary)' }}>
          ‹
        </Link>
        <h1 className="flex-1 truncate text-base font-semibold">
          {session === undefined ? '加载中…' : (session?.title ?? '会话不存在')}
        </h1>
        <button
          type="button"
          data-testid="chat-settings-open"
          aria-label="聊天设置"
          disabled={session === undefined || session === null}
          onClick={() => setSettingsOpen(true)}
          className="rounded px-2 py-1 text-sm disabled:opacity-40"
          style={{ color: 'var(--color-primary)' }}
        >
          设置
        </button>
        <button
          type="button"
          data-testid="mini-terminal-open"
          aria-label="打开工具面板"
          onClick={() => setTerminalOpen(true)}
          className="rounded px-2 py-1 text-sm"
          style={{ color: 'var(--color-primary)' }}
        >
          工具
        </button>
      </header>

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
          estimateHeight={64}
          onReachTop={() => void loadEarlier()}
          className="h-full"
        />
        {loadingEarlier && (
          <div
            className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full px-2 py-1 text-xs"
            style={{
              backgroundColor: 'var(--color-surface-alt)',
              color: 'var(--color-text-dim)',
            }}
          >
            正在加载更早的消息…
          </div>
        )}
      </div>

      {items.length === 0 && (
        <div className="pb-4 text-center text-sm" style={{ color: 'var(--color-text-dim)' }}>
          和小栖说点什么吧
        </div>
      )}

      {errorText !== null && (
        <div className="shrink-0 px-4 pb-2 text-center text-xs" style={{ color: 'var(--color-danger)' }}>
          {errorText}
        </div>
      )}

      {/* 二次确认条：撤回 / 删除 / 重新生成 三个入口共用。刻意不自动作废 ——
          用户正在读确认语时按钮自己消失，比多留一会儿更恼人 */}
      {pendingConfirm !== null && (
        <div
          data-testid="confirm-bar"
          className="flex shrink-0 items-center gap-3 border-t px-3 py-2"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface-alt)',
          }}
        >
          <span data-testid="confirm-text" className="flex-1 text-xs">
            {pendingConfirm.text}
          </span>
          <button
            type="button"
            data-testid="confirm-yes"
            onClick={() => void confirmPending()}
            className="rounded px-3 py-1 text-xs"
            style={{ backgroundColor: 'var(--color-danger)', color: 'var(--color-primary-contrast)' }}
          >
            确认
          </button>
          <button
            type="button"
            data-testid="confirm-no"
            onClick={() => setPendingConfirm(null)}
            className="rounded px-3 py-1 text-xs"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            取消
          </button>
        </div>
      )}

      {selectMode ? (
        <div
          data-testid="select-bar"
          className="safe-bottom flex shrink-0 items-center gap-3 border-t px-3 py-3"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
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
            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-danger)', color: 'var(--color-primary-contrast)' }}
          >
            删除
          </button>
          <button
            type="button"
            data-testid="select-cancel"
            onClick={exitSelectMode}
            className="rounded px-3 py-1.5 text-sm"
            style={{ backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text)' }}
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
              className="flex shrink-0 items-center gap-3 px-3 pt-2"
            >
              <span className="flex-1 text-xs" style={{ color: 'var(--color-text-dim)' }}>
                {unrepliedCount} 条消息还没请求回复
              </span>
            </div>
          )}
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            sending={sending || mediaBusy}
            unrepliedCount={unrepliedCount}
            onSend={(text, options) => void send(text, options)}
            onRequestReply={() => void requestReply()}
            onSendVoice={(dataUrl, durationMs) => void sendVoice(dataUrl, durationMs)}
            onSendImage={(dataUrl) => void sendImage(dataUrl)}
            onGenerateImage={(prompt) => void createGeneratedImage(prompt)}
            onAbort={() => abortRef.current?.abort()}
            onError={setErrorText}
          />
        </>
      )}

      {toast !== null && (
        <div
          data-testid="toast"
          className="pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs"
          style={{ backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text)' }}
        >
          {toast}
        </div>
      )}

      {settingsOpen && session !== undefined && session !== null && (
        <ChatSettingsSheet
          session={session}
          saving={settingsSaving}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}

      <ActionSheet
        actions={sheetActions}
        onSelect={(id) => void runSheetAction(id)}
        onClose={() => setSheetFor(null)}
      />
    </div>
  )
}
