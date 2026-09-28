import { useEffect, useState } from 'react'
import type { CallSessionRecord, CallTurnRecord } from '@shared/types'
import { formatDuration } from '../../lib/format'
import { listCalls, loadCall } from '../../lib/calls'
import { log } from '../../lib/log'

interface Props {
  chatSessionId: string
  onClose: () => void
  onPlayText: (text: string) => void
}

function statusLabel(status: CallSessionRecord['status']): string {
  switch (status) {
    case 'active': return '进行中'
    case 'ringing': return '未接'
    case 'rejected': return '已拒绝'
    case 'missed': return '未接'
    case 'cancelled': return '已取消'
    default: return '已结束'
  }
}

export function CallHistoryPanel({ chatSessionId, onClose, onPlayText }: Props) {
  const [calls, setCalls] = useState<CallSessionRecord[]>([])
  const [turns, setTurns] = useState<Record<string, CallTurnRecord[]>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    void listCalls(chatSessionId).then((items) => {
      if (cancelled) return
      setCalls(items)
      setBusy(false)
    }).catch((err: unknown) => {
      if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setBusy(false) }
    })
    return () => { cancelled = true }
  }, [chatSessionId])

  async function toggle(call: CallSessionRecord): Promise<void> {
    if (turns[call.id] !== undefined) {
      setTurns((prev) => { const next = { ...prev }; delete next[call.id]; return next })
      return
    }
    try {
      const detail = await loadCall(call.id)
      setTurns((prev) => ({ ...prev, [call.id]: detail.turns }))
    } catch (err) {
      log.warn('读取通话记录失败', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="card mx-3 mb-3 shrink-0" data-testid="call-history-panel" style={{ background: 'var(--bg-surface-solid)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">通话记录</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>逐句内容保存在当前会话里，可再次朗读。</p>
        </div>
        <button type="button" className="text-xs" style={{ color: 'var(--text-secondary)' }} onClick={onClose}>关闭</button>
      </div>
      {error !== null && <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      {busy ? <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>正在读取……</p> : calls.length === 0 ? <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>还没有通话记录。</p> : (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {calls.map((call) => (
            <div key={call.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }}>
              <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => void toggle(call)}>
                <span className="text-sm">{call.direction === 'companion' ? '小栖来电' : '拨给小栖'} · {statusLabel(call.status)}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDuration(call.durationMs)}</span>
              </button>
              {turns[call.id] !== undefined && (
                <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: 'var(--border-soft)' }}>
                  {turns[call.id].length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>没有留下逐句内容。</p> : turns[call.id].map((turn) => (
                    <div key={turn.id} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{turn.speaker === 'user' ? '你' : '小栖'}</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap">{turn.text}</span>
                      {turn.speaker === 'companion' && <button type="button" className="shrink-0 underline" onClick={() => onPlayText(turn.text)}>朗读</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
