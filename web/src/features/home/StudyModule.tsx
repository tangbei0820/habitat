import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { StudyRecord, StudyTask } from '@shared/types'
import { IconCalendar, IconCheck } from '../../components/qixi/Icons'
import { createStudyRecord, deleteStudyRecord, listStudyRecords, updateStudyRecord } from '../../db/home'
import { createTask, deleteTask, listTodayTasks, toggleTask } from '../../db/studyTasks'

function todayKey(): string { const now = new Date(); const pad = (value: number) => String(value).padStart(2, '0'); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }

/**
 * 今日任务卡（第 6 批「学习伴学」）：「今天的三件小事」，真实存 Dexie（studyTasks，按天归组）。
 * 设计语义是**每天一页新纸**：昨天没做完的不追到今天 —— 那会从「陪你」变成「催你」。
 * 小栖的点评 / 复习卡片**刻意不做**：没有任何真实来源，做出来就是假数据（SPEC §6.3）。
 */
function TodayTasks() {
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [label, setLabel] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const refresh = useCallback((): void => { listTodayTasks().then(setTasks).catch(() => setTasks([])) }, [])
  useEffect(() => { refresh() }, [refresh])

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault()
    try { await createTask(label); setLabel(''); refresh() } catch { /* 空标签：输入框 placeholder 已说明，不打扰 */ }
  }

  const doneCount = tasks.filter((item) => item.done).length
  return (
    <div className="card" style={{ padding: '18px 20px' }} data-testid="study-tasks">
      <div className="mb-2 flex items-center">
        <span className="cell-label"><IconCheck size={13} /> 今天的三件小事</span>
        <span className="flex-1" />
        <span className="t-caption" style={{ color: 'var(--text-secondary)' }} data-testid="study-tasks-count">{doneCount} / {tasks.length}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-subtle)', overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ width: `${tasks.length === 0 ? 0 : (doneCount / tasks.length) * 100}%`, height: '100%', borderRadius: 2, background: 'var(--accent-strong)', transition: 'width var(--dur-card) var(--ease-out)' }} />
      </div>
      {tasks.map((task) => (
        <div key={task.id} className="task-row pressable" onClick={() => void toggleTask(task.id).then(refresh)} role="checkbox" aria-checked={task.done} data-testid={`study-task-${task.id}`}>
          <span className={`task-check${task.done ? ' is-done' : ''}`}>{task.done && <IconCheck size={13} sw={2.2} />}</span>
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 14, color: task.done ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecorationLine: task.done ? 'line-through' : 'none', textDecorationColor: 'var(--text-tertiary)' }}>{task.label}</div>
          </div>
          <button
            type="button"
            aria-label={`删除任务：${task.label}`}
            className="shrink-0 px-2 text-xs"
            style={{ color: confirmingId === task.id ? 'var(--danger)' : 'var(--text-tertiary)' }}
            onClick={(e) => {
              e.stopPropagation()
              if (confirmingId !== task.id) { setConfirmingId(task.id); return }
              void deleteTask(task.id).then(() => { setConfirmingId(null); refresh() })
            }}
          >
            {confirmingId === task.id ? '确认删除？' : '删'}
          </button>
        </div>
      ))}
      <form onSubmit={(e) => void add(e)} className="mt-2 flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="加一件今天想做的小事（最多三件就好）"
          data-testid="study-task-input"
          className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border-soft)' }}
        />
        <button type="submit" disabled={label.trim() === ''} className="btn-pill flex-none" style={{ minHeight: 38, padding: '0 16px', fontSize: 12.5 }}>添加</button>
      </form>
      {tasks.length === 0 && (
        <p className="t-caption" style={{ color: 'var(--text-tertiary)', marginTop: 8 }}>还空着。写一件「学会了就算赢」的小事。</p>
      )}
    </div>
  )
}

/** 一周节奏：这周每天学了多久（真实 studyRecords 聚合；没学的天就是矮格子，不装） */
function WeekRhythm({ items }: { items: StudyRecord[] }) {
  const days = useMemo(() => {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const pad = (value: number): string => String(value).padStart(2, '0')
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const minutes = items.filter((item) => item.studiedOn === key).reduce((sum, item) => sum + item.durationMinutes, 0)
      return { key, label: '一二三四五六日'[i], minutes, isToday: key === todayKey() }
    })
  }, [items])
  const max = Math.max(1, ...days.map((d) => d.minutes))
  const activeDays = days.filter((d) => d.minutes > 0).length
  return (
    <div className="card" style={{ padding: '18px 20px' }} data-testid="study-week">
      <div className="cell-label"><IconCalendar size={13} /> 这一周 · 来了 {activeDays} 天</div>
      <div className="mt-2 flex" style={{ gap: 8 }}>
        {days.map((day) => (
          <div key={day.key} className="flex flex-1 flex-col items-center" style={{ gap: 7 }}>
            <div
              title={day.minutes > 0 ? `${day.minutes} 分钟` : '没记录'}
              style={{
                width: '100%', height: 46, borderRadius: 12,
                background: day.minutes > 0 ? 'var(--accent-strong)' : 'var(--bg-subtle)',
                opacity: day.minutes > 0 ? Math.max(0.3, 0.3 + 0.7 * (day.minutes / max)) : 1,
                outline: day.isToday ? '1.5px solid var(--border-soft)' : 'none',
                outlineOffset: 2,
              }}
            />
            <span className="t-micro" style={{ color: day.minutes > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>{day.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StudyModule() {
  const [items, setItems] = useState<StudyRecord[]>([])
  const [subject, setSubject] = useState('')
  const [note, setNote] = useState('')
  const [studiedOn, setStudiedOn] = useState(todayKey)
  const [duration, setDuration] = useState('30')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> { setItems(await listStudyRecords()) }
  useEffect(() => { refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false)) }, [])
  function reset(): void { setSubject(''); setNote(''); setStudiedOn(todayKey()); setDuration('30'); setEditingId(null) }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const minutes = Number(duration)
      if (editingId === null) await createStudyRecord(subject, note, studiedOn, minutes)
      else await updateStudyRecord(editingId, subject, note, studiedOn, minutes)
      reset(); setError(null); await refresh()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }
  function edit(item: StudyRecord): void { setSubject(item.subject); setNote(item.note); setStudiedOn(item.studiedOn); setDuration(String(item.durationMinutes)); setEditingId(item.id); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  async function remove(id: string): Promise<void> {
    if (deletingId !== id) { setDeletingId(id); return }
    try { await deleteStudyRecord(id); if (editingId === id) reset(); setDeletingId(null); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const totalMinutes = items.reduce((sum, item) => sum + item.durationMinutes, 0)
  return <div className="space-y-4">
    <TodayTasks />
    <WeekRhythm items={items} />
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{editingId === null ? '记一次学习' : '编辑学习记录'}</h2>{editingId !== null && <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}</div>
      <label htmlFor="study-subject" className="sr-only">学习主题</label><input id="study-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="学习主题" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <div className="grid grid-cols-2 gap-3"><div><label htmlFor="study-date" className="mb-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>日期</label><input id="study-date" type="date" value={studiedOn} onChange={(e) => setStudiedOn(e.target.value)} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} /></div><div><label htmlFor="study-duration" className="mb-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>时长（分钟）</label><input id="study-duration" type="number" min="1" max="1440" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} /></div></div>
      <label htmlFor="study-note" className="sr-only">学习记录</label><textarea id="study-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={5} placeholder="学了什么、哪里卡住、下一步是什么……" className="resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--border-soft)' }} />
      <button type="submit" disabled={subject.trim() === '' || note.trim() === '' || studiedOn === '' || duration === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '保存记录' : '保存修改'}</button>
    </form>
    {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    {!loading && items.length > 0 && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>已记录 {items.length} 次，共 {totalMinutes} 分钟</p>}
    {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在整理学习记录……</p> : items.length === 0 ? <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>还没有学习记录。今天学到的一点点，也值得留下。</p> : <ul className="space-y-3">{items.map((item) => <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-start justify-between gap-3"><h3 className="font-medium">{item.subject}</h3><span className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.durationMinutes} 分钟</span></div><time className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>{item.studiedOn}</time><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.note}</p>
      <div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => edit(item)} style={{ color: 'var(--accent-strong)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div>
    </li>)}</ul>}
  </div>
}
