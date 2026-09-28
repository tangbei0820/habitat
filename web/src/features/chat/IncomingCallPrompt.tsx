import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CallEvent, CallSessionRecord } from '@shared/types'
import { IconClose, IconMic } from '../../components/qixi/Icons'
import { answerCall, listIncomingCalls, rejectCall, subscribeIncomingCallEvents } from '../../lib/calls'
import { log } from '../../lib/log'

export function IncomingCallPrompt() {
  const navigate = useNavigate()
  const [call, setCall] = useState<CallSessionRecord | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let disposed = false
    void listIncomingCalls().then((calls) => {
      if (!disposed) setCall(calls[0] ?? null)
    }).catch(() => { /* 后端未启动时不打断正常页面 */ })
    const unsubscribe = subscribeIncomingCallEvents((event: CallEvent) => {
      if (event.type !== 'state') return
      if (event.call.status === 'ringing' && event.call.direction === 'companion') setCall(event.call)
      else if (event.call.id === call?.id) setCall(null)
    })
    return () => { disposed = true; unsubscribe() }
  }, [call?.id])

  if (call === null) return null

  async function accept(): Promise<void> {
    if (busy) return
    const activeCall = call
    if (activeCall === null) return
    setBusy(true)
    try {
      await answerCall(activeCall.id)
      navigate(`/chat/${encodeURIComponent(activeCall.chatSessionId)}?call=${encodeURIComponent(activeCall.id)}`)
      setCall(null)
    } catch (error) {
      log.warn('接听来电失败', error)
      setCall(null)
    } finally { setBusy(false) }
  }

  async function reject(): Promise<void> {
    if (busy) return
    const activeCall = call
    if (activeCall === null) return
    setBusy(true)
    try { await rejectCall(activeCall.id) } catch (error) { log.warn('拒绝来电失败', error) }
    setCall(null)
    setBusy(false)
  }

  return (
    <div className="fixed inset-x-3 top-4 z-50 mx-auto max-w-md" data-testid="incoming-call-prompt">
      <section className="card flex items-center gap-3 border" style={{ borderColor: 'var(--accent-soft)' }}>
        <div className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
          <IconMic size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">小栖来电</p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>要接听这次应用内通话吗？</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="icon-btn" aria-label="拒绝来电" disabled={busy} onClick={() => void reject()}><IconClose size={18} /></button>
          <button type="button" className="btn-pill btn-strong" disabled={busy} onClick={() => void accept()}>接听</button>
        </div>
      </section>
    </div>
  )
}
