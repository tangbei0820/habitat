import { useEffect, useState, type FormEvent } from 'react'
import type { CountdownDay } from '@shared/types'
import {
  createCountdown,
  deleteCountdown,
  listCountdowns,
  listHomeWidgets,
  putHomeWidget,
  removeHomeWidget,
  updateCountdown,
} from '../../db/home'
import { dayDistance, distanceLabel } from './countdownDays'
import { IconCheck } from '../../components/qixi/Icons'
import { appendCountdownLifeEvent } from '../life/api'

function emitCountdownLifeEvent(event: Parameters<typeof appendCountdownLifeEvent>[0]): void {
  /* Life 是跨模块投影；本地倒数日操作不能被服务端短暂不可用阻断。 */
  void appendCountdownLifeEvent(event).catch(() => undefined)
}

export function CountdownModule() {
  const [items, setItems] = useState<CountdownDay[]>([])
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** 当前在主屏上的那一个（`null` = 没有任何倒数日上了主屏） */
  const [onHomeId, setOnHomeId] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    // 列表与「谁在主屏」一起读：分开读会出现「刚点完上主屏、按钮还是旧状态」的闪一下
    const [nextItems, widgets] = await Promise.all([listCountdowns(), listHomeWidgets()])
    setItems(nextItems)
    setOnHomeId(widgets.find((widget) => widget.kind === 'countdown')?.refId ?? null)
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const item = editingId === null
        ? await createCountdown(title, targetDate)
        : await updateCountdown(editingId, title, targetDate)
      if (item === null) throw new Error('这个倒数日已经不存在了')
      emitCountdownLifeEvent({ eventType: editingId === null ? 'countdown.created' : 'countdown.updated', countdownId: item.id, title: item.title, targetDate: item.targetDate, at: item.updatedAt })
      setTitle('')
      setTargetDate('')
      setEditingId(null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function startEditing(item: CountdownDay): void {
    setEditingId(item.id)
    setTitle(item.title)
    setTargetDate(item.targetDate)
    setError(null)
  }

  function cancelEditing(): void {
    setEditingId(null)
    setTitle('')
    setTargetDate('')
  }

  async function remove(id: string): Promise<void> {
    if (deleting !== id) {
      setDeleting(id)
      return
    }
    const item = items.find((candidate) => candidate.id === id)
    await deleteCountdown(id)
    if (item !== undefined) emitCountdownLifeEvent({ eventType: 'countdown.deleted', countdownId: item.id, title: item.title, targetDate: item.targetDate })
    if (editingId === id) cancelEditing()
    setDeleting(null)
    await refresh()
  }

  /**
   * 上主屏 / 从主屏撤下（SPEC §3.3.2）。
   * 换一个倒数日上主屏是**改引用**（`putHomeWidget` 内部处理），不会留下两张卡片。
   */
  async function toggleHome(item: CountdownDay): Promise<void> {
    try {
      const action = onHomeId === item.id ? 'unpinned' : 'pinned'
      if (action === 'unpinned') await removeHomeWidget('countdown')
      else await putHomeWidget('countdown', item.id)
      emitCountdownLifeEvent({ eventType: 'countdown.widget.updated', countdownId: item.id, title: item.title, targetDate: item.targetDate, action })
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-2 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="countdown-title" className="text-sm font-medium">{editingId === null ? '新倒数日' : '编辑倒数日'}</label>
          {editingId !== null && <button type="button" onClick={cancelEditing} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}
        </div>
        <input id="countdown-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：相识纪念日" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <input aria-label="目标日期" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <button type="submit" disabled={title.trim() === '' || targetDate === ''} className="mt-1 justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '添加' : '保存修改'}</button>
      </form>
      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取倒数日…</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>还没有需要一起期待的日子。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const days = dayDistance(item.targetDate)
            const isOnHome = onHomeId === item.id
            return (
              <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.targetDate}</p>
                  </div>
                  <strong className="shrink-0 text-sm" style={{ color: days < 0 ? 'var(--text-secondary)' : 'var(--accent-strong)' }}>{distanceLabel(days)}</strong>
                </div>
                <div className="mt-3 flex items-center justify-end gap-3 text-xs">
                  <button
                    type="button"
                    data-testid="countdown-home-toggle"
                    data-countdown-id={item.id}
                    data-on-home={isOnHome ? 'true' : 'false'}
                    aria-pressed={isOnHome}
                    title={isOnHome ? '点击从主屏撤下' : '放到主屏作为 Widget'}
                    onClick={() => void toggleHome(item)}
                    className="shrink-0"
                    style={{ color: isOnHome ? 'var(--accent-strong)' : 'var(--text-secondary)' }}
                  >
                    <span className="flex items-center gap-1">
                      {isOnHome && <IconCheck size={13} />}
                      {isOnHome ? '已在主屏' : '上主屏'}
                    </span>
                  </button>
                  <button type="button" onClick={() => startEditing(item)} className="shrink-0" style={{ color: 'var(--text-secondary)' }}>编辑</button>
                  <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeleting(null)} className="shrink-0" style={{ color: deleting === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deleting === item.id ? '确认？' : '删除'}</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
