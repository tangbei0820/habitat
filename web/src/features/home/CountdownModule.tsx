import { useEffect, useState, type FormEvent } from 'react'
import type { CountdownCategory, CountdownDay, CountdownReminder, CountdownRepeat } from '@shared/types'
import {
  createCountdown,
  deleteCountdown,
  listCountdowns,
  listHomeWidgets,
  putHomeWidget,
  removeHomeWidget,
  updateCountdown,
} from '../../db/home'
import { countdownCategoryLabel, countdownReminderLabel, countdownRepeatLabel, dayDistance, distanceLabel, nextOccurrenceDate } from './countdownDays'
import { IconCheck } from '../../components/qixi/Icons'
import { appendCountdownLifeEvent } from '../life/api'
import { checkCountdownReminders } from './countdownReminders'

function emitCountdownLifeEvent(event: Parameters<typeof appendCountdownLifeEvent>[0]): void {
  /* Life 是跨模块投影；本地倒数日操作不能被服务端短暂不可用阻断。 */
  void appendCountdownLifeEvent(event).catch(() => undefined)
}

export function CountdownModule() {
  const [items, setItems] = useState<CountdownDay[]>([])
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [category, setCategory] = useState<CountdownCategory>('other')
  const [repeat, setRepeat] = useState<CountdownRepeat>('none')
  const [reminder, setReminder] = useState<CountdownReminder>('none')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** 当前在主屏上的那一个（`null` = 没有任何倒数日上了主屏） */
  const [onHomeId, setOnHomeId] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    // 列表与「谁在主屏」一起读：分开读会出现「刚点完上主屏、按钮还是旧状态」的闪一下
    const [nextItems, widgets] = await Promise.all([listCountdowns(), listHomeWidgets()])
    setItems(nextItems.slice().sort((left, right) => nextOccurrenceDate(left).localeCompare(nextOccurrenceDate(right))))
    setOnHomeId(widgets.find((widget) => widget.kind === 'countdown')?.refId ?? null)
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!loading && items.length > 0) void checkCountdownReminders(items)
  }, [items, loading])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const item = editingId === null
        ? await createCountdown(title, targetDate, category, repeat, reminder)
        : await updateCountdown(editingId, title, targetDate, category, repeat, reminder)
      if (item === null) throw new Error('这个倒数日已经不存在了')
      emitCountdownLifeEvent({ eventType: editingId === null ? 'countdown.created' : 'countdown.updated', countdownId: item.id, title: item.title, targetDate: item.targetDate, category: item.category, repeat: item.repeat, reminder: item.reminder, at: item.updatedAt })
      setTitle('')
      setTargetDate('')
      setCategory('other')
      setRepeat('none')
      setReminder('none')
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
    setCategory(item.category)
    setRepeat(item.repeat)
    setReminder(item.reminder)
    setError(null)
  }

  function cancelEditing(): void {
    setEditingId(null)
    setTitle('')
    setTargetDate('')
    setCategory('other')
    setRepeat('none')
    setReminder('none')
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            分类
            <select aria-label="倒数日分类" value={category} onChange={(event) => setCategory(event.target.value as CountdownCategory)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}>
              <option value="anniversary">纪念日</option>
              <option value="event">事件</option>
              <option value="deadline">截止日</option>
              <option value="other">其它</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            重复
            <select aria-label="倒数日重复" value={repeat} onChange={(event) => setRepeat(event.target.value as CountdownRepeat)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}>
              <option value="none">不重复</option>
              <option value="yearly">每年（纪念日）</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            提醒
            <select aria-label="倒数日提醒" value={reminder} onChange={(event) => setReminder(event.target.value as CountdownReminder)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}>
              <option value="none">不提醒</option>
              <option value="on-day">当天提醒</option>
              <option value="one-day-before">提前一天</option>
            </select>
          </label>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>提醒会在打开栖息地时检查，并进入 Life → 通知；后台常驻提醒将在服务端日程化后补齐。</p>
        <button type="submit" disabled={title.trim() === '' || targetDate === ''} className="mt-1 justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '添加' : '保存修改'}</button>
      </form>
      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取倒数日…</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>还没有需要一起期待的日子。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const occurrenceDate = nextOccurrenceDate(item)
            const days = dayDistance(occurrenceDate)
            const isOnHome = onHomeId === item.id
            return (
              <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{occurrenceDate}{item.repeat === 'yearly' && item.targetDate !== occurrenceDate ? ` · 原日期 ${item.targetDate}` : ''}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border-soft)' }}>{countdownCategoryLabel(item.category)}</span>
                      <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border-soft)' }}>{countdownRepeatLabel(item.repeat)}</span>
                      <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border-soft)' }}>{countdownReminderLabel(item.reminder)}</span>
                    </div>
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
