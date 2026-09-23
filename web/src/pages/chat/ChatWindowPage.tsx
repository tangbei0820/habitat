import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { LlmChatMessage } from '@shared/providers'
import type { ChatMessage, ChatSession, MessageStatus } from '@shared/types'
import { VirtualList } from '../../components/VirtualList'
import { MessageBlocks } from '../../features/chat/MessageBlocks'
import {
  addVersion,
  appendMessage,
  getSession,
  listMessagesPage,
  messageText,
  newMessage,
  selectCandidateVersion,
  touchSession,
} from '../../db/chat'
import { ApiRequestError } from '../../lib/api'
import { streamChat } from '../../lib/chatStream'
import { log } from '../../lib/log'

/** 首屏只拉最近这么多条（§9 风险8：按时间分页，不全量读）；向上翻页也用它 */
const PAGE_SIZE = 60
/** 自动命名会话时截取的字数 */
const TITLE_LIMIT = 18

/** 列表项：已落库消息 + 正在流式的那条（后者不落库，收尾时才写一次） */
type ChatItem =
  | { kind: 'message'; message: ChatMessage; text: string; isLast: boolean }
  | { kind: 'streaming'; text: string }

function itemKey(item: ChatItem): string {
  return item.kind === 'message' ? item.message.id : '__streaming__'
}

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LIMIT ? `${oneLine.slice(0, TITLE_LIMIT)}…` : oneLine
}

/**
 * 组装某一轮请求的历史：**截止到 `upToIndex`（含）**，其后的一律不送。
 *
 * 「换一个」与「重发」都靠它把「同一轮」钉住：换一个时若不截断，等于让模型接着自己
 * 刚写的那段往下续，出的东西必然跑偏。
 */
function historyUpTo(messages: ChatMessage[], upToIndex: number): LlmChatMessage[] {
  return messages
    .slice(0, upToIndex + 1)
    .map((message): LlmChatMessage => ({ role: message.role, content: messageText(message) }))
    .filter((message) => message.content !== '')
}

interface BubbleActions {
  busy: boolean
  onReroll: (id: string) => void
  onResend: (id: string) => void
  onSelectVersion: (id: string, index: number) => void
}

/** 气泡下方的小字操作钮 */
function TinyButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="px-0.5 disabled:opacity-30">
      {children}
    </button>
  )
}

function ChatBubble({ item, actions }: { item: ChatItem; actions: BubbleActions }) {
  if (item.kind === 'streaming') {
    return (
      <div className="flex justify-start px-4 py-1.5">
        <div
          className="max-w-[82%] break-words rounded-2xl px-3 py-2 text-sm"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span className="whitespace-pre-wrap">{item.text}</span>
          <span className="ml-0.5 animate-pulse" style={{ opacity: 0.7 }}>
            {item.text === '' ? '…' : '▍'}
          </span>
        </div>
      </div>
    )
  }

  const { message, text } = item
  const isUser = message.role === 'user'
  const interrupted = message.status === 'aborted' || message.status === 'error'
  const versionCount = message.candidates.length
  const selected = message.candidates.findIndex((candidate) => candidate.selected)

  // 「换一个」只给最后一条 AI 回复：改中间那条，后面已经发生的对话就与它脱节了
  const canReroll = !isUser && item.isLast && text !== '' && !actions.busy
  // 「重发」出现在「最后一条是用户消息」时 —— 意味着这一轮压根没拿到回复（失败 / 停在首字之前）
  const canResend = isUser && item.isLast && !actions.busy
  const showActions = canReroll || canResend || versionCount > 1

  return (
    <div className={`flex flex-col px-4 py-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className="max-w-[82%] break-words rounded-2xl px-3 py-2 text-sm"
        style={{
          backgroundColor: isUser ? 'var(--color-primary)' : 'var(--color-surface)',
          color: isUser ? 'var(--color-primary-contrast)' : 'var(--color-text)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{text}</span>
        ) : (
          // AI 侧走块分发：一条消息体内可能是文字 + 图片 + 工具结果任意组合（§6.2 可扩展块）
          <MessageBlocks blocks={message.blocks} />
        )}
        {interrupted && (
          <span className="ml-1 text-xs opacity-60">
            {message.status === 'aborted' ? '（已停止）' : '（中断）'}
          </span>
        )}
      </div>

      {showActions && (
        <div
          className="mt-0.5 flex items-center gap-2 pl-1 text-xs"
          style={{ color: 'var(--color-text-dim)' }}
        >
          {versionCount > 1 && (
            <span className="flex items-center gap-1">
              <TinyButton
                disabled={selected <= 0 || actions.busy}
                onClick={() => actions.onSelectVersion(message.id, selected - 1)}
              >
                ‹
              </TinyButton>
              <span>
                {selected + 1}/{versionCount}
              </span>
              <TinyButton
                disabled={selected >= versionCount - 1 || actions.busy}
                onClick={() => actions.onSelectVersion(message.id, selected + 1)}
              >
                ›
              </TinyButton>
            </span>
          )}
          {canReroll && (
            <TinyButton onClick={() => actions.onReroll(message.id)}>换一个</TinyButton>
          )}
          {canResend && <TinyButton onClick={() => actions.onResend(message.id)}>重发</TinyButton>}
        </div>
      )}
    </div>
  )
}

export function ChatWindowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<ChatSession | null | undefined>(undefined)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<{ content: string; reasoning: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  /**
   * 同步守卫：`onReachTop` 在贴顶时会连着触发好几次，而 `setLoadingEarlier` 生效要等下一帧 ——
   * 只靠 state 拦不住重复请求。
   */
  const loadingEarlierRef = useRef(false)
  /** 供回调读最新消息列表，避免闭包读到旧数组 */
  const messagesRef = useRef<ChatMessage[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    void (async () => {
      try {
        const [loaded, page] = await Promise.all([
          getSession(sessionId),
          listMessagesPage(sessionId, PAGE_SIZE),
        ])
        if (cancelled) return
        setSession(loaded)
        setMessages(page)
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
    },
    [],
  )

  /** 向上翻一页。`before` 是「不含」语义，所以拿已加载的最早一条当游标 */
  async function loadEarlier(): Promise<void> {
    if (sessionId === undefined || loadingEarlierRef.current || !hasMore) return
    const oldest = messagesRef.current[0]
    if (oldest === undefined) return

    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    try {
      const earlier = await listMessagesPage(sessionId, PAGE_SIZE, oldest.createdAt)
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
   * `targetId` 为空 = 追加一条新回复；有值 = 给那条消息加一个版本（换一个）。
   */
  async function runGeneration(history: LlmChatMessage[], targetId: string | null): Promise<void> {
    if (sessionId === undefined) return
    const controller = new AbortController()
    abortRef.current = controller
    setSending(true)
    setStreaming({ content: '', reasoning: '' })
    setErrorText(null)

    // 累加用局部变量而不是 state：回调里读 state 只会拿到闭包里的旧值
    let content = ''
    let reasoning = ''
    let failure: string | null = null

    try {
      await streamChat(
        { messages: history },
        {
          onDelta: (delta) => {
            if (delta.content !== undefined) content += delta.content
            if (delta.reasoning !== undefined) reasoning += delta.reasoning
            setStreaming({ content, reasoning })
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

    // 内容非空才落库：错误换来的空回复不留垃圾记录
    if (content !== '') {
      if (targetId === null) {
        const assistant = newMessage({ sessionId, role: 'assistant', text: content, status })
        // 思维链不展示但也不能丢（§8.2：思绪与内部推理在代码层隔离，Phase 3 由 Mini Terminal 取用）
        if (reasoning !== '') assistant.metadata = { reasoning }
        await appendMessage(assistant)
        setMessages((prev) => [...prev, assistant])
      } else {
        // 换一个：正文非空才替换，失败 / 空回复时保住旧版本，用户不会有损失
        const updated = await addVersion(targetId, { content, status, reasoning })
        if (updated !== null) {
          setMessages((prev) => prev.map((m) => (m.id === targetId ? updated : m)))
        }
      }
      await touchSession(sessionId)
    }

    abortRef.current = null
    setStreaming(null)
    setSending(false)
    setErrorText(failure)
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (text === '' || sending || sessionId === undefined) return

    // 1. 用户消息先落库（本地权威，§6.2），不等模型
    const userMessage = newMessage({ sessionId, role: 'user', text })
    await appendMessage(userMessage)
    setMessages((prev) => [...prev, userMessage])
    setDraft('')
    setErrorText(null)

    // 2. 首条消息顺便给会话起名（否则一直叫「新的对话」）
    const isFirst = messages.length === 0
    const title = isFirst ? titleFrom(text) : undefined
    await touchSession(sessionId, title)
    if (title !== undefined) {
      setSession((prev) => (prev === null || prev === undefined ? prev : { ...prev, title }))
    }

    // 3. 历史由前端组装随请求送出（服务端不存聊天记录）
    await runGeneration(historyUpTo([...messages, userMessage], messages.length), null)
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

  const items = useMemo<ChatItem[]>(() => {
    const list: ChatItem[] = messages.map((message, index) => ({
      kind: 'message',
      message,
      text: messageText(message),
      isLast: index === messages.length - 1,
    }))
    if (streaming !== null) list.push({ kind: 'streaming', text: streaming.content })
    return list
  }, [messages, streaming])

  // 刻意不做 memo：这些回调都读最新 state，缓存住反而会闭包读到旧数组
  const actions: BubbleActions = {
    busy: sending,
    onReroll: (id) => void reroll(id),
    onResend: (id) => void resend(id),
    onSelectVersion: (id, index) => void selectVersion(id, index),
  }
  const renderItem = useCallback(
    (item: ChatItem) => <ChatBubble item={item} actions={actions} />,
    [actions],
  )

  const canSend = draft.trim() !== '' && !sending

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
      </header>

      <div className="relative min-h-0 flex-1">
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

      <div
        className="safe-bottom flex shrink-0 items-end gap-2 border-t px-3 py-3"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          placeholder="输入消息…"
          className="max-h-32 flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          onKeyDown={(e) => {
            // isComposing：中文输入法选词时的回车不能当发送（否则一句话被切两半）
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {sending ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-full px-4 py-2 text-sm"
            style={{ backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text)' }}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="rounded-full px-4 py-2 text-sm disabled:opacity-40"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-primary-contrast)',
            }}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
