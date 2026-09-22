import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { LlmChatMessage } from '@shared/providers'
import type { ChatMessage, ChatSession, MessageRole, MessageStatus } from '@shared/types'
import { VirtualList } from '../../components/VirtualList'
import {
  appendMessage,
  getSession,
  listMessagesPage,
  messageText,
  newMessage,
  touchSession,
} from '../../db/chat'
import { ApiRequestError } from '../../lib/api'
import { streamChat } from '../../lib/chatStream'
import { log } from '../../lib/log'

/** 首屏只拉最近这么多条（§9 风险8：按时间分页，不全量读） */
const PAGE_SIZE = 60
/** 自动命名会话时截取的字数 */
const TITLE_LIMIT = 18

/** 列表项：已落库消息 + 正在流式的那条（后者不落库，收尾时才写一次） */
type ChatItem =
  | { kind: 'message'; id: string; role: MessageRole; text: string; status: MessageStatus }
  | { kind: 'streaming'; text: string }

function itemKey(item: ChatItem): string {
  return item.kind === 'message' ? item.id : '__streaming__'
}

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LIMIT ? `${oneLine.slice(0, TITLE_LIMIT)}…` : oneLine
}

function ChatBubble({ item }: { item: ChatItem }) {
  const isUser = item.kind === 'message' && item.role === 'user'
  const interrupted = item.kind === 'message' && (item.status === 'aborted' || item.status === 'error')

  return (
    <div className={`flex px-4 py-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm"
        style={{
          backgroundColor: isUser ? 'var(--color-primary)' : 'var(--color-surface)',
          color: isUser ? 'var(--color-primary-contrast)' : 'var(--color-text)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {item.text}
        {item.kind === 'streaming' && (
          // 还没有首个正文增量时显示省略号，别让用户看到一个空方块
          <span className="ml-0.5 animate-pulse" style={{ opacity: 0.7 }}>
            {item.text === '' ? '…' : '▍'}
          </span>
        )}
        {interrupted && (
          <span className="ml-1 text-xs opacity-60">
            {item.status === 'aborted' ? '（已停止）' : '（中断）'}
          </span>
        )}
      </div>
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

  const abortRef = useRef<AbortController | null>(null)

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

  const items = useMemo<ChatItem[]>(() => {
    const list: ChatItem[] = messages.map((message) => ({
      kind: 'message',
      id: message.id,
      role: message.role,
      text: messageText(message),
      status: message.status,
    }))
    if (streaming !== null) list.push({ kind: 'streaming', text: streaming.content })
    return list
  }, [messages, streaming])

  const renderItem = useCallback((item: ChatItem) => <ChatBubble item={item} />, [])

  function stop(): void {
    abortRef.current?.abort()
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
    const history: LlmChatMessage[] = [
      ...messages
        .map((message): LlmChatMessage => ({ role: message.role, content: messageText(message) }))
        .filter((message) => message.content !== ''),
      { role: 'user', content: text },
    ]

    const controller = new AbortController()
    abortRef.current = controller
    setSending(true)
    setStreaming({ content: '', reasoning: '' })

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
        log.error('发送失败', err)
      }
    }

    // 4. 收尾：内容非空才落库（错误换来的空回复不留垃圾记录）
    if (content !== '') {
      const status: MessageStatus = controller.signal.aborted ? 'aborted' : failure === null ? 'done' : 'error'
      const assistant = newMessage({ sessionId, role: 'assistant', text: content, status })
      // 思维链不展示但也不能丢（§8.2 的「思绪」与内部推理在代码层隔离，Phase 3 由 Mini Terminal 取用）
      if (reasoning !== '') assistant.metadata = { reasoning }
      await appendMessage(assistant)
      setMessages((prev) => [...prev, assistant])
      await touchSession(sessionId)
    }

    abortRef.current = null
    setStreaming(null)
    setSending(false)
    setErrorText(failure)
  }

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

      <VirtualList
        items={items}
        getKey={itemKey}
        renderItem={renderItem}
        estimateHeight={64}
        className="min-h-0 flex-1"
      />

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
            onClick={stop}
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
