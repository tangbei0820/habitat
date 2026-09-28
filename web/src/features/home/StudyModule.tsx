import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { StudyMaterial, StudyRecord, StudyTask } from '@shared/types'
import { IconCalendar, IconCheck } from '../../components/qixi/Icons'
import { createStudyRecord, deleteStudyRecord, listStudyRecords, updateStudyRecord } from '../../db/home'
import { deleteStudyCard, filterStudyCards, generateStudyCards, listStudyCards, reviewStudyCard, summarizeStudyCards, type StudyCardFilter } from '../../db/studyCards'
import { createTask, deleteTask, listTodayTasks, toggleTask } from '../../db/studyTasks'
import { createStudyLinkMaterial, createStudyTextMaterial, deleteStudyMaterial, listStudyMaterials } from '../../db/studyMaterials'
import { appendStudyLifeEvent } from '../life/api'

function todayKey(): string { const now = new Date(); const pad = (value: number) => String(value).padStart(2, '0'); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }

function emitStudyLifeEvent(event: Parameters<typeof appendStudyLifeEvent>[0]): void {
  /* Life 是跨模块投影；后端暂时不可用时，本地学习动作仍然必须完成。 */
  void appendStudyLifeEvent(event).catch(() => undefined)
}

function studyDayAt(dayKey: string): number | undefined {
  const at = new Date(`${dayKey}T12:00:00`).getTime()
  return Number.isFinite(at) ? at : undefined
}

/**
 * 今日任务卡（第 6 批「学习伴学」）：「今天的三件小事」，真实存 Dexie（studyTasks，按天归组）。
 * 设计语义是**每天一页新纸**：昨天没做完的不追到今天 —— 那会从「陪你」变成「催你」。
 * AI 伴学卡片在下方单独走服务端生成；这里保留轻量的本地任务，不把任务完成伪装成 AI 教学进度。
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
        <div key={task.id} className="task-row pressable" onClick={() => void toggleTask(task.id).then(() => { if (!task.done) emitStudyLifeEvent({ eventType: 'study.task.completed', label: task.label, dayKey: task.dayKey }); refresh() })} role="checkbox" aria-checked={task.done} data-testid={`study-task-${task.id}`}>
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

function StudyMaterials({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<StudyMaterial[]>([])
  const [subject, setSubject] = useState('英语')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'text' | 'link'>('text')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => { void listStudyMaterials().then(setItems).catch(() => setItems([])) }, [])
  useEffect(() => { refresh() }, [refresh])

  async function importFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    if (!/\.(txt|md)$/i.test(file.name) && file.type !== 'text/plain' && file.type !== 'text/markdown') {
      setError('第一批资料文件只支持 TXT 或 Markdown')
      return
    }
    try {
      const nextContent = await file.text()
      if (nextContent.trim() === '') throw new Error('资料文件是空的')
      setTitle(file.name.replace(/\.(txt|md)$/i, '') || '未命名资料')
      setContent(nextContent)
      setKind('text')
      setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const item = kind === 'text'
        ? await createStudyTextMaterial(subject, title, content)
        : await createStudyLinkMaterial(subject, title, url)
      setItems((previous) => [item, ...previous])
      setTitle(''); setContent(''); setUrl(''); setError(null); onChanged()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) { setDeletingId(id); return }
    try { await deleteStudyMaterial(id); setItems((previous) => previous.filter((item) => item.id !== id)); setDeletingId(null); onChanged() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  return <section className="card" style={{ padding: '18px 20px' }} data-testid="study-materials">
    <div className="flex items-start justify-between gap-3">
      <div><div className="cell-label"><IconCalendar size={13} /> 学习资料</div><p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>把词表、笔记或资料链接放在这里，生成卡片时可选作上下文。</p></div>
      <span className="t-caption" style={{ color: 'var(--text-secondary)' }}>{items.length} 份</span>
    </div>
    <form onSubmit={(event) => void submit(event)} className="mt-3 grid gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={80} placeholder="学习主题" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-material-subject" />
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="资料名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm sm:col-span-2" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-material-title" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(event) => setKind(event.target.value as 'text' | 'link')} aria-label="资料类型" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-material-kind"><option value="text">文字资料</option><option value="link">网页链接</option></select>
        {kind === 'text' ? <label className="cursor-pointer rounded-full border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-soft)' }}><input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void importFile(event)} className="sr-only" data-testid="study-material-file" />导入 TXT / Markdown</label> : <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" className="min-w-[14rem] flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-material-url" />}
        <button type="submit" disabled={subject.trim() === '' || title.trim() === '' || (kind === 'text' ? content.trim() === '' : url.trim() === '')} className="btn-pill" style={{ minHeight: 38, padding: '0 16px', fontSize: 12.5 }}>保存资料</button>
      </div>
      {kind === 'text' && <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={200000} rows={3} placeholder="粘贴一段词表 / 笔记，或先用上面的按钮导入文件……" className="resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-material-content" />}
    </form>
    {error !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    <div className="mt-3 space-y-2">
      {items.map((item) => <article key={item.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-material-item">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="text-sm">{item.title}</strong><p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.subject} · {item.kind === 'text' ? '文字资料' : '网页链接'}</p></div><button type="button" onClick={() => void remove(item.id)} className="shrink-0 text-xs" style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-tertiary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div>
        {item.kind === 'text' ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{item.content}</p> : <><a href={item.url ?? '#'} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs" style={{ color: 'var(--accent-strong)' }}>{item.url}</a><p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>链接已保存；网页抓取与 RAG 后续接入。</p></>}
      </article>)}
    </div>
  </section>
}

function AiStudyCards({ materialsRevision }: { materialsRevision: number }) {
  const navigate = useNavigate()
  const [subject, setSubject] = useState('英语')
  const [goal, setGoal] = useState('记住今天能用上的几个词和短语')
  const [level, setLevel] = useState('初学者')
  const [count, setCount] = useState('3')
  const [allCards, setAllCards] = useState<Awaited<ReturnType<typeof listStudyCards>>>([])
  const [materials, setMaterials] = useState<StudyMaterial[]>([])
  const [materialId, setMaterialId] = useState('')
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [filter, setFilter] = useState<StudyCardFilter>('due')
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await listStudyCards(subject.trim() === '' ? undefined : subject.trim())
    setAllCards(next)
    setDismissedIds(new Set())
    setIndex(0)
    setFlipped(false)
  }, [subject])

  useEffect(() => {
    void refresh().catch(() => setAllCards([]))
    void listStudyMaterials(subject.trim() === '' ? undefined : subject.trim()).then(setMaterials).catch(() => setMaterials([]))
  }, [refresh, subject, materialsRevision])

  const summary = useMemo(() => summarizeStudyCards(allCards), [allCards])
  const cards = useMemo(
    () => filterStudyCards(allCards, filter).filter((card) => !dismissedIds.has(card.id)),
    [allCards, dismissedIds, filter],
  )

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const selectedMaterial = materials.find((item) => item.id === materialId)
      const generated = await generateStudyCards({
        subject,
        goal,
        level,
        count: Number(count),
        ...(selectedMaterial === undefined ? {} : { materialTitle: selectedMaterial.title, materialContext: selectedMaterial.content ?? undefined }),
      })
      emitStudyLifeEvent({ eventType: 'study.cards.generated', subject, count: generated.length })
      await refresh()
      setNotice('小栖给你放好了新卡片，先翻一张看看。')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function grade(value: 'again' | 'good' | 'easy'): Promise<void> {
    const current = cards[index]
    if (current === undefined) return
    setError(null)
    try {
      const updated = await reviewStudyCard(current.id, value)
      emitStudyLifeEvent({ eventType: 'study.card.reviewed', cardId: current.id, subject: current.subject, grade: value, repetitions: updated.repetitions, intervalDays: updated.intervalDays })
      setAllCards((existing) => existing.map((card) => card.id === updated.id ? updated : card))
      setDismissedIds((existing) => new Set(existing).add(current.id))
      setIndex(0)
      setFlipped(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function selectFilter(value: StudyCardFilter): void {
    setFilter(value)
    setDismissedIds(new Set())
    setIndex(0)
    setFlipped(false)
  }

  async function discuss(): Promise<void> {
    const current = cards[index]
    if (current === undefined) return
    const prompt = `我在学${current.subject}，刚看到卡片“${current.front}”。请和我一起练习：解释它的用法，再给我一个小练习。`
    try { await navigator.clipboard.writeText(prompt) } catch { /* 剪贴板权限不足时仍继续打开对话 */ }
    window.localStorage.setItem('habitat:study-discussion', prompt)
    navigate('/chat')
  }

  const current = cards[index]
  return (
    <section className="card" style={{ padding: '18px 20px' }} data-testid="study-ai-cards">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="cell-label"><IconCheck size={13} /> 小栖今天给你的卡片</div>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>不追进度，翻开一张，记住一点就够了。</p>
        </div>
        {cards.length > 0 && <span className="t-caption" style={{ color: 'var(--text-secondary)' }}>{Math.min(index + 1, cards.length)} / {cards.length}</span>}
      </div>
      <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }} data-testid="study-card-summary">
        待复习 <strong style={{ color: 'var(--accent-strong)' }}>{summary.due}</strong> · 今日已复习 <strong>{summary.reviewedToday}</strong> · 共 {summary.total} 张 · 已形成间隔 {summary.mature} 张
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={80} placeholder="学习主题" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-card-subject" />
        <input value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={240} placeholder="今天想学会什么" className="rounded-lg border bg-transparent px-3 py-2 text-sm sm:col-span-2" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-card-goal" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={level} onChange={(event) => setLevel(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} aria-label="当前水平">
          <option>初学者</option><option>有一点基础</option><option>进阶</option>
        </select>
        <select value={count} onChange={(event) => setCount(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} aria-label="卡片数量">
          <option value="3">3 张</option><option value="5">5 张</option><option value="8">8 张</option>
        </select>
        <button type="button" onClick={() => void generate()} disabled={busy || subject.trim() === '' || goal.trim() === ''} className="btn-pill" style={{ minHeight: 38, padding: '0 16px', fontSize: 12.5 }}>{busy ? '小栖正在整理…' : '生成一组卡片'}</button>
      </div>
      {materials.length > 0 && <div className="mt-2 flex items-center gap-2"><label htmlFor="study-card-material" className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>参考资料</label><select id="study-card-material" value={materialId} onChange={(event) => setMaterialId(event.target.value)} className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-card-material"><option value="">不引用资料</option>{materials.map((item) => <option key={item.id} value={item.id}>{item.title}{item.kind === 'link' ? '（链接，仅作来源）' : ''}</option>)}</select></div>}
      <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border-soft)' }} data-testid="study-card-filters">
        {([['due', `待复习（${summary.due}）`], ['all', `全部（${summary.total}）`], ['mature', `已形成间隔（${summary.mature}）`]] as const).map(([value, label]) => (
          <button key={value} type="button" data-testid={`study-card-filter-${value}`} aria-pressed={filter === value} onClick={() => selectFilter(value)} className="rounded-full px-3 py-1.5 text-xs" style={{ background: filter === value ? 'var(--bg-subtle)' : 'transparent', color: filter === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</button>
        ))}
      </div>
      {error !== null && <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {notice !== null && <p className="mt-2 text-xs" style={{ color: 'var(--accent-strong)' }}>{notice}</p>}
      {current === undefined ? (
        <div className="mt-3 rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }} data-testid="study-card-empty">
          {summary.total === 0 ? '这里会留下你和小栖一起翻过的卡片。先告诉它想学什么吧。' : filter === 'due' ? '今天没有到期卡片。可以先休息，或切到「全部」回看已有卡片。' : filter === 'mature' ? '还没有形成较长复习间隔的卡片。先按到期队列复习几轮吧。' : '这一组卡片暂时没有可展示的内容。'}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border p-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface-solid)' }} data-testid="study-card-current">
          <button type="button" onClick={() => setFlipped((value) => !value)} className="min-h-[150px] w-full text-left" aria-label={flipped ? '收起卡片答案' : '翻开卡片答案'}>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{flipped ? '答案' : '记忆面'}</span>
            <strong className="mt-2 block text-xl leading-8">{flipped ? current.back : current.front}</strong>
            {!flipped && <span className="mt-3 block text-xs" style={{ color: 'var(--text-secondary)' }}>点一下翻开 · 先在心里想想</span>}
            {flipped && current.example !== null && <span className="mt-3 block whitespace-pre-wrap text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{current.example}</span>}
            {flipped && current.hint !== null && <span className="mt-2 block text-xs" style={{ color: 'var(--accent-strong)' }}>记忆提示：{current.hint}</span>}
          </button>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void grade('again')} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>再看一遍</button>
            <button type="button" onClick={() => void grade('good')} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>记住了</button>
            <button type="button" onClick={() => void grade('easy')} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>很轻松</button>
            <button type="button" onClick={() => void discuss()} className="ml-auto text-xs" style={{ color: 'var(--accent-strong)' }}>去对话里讨论</button>
            <button type="button" onClick={() => void deleteStudyCard(current.id).then(refresh).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>删掉</button>
          </div>
        </div>
      )}
    </section>
  )
}

export function StudyModule() {
  const [items, setItems] = useState<StudyRecord[]>([])
  const [materialsRevision, setMaterialsRevision] = useState(0)
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
      if (editingId === null) {
        await createStudyRecord(subject, note, studiedOn, minutes)
        emitStudyLifeEvent({ eventType: 'study.record.created', subject, durationMinutes: minutes, studiedOn, ...(studyDayAt(studiedOn) === undefined ? {} : { at: studyDayAt(studiedOn) }) })
      } else await updateStudyRecord(editingId, subject, note, studiedOn, minutes)
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
    <AiStudyCards materialsRevision={materialsRevision} />
    <StudyMaterials onChanged={() => setMaterialsRevision((value) => value + 1)} />
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
