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
import { useEffect, useState, type ComponentType } from 'react'
import type { RuntimeEvent } from '@shared/types'
import { IconAlert, IconBlock, IconCheck, IconNote, type IconProps } from '../../components/qixi/Icons'
import { decideEvent, getEvent, revokeEvent } from '../../db/events'

/** 状态 → 展示。`pending` 不在表里（它有独立的按钮区）。 */
const SETTLED_LABEL: Record<
  Exclude<RuntimeEvent['status'], 'pending'>,
  { Icon: ComponentType<IconProps>; text: string; color: string }
> = {
  // 拒绝用中性色而不是红色：那是北北的选择，不是出错
  approved: { Icon: IconCheck, text: '你已允许', color: 'var(--accent-strong)' },
  denied: { Icon: IconBlock, text: '你已拒绝', color: 'var(--text-secondary)' },
  failed: { Icon: IconAlert, text: '允许了，但没能完成', color: 'var(--danger)' },
  expired: { Icon: IconAlert, text: '请求已过期', color: 'var(--text-secondary)' },
  revoked: { Icon: IconBlock, text: '请求已撤回', color: 'var(--text-secondary)' },
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

  async function revoke(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setEvent(await revokeEvent(eventId))
      onDecided?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** 已决状态的展示（图标组件 + 颜色）；`pending` 或还没拉到时为 null */
  const settled = event !== null && event.status !== 'pending' ? SETTLED_LABEL[event.status] : null
  const settledResult = event !== null && event.status !== 'pending' ? event.result : null

  const title = event?.title ?? fallbackTitle
  const pending = event !== null && event.status === 'pending'

  return (
    <div
      data-testid="event-confirm-card"
      data-event-id={eventId}
      data-status={event?.status ?? 'loading'}
      className="card w-full p-3 text-xs"
      style={{
        // 待决时描边用强调色：这条消息和别的「已发生的事」不同，它**在等一个动作**
        borderColor: pending ? 'var(--accent-strong)' : 'var(--border-soft)',
      }}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <IconNote size={15} />
        {title}
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
              className="btn-pill btn-strong disabled:opacity-40"
              style={{ minHeight: 34, padding: '0 18px', fontSize: 13 }}
            >
              {busy ? '处理中…' : '允许'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="btn-pill btn-ghost disabled:opacity-40"
              style={{ minHeight: 34, padding: '0 18px', fontSize: 13 }}
            >
              拒绝
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              className="btn-pill btn-ghost disabled:opacity-40"
              style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }}
            >
              撤回请求
            </button>
          </div>
        </>
      )}

      {settled !== null && (
        <p className="mt-2 flex items-center gap-1.5 opacity-70">
          <settled.Icon size={14} style={{ color: settled.color }} />
          {settled.text}
          {settledResult !== null && ` · ${settledResult}`}
        </p>
      )}

      {error !== null && <p className="mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
