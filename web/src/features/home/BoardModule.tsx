import { useEffect, useState, type FormEvent } from 'react'
import type { Moment } from '@shared/types'
import { createMoment, deleteMoment, listMoments } from '../../db/home'

export function BoardModule() {
  const [items, setItems] = useState<Moment[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    listMoments()
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const item = await createMoment(draft)
      setItems((current) => [item, ...current])
      setDraft('')
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(id: string): Promise<void> {
    if (deleting !== id) {
      setDeleting(id)
      return
    }
    await deleteMoment(id)
    setItems((current) => current.filter((item) => item.id !== id))
    setDeleting(null)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <label htmlFor="board-draft" className="mb-2 block text-sm font-medium">留下一句话</label>
        <textarea id="board-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} rows={3} placeholder="记下此刻想说的话…" className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--color-text-dim)' }}>{draft.length}/500</span>
          <button type="submit" disabled={draft.trim() === ''} className="rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>留言</button>
        </div>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在读取留言…</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>还没有留言。第一条就从今天开始。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--color-text-dim)' }}>
                <time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeleting(null)} style={{ color: deleting === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deleting === item.id ? '确认删除？' : '删除'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
