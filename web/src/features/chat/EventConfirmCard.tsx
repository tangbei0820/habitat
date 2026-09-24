/**
 * 确认卡（Phase 6.5 P1）—— `confirm` 级工具挂起时，让北北决定放不放行。
 *
 * 它解决的是「AI 想写东西，但写之前要你点头」这件事。卡片上的两个按钮
 * 直连 `/api/inbox/:id/decide`，点了才真执行 —— **这里不预先执行任何东西**。
 *
 * ⚠️ 三个容易做错的地方：
 *
 * 1. **状态要从服务端读，不能只看 props**。同一张卡片刷新后还得活着（消息块里只存了 eventId），
 *    而「已经处理过了」这件事只有服务端知道。所以挂载时拉一次。
 * 2. **决策结果用服务端返回的那一条覆盖本地**，不做乐观更新。乐观更新在服务端拒绝时
 *    会留下一个假的「已确认」。
 * 3. **拒绝与失败要分开显示**。`denied` 是「北北说不」，`failed` 是「北北说好但它没做成」——
 *    前者是决定，后者是故障，混成一句话会让北北以为是自己点错了。
 */
import { useEffect, useState } from 'react'
import type { RuntimeEvent } from '@shared/types'
import { decideEvent, getEvent } from '../../db/events'

/** 状态 → 展示。`pending` 不在表里（它有独立的按钮区）。 */
const SETTLED_LABEL: Record<Exclude<RuntimeEvent['status'], 'pending'>, { icon: string; text: string }> = {
  approved: { icon: '✅', text: '你已允许' },
  denied: { icon: '⛔', text: '你已拒绝' },
  failed: { icon: '⚠️', text: '允许了，但没能完成' },
}

export function EventConfirmCard({
  eventId,
  fallbackTitle,
  onDecided,
}: {
  eventId: string
  fallbackTitle: string
  /** 决策完成后通知外部（收件箱列表要重排：处理过的不该还留在「等着你」里） */
  onDecided?: (() => void) | undefined
}) {
  const [event, setEvent] = useState<RuntimeEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getEvent(eventId)
      .then((loaded) => {
        if (alive) setEvent(loaded)
      })
      .catch((err: unknown) => {
        // 拉不到不当成「没有这件事」：卡片照常显示，只把原因说出来（事件可能是被清掉了）
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [eventId])

  async function decide(approve: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setEvent(await decideEvent(eventId, approve ? 'approve' : 'deny'))
      onDecided?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const title = event?.title ?? fallbackTitle
  const pending = event !== null && event.status === 'pending'

  return (
    <div
      data-testid="event-confirm-card"
      data-event-id={eventId}
      data-status={event?.status ?? 'loading'}
      className="w-full rounded-lg border p-3 text-xs"
      style={{
        borderColor: pending ? 'var(--color-primary)' : 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <p className="font-medium">
        <span aria-hidden>📝</span> {title}
      </p>
      {event !== null && event.detail !== '' && (
        <p className="mt-1 whitespace-pre-wrap break-words opacity-70">{event.detail}</p>
      )}

      {pending && (
        <>
          <p className="mt-2 opacity-70">小栖还没真的做这件事 —— 你点了允许才会发生。</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="rounded-full px-3 py-1.5 disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}
            >
              {busy ? '处理中…' : '允许'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded-full border px-3 py-1.5 disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)' }}
            >
              拒绝
            </button>
          </div>
        </>
      )}

      {event !== null && event.status !== 'pending' && (
        <p className="mt-2 opacity-70">
          <span aria-hidden>{SETTLED_LABEL[event.status].icon}</span> {SETTLED_LABEL[event.status].text}
          {event.result !== null && ` · ${event.result}`}
        </p>
      )}

      {error !== null && <p className="mt-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  )
}
