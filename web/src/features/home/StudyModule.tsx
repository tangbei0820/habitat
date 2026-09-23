import { useEffect, useState, type FormEvent } from 'react'
import type { StudyRecord } from '@shared/types'
import { createStudyRecord, deleteStudyRecord, listStudyRecords, updateStudyRecord } from '../../db/home'

function todayKey(): string { const now = new Date(); const pad = (value: number) => String(value).padStart(2, '0'); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }

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
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{editingId === null ? '记一次学习' : '编辑学习记录'}</h2>{editingId !== null && <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--color-text-dim)' }}>取消编辑</button>}</div>
      <label htmlFor="study-subject" className="sr-only">学习主题</label><input id="study-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="学习主题" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
      <div className="grid grid-cols-2 gap-3"><div><label htmlFor="study-date" className="mb-1 block text-xs" style={{ color: 'var(--color-text-dim)' }}>日期</label><input id="study-date" type="date" value={studiedOn} onChange={(e) => setStudiedOn(e.target.value)} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} /></div><div><label htmlFor="study-duration" className="mb-1 block text-xs" style={{ color: 'var(--color-text-dim)' }}>时长（分钟）</label><input id="study-duration" type="number" min="1" max="1440" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} /></div></div>
      <label htmlFor="study-note" className="sr-only">学习记录</label><textarea id="study-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={5} placeholder="学了什么、哪里卡住、下一步是什么……" className="resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--color-border)' }} />
      <button type="submit" disabled={subject.trim() === '' || note.trim() === '' || studiedOn === '' || duration === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>{editingId === null ? '保存记录' : '保存修改'}</button>
    </form>
    {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
    {!loading && items.length > 0 && <p className="text-xs" style={{ color: 'var(--color-text-dim)' }}>已记录 {items.length} 次，共 {totalMinutes} 分钟</p>}
    {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在整理学习记录……</p> : items.length === 0 ? <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>还没有学习记录。今天学到的一点点，也值得留下。</p> : <ul className="space-y-3">{items.map((item) => <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-start justify-between gap-3"><h3 className="font-medium">{item.subject}</h3><span className="shrink-0 text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.durationMinutes} 分钟</span></div><time className="mt-1 block text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.studiedOn}</time><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.note}</p>
      <div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => edit(item)} style={{ color: 'var(--color-primary)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div>
    </li>)}</ul>}
  </div>
}
