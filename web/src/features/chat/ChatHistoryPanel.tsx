import { useEffect, useState, type ReactNode } from 'react'
import { formatDayLabel } from '../../lib/format'
import { listMessageDays, listMessageMonths, searchMessages, type ChatDaySummary, type ChatMonthSummary, type ChatSearchResult } from '../../db/chat'

interface Props {
  scope: 'all' | 'session'
  sessionId?: string
  onClose: () => void
  onNavigate: (sessionId: string, messageId: string) => void
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp)
  return `${formatDayLabel(timestamp)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function dayLabel(item: ChatDaySummary): string {
  const date = new Date(`${item.dayKey}T12:00:00`)
  return formatDayLabel(date.getTime())
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthLabel(item: ChatMonthSummary): string {
  const [year, month] = item.monthKey.split('-')
  return `${year} 年 ${Number(month)} 月`
}

function highlightSnippet(text: string, query: string): ReactNode {
  const normalized = query.trim()
  if (normalized === '') return text
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return parts.map((part, index) => index % 2 === 1
    ? <mark key={`${part}:${index}`} style={{ backgroundColor: 'var(--accent-soft)', color: 'inherit' }}>{part}</mark>
    : <span key={`${part}:${index}`}>{part}</span>)
}

export function ChatHistoryPanel({ scope, sessionId, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatSearchResult[]>([])
  const [days, setDays] = useState<ChatDaySummary[]>([])
  const [months, setMonths] = useState<ChatMonthSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (scope !== 'session' || sessionId === undefined) return
    let cancelled = false
    void Promise.all([listMessageDays(sessionId), listMessageMonths(sessionId)])
      .then(([nextDays, nextMonths]) => {
        if (!cancelled) {
          setDays(nextDays)
          setMonths(nextMonths)
        }
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [scope, sessionId])

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalized = query.trim()
    if (normalized === '') {
      setResults([])
      setSearched(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await searchMessages(normalized, scope === 'session' ? sessionId : undefined)
      setResults(next)
      setSearched(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      data-testid={`chat-history-panel-${scope}`}
      className="card mx-3 mb-3 shrink-0"
      style={{ padding: '14px 16px', backgroundColor: 'var(--bg-surface-solid)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{scope === 'all' ? '搜索聊天记录' : '搜索这段对话'}</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            不搜索撤回正文、隐藏思绪和未转写音频。
          </p>
        </div>
        <button type="button" data-testid="chat-history-close" onClick={onClose} className="text-xs" style={{ color: 'var(--text-secondary)' }}>关闭</button>
      </div>

      <form className="mt-3 flex gap-2" onSubmit={(event) => void submit(event)}>
        <label htmlFor={`chat-history-query-${scope}`} className="sr-only">搜索聊天内容</label>
        <input
          id={`chat-history-query-${scope}`}
          data-testid={`chat-history-query-${scope}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={scope === 'all' ? '搜索所有会话……' : '搜索这段对话……'}
          className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border-soft)' }}
          autoFocus
        />
        <button type="submit" data-testid="chat-history-submit" disabled={busy || query.trim() === ''} className="btn-pill" style={{ minHeight: 38, padding: '0 14px', fontSize: 12.5 }}>
          {busy ? '搜索中…' : '搜索'}
        </button>
      </form>

      {scope === 'session' && days.length > 0 && (
        <div className="mt-3" data-testid="chat-timeline">
          <div className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>按日期跳转</div>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {(['今天', '昨天'] as const).map((label, index) => {
              const targetKey = localDayKey(Date.now() - index * 86_400_000)
              const item = days.find((day) => day.dayKey === targetKey)
              if (item === undefined) return null
              return (
                <button
                  key={label}
                  type="button"
                  data-testid={`chat-day-shortcut-${index === 0 ? 'today' : 'yesterday'}`}
                  onClick={() => onNavigate(sessionId ?? '', item.firstMessageId)}
                  className="shrink-0 rounded-full border px-3 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
                >
                  {label} · {item.count} 条
                </button>
              )
            })}
          </div>
          {months.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1" data-testid="chat-month-timeline">
              {months.map((item) => (
                <button
                  key={item.monthKey}
                  type="button"
                  data-testid={`chat-month-${item.monthKey}`}
                  onClick={() => onNavigate(sessionId ?? '', item.firstMessageId)}
                  className="shrink-0 rounded-full border px-3 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
                >
                  {monthLabel(item)} · {item.dayCount} 天
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((item) => (
              <button
                key={item.dayKey}
                type="button"
                data-testid={`chat-day-${item.dayKey}`}
                onClick={() => onNavigate(sessionId ?? '', item.firstMessageId)}
                className="shrink-0 rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
              >
                {dayLabel(item)} · {item.count} 条
              </button>
            ))}
          </div>
        </div>
      )}

      {error !== null && <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      {searched && !busy && results.length === 0 && (
        <p className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>没有找到匹配内容。</p>
      )}
      {results.length > 0 && (
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto" data-testid="chat-history-results">
          {results.map((result) => (
            <button
              key={`${result.session.id}:${result.message.id}`}
              type="button"
              data-testid={`chat-search-result-${result.message.id}`}
              onClick={() => onNavigate(result.session.id, result.message.id)}
              className="block w-full rounded-lg border p-3 text-left"
              style={{ borderColor: 'var(--border-soft)' }}
            >
              <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <strong className="truncate" style={{ color: 'var(--text-primary)' }}>{scope === 'all' ? result.session.title : result.message.role === 'user' ? '你' : '小栖'}</strong>
                <span className="shrink-0">{timeLabel(result.message.createdAt)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-5" style={{ color: 'var(--text-secondary)' }}>{highlightSnippet(result.snippet, query)}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
