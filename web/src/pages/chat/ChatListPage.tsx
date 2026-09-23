import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ChatSession } from '@shared/types'
import { createSession, deleteSession, listSessions } from '../../db/chat'
import { log } from '../../lib/log'

export function ChatListPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 两步删除：点 ✕ 先进入「待确认」，再点一次才真正删（误触拦得住，不用原生弹窗） */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmTimerRef = useRef<number | null>(null)

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((err: unknown) => {
        log.error('读取会话列表失败', err)
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(
    () => () => {
      if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current)
    },
    [],
  )

  function askRemove(id: string): void {
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current)
    setConfirmingId(id)
    // 3 秒没确认就退回普通态，避免列表里长期挂着一个「确认删除」
    confirmTimerRef.current = window.setTimeout(() => setConfirmingId(null), 3000)
  }

  async function startSession(): Promise<void> {
    const session = await createSession('新的对话')
    navigate(`/chat/${session.id}`)
  }

  async function removeSession(id: string): Promise<void> {
    try {
      await deleteSession(id)
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null)
    } catch (err: unknown) {
      log.error('删除会话失败', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConfirmingId(null)
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">聊天</h1>
        <button
          type="button"
          onClick={() => void startSession()}
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
            {confirmingId === s.id ? (
              <button
                type="button"
                className="rounded border px-2 py-0.5 text-xs"
                style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                onClick={() => void removeSession(s.id)}
              >
                确认删除？
              </button>
            ) : (
              <button
                type="button"
                aria-label="删除会话"
                className="text-sm"
                style={{ color: 'var(--color-text-dim)' }}
                onClick={() => askRemove(s.id)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
