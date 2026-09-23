import { useEffect, useState, type FormEvent } from 'react'
import type { Diary } from '@shared/types'
import { createDiary, deleteDiary, listDiaries, updateDiary } from '../../db/home'

function todayKey(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function DiaryModule() {
  const [items, setItems] = useState<Diary[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [entryDate, setEntryDate] = useState(todayKey)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setItems(await listDiaries())
  }

  useEffect(() => {
    refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  function resetForm(): void {
    setTitle('')
    setContent('')
    setEntryDate(todayKey())
    setEditingId(null)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      if (editingId === null) await createDiary(title, content, entryDate)
      else await updateDiary(editingId, title, content, entryDate)
      resetForm()
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function startEditing(item: Diary): void {
    setTitle(item.title)
    setContent(item.content)
    setEntryDate(item.entryDate)
    setEditingId(item.id)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) {
      setDeletingId(id)
      return
    }
    try {
      await deleteDiary(id)
      if (editingId === id) resetForm()
      setDeletingId(null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{editingId === null ? '写一篇日记' : '编辑日记'}</h2>
          {editingId !== null && <button type="button" onClick={resetForm} className="text-xs" style={{ color: 'var(--color-text-dim)' }}>取消编辑</button>}
        </div>
        <label htmlFor="diary-date" className="text-xs" style={{ color: 'var(--color-text-dim)' }}>日期</label>
        <input id="diary-date" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="diary-title" className="sr-only">日记标题</label>
        <input id="diary-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="今天发生了什么？" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="diary-content" className="sr-only">日记正文</label>
        <textarea id="diary-content" value={content} onChange={(event) => setContent(event.target.value)} maxLength={10000} rows={7} placeholder="慢慢写，不着急……" className="w-full resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--color-border)' }} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--color-text-dim)' }}>{content.length}/10000</span>
          <button type="submit" disabled={title.trim() === '' || content.trim() === '' || entryDate === ''} className="rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>{editingId === null ? '保存日记' : '保存修改'}</button>
        </div>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在翻开日记……</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>还没有日记。今天可以成为第一页。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <time className="text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.entryDate}</time>
              <h3 className="mt-1 font-medium">{item.title}</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>
              <div className="mt-3 flex justify-end gap-3 text-xs">
                <button type="button" onClick={() => startEditing(item)} style={{ color: 'var(--color-primary)' }}>编辑</button>
                <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
