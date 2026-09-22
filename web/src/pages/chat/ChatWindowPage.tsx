import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ChatMessage, ChatSession } from '@shared/types'
import { db } from '../../db/db'
import { log } from '../../lib/log'

export function ChatWindowPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<ChatSession | null | undefined>(undefined)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    db.sessions
      .get(sessionId)
      .then((s) => setSession(s ?? null))
      .catch((err: unknown) => {
        log.error('读取会话失败', err)
        setSession(null)
      })
    db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('createdAt')
      .then(setMessages)
      .catch((err: unknown) => log.error('读取消息失败', err))
  }, [sessionId])

  function sendPlaceholder(): void {
    if (draft.trim() === '') return
    setNotice('聊天功能将在 Phase 1 接入（本地占位，未发送）')
    setDraft('')
    window.setTimeout(() => setNotice(null), 3000)
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-2 border-b px-3 py-3"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <Link to="/chat" className="text-lg" style={{ color: 'var(--color-primary)' }}>
          ‹
        </Link>
        <h1 className="flex-1 truncate text-base font-semibold">
          {session === undefined ? '加载中…' : (session?.title ?? '会话不存在')}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-16 text-center text-sm" style={{ color: 'var(--color-text-dim)' }}>
            和小栖说点什么吧
          </div>
        )}
      </div>

      {notice !== null && (
        <div className="px-4 pb-2 text-center text-xs" style={{ color: 'var(--color-text-dim)' }}>
          {notice}
        </div>
      )}

      <div
        className="safe-bottom flex items-end gap-2 border-t px-3 py-3"
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
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendPlaceholder()
            }
          }}
        />
        <button
          type="button"
          onClick={sendPlaceholder}
          className="rounded-full px-4 py-2 text-sm"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-contrast)',
          }}
        >
          发送
        </button>
      </div>
    </div>
  )
}
