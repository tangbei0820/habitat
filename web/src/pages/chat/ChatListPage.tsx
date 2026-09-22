import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ChatSession } from '@shared/types'
import { db } from '../../db/db'
import { log } from '../../lib/log'

function newSession(title: string): ChatSession {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    type: 'chat-session',
    title,
    pinnedAt: null,
    remark: null,
    background: null,
    bubbleMode: 'chat',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function ChatListPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    db.sessions
      .orderBy('updatedAt')
      .reverse()
      .toArray()
      .then((list) =>
        setSessions([...list].sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))),
      )
      .catch((err: unknown) => {
        log.error('读取会话列表失败', err)
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  async function createSession(): Promise<void> {
    const session = newSession('新的对话')
    await db.sessions.add(session)
    navigate(`/chat/${session.id}`)
  }

  async function removeSession(id: string): Promise<void> {
    await db.transaction('rw', db.sessions, db.messages, async () => {
      await db.messages.where('sessionId').equals(id).delete()
      await db.sessions.delete(id)
    })
    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null)
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">聊天</h1>
        <button
          type="button"
          onClick={() => void createSession()}
          className="rounded-full px-3 py-1 text-sm"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-contrast)',
          }}
        >
          ＋ 新建
        </button>
      </div>

      {error !== null && (
        <p className="mb-3 text-sm" style={{ color: 'var(--color-danger)' }}>
          读取失败：{error}
        </p>
      )}
      {sessions === null && error === null && (
        <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>加载中…</p>
      )}
      {sessions !== null && sessions.length === 0 && (
        <div
          className="rounded-lg border p-8 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
        >
          还没有对话，点右上角「新建」开始吧
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {(sessions ?? []).map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-lg border px-4 py-3"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <Link to={`/chat/${s.id}`} className="flex-1 truncate">
              {s.pinnedAt !== null && <span className="mr-1">📌</span>}
              {s.title}
            </Link>
            <button
              type="button"
              aria-label="删除会话"
              className="text-sm"
              style={{ color: 'var(--color-text-dim)' }}
              onClick={() => void removeSession(s.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
