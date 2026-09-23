import { useEffect, useState, type FormEvent } from 'react'
import type { ReadingNote, ReadingStatus } from '@shared/types'
import { createReadingNote, deleteReadingNote, listReadingNotes, updateReadingNote } from '../../db/home'

const STATUS_LABELS: Record<ReadingStatus, string> = { want: '想读', reading: '在读', finished: '读完' }

export function ReadingModule() {
  const [items, setItems] = useState<ReadingNote[]>([])
  const [bookTitle, setBookTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [status, setStatus] = useState<ReadingStatus>('reading')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> { setItems(await listReadingNotes()) }
  useEffect(() => { refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false)) }, [])

  function reset(): void { setBookTitle(''); setAuthor(''); setStatus('reading'); setNote(''); setEditingId(null) }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      if (editingId === null) await createReadingNote(bookTitle, author, status, note)
      else await updateReadingNote(editingId, bookTitle, author, status, note)
      reset(); setError(null); await refresh()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  function edit(item: ReadingNote): void {
    setBookTitle(item.bookTitle); setAuthor(item.author ?? ''); setStatus(item.status); setNote(item.note); setEditingId(item.id); setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) { setDeletingId(id); return }
    try { await deleteReadingNote(id); if (editingId === id) reset(); setDeletingId(null); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  return <div className="space-y-4">
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{editingId === null ? '记一页阅读' : '编辑读书笔记'}</h2>{editingId !== null && <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--color-text-dim)' }}>取消编辑</button>}</div>
      <label htmlFor="reading-title" className="sr-only">书名</label><input id="reading-title" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} maxLength={120} placeholder="书名" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
      <label htmlFor="reading-author" className="sr-only">作者</label><input id="reading-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} placeholder="作者（可选）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
      <label htmlFor="reading-status" className="text-xs" style={{ color: 'var(--color-text-dim)' }}>阅读状态</label><select id="reading-status" value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor="reading-note" className="sr-only">读书笔记</label><textarea id="reading-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={5} placeholder="摘录、感受或想法……" className="resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--color-border)' }} />
      <button type="submit" disabled={bookTitle.trim() === '' || note.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>{editingId === null ? '保存笔记' : '保存修改'}</button>
    </form>
    {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
    {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在翻书……</p> : items.length === 0 ? <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>还没有读书笔记。读到心里一动的地方，就记下来吧。</p> : <ul className="space-y-3">{items.map((item) => <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{item.bookTitle}</h3>{item.author !== null && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.author}</p>}</div><span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>{STATUS_LABELS[item.status]}</span></div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.note}</p><div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => edit(item)} style={{ color: 'var(--color-primary)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div>
    </li>)}</ul>}
  </div>
}
