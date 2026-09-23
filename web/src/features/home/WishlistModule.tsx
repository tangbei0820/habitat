import { useEffect, useState, type FormEvent } from 'react'
import type { WishlistItem } from '@shared/types'
import { createWishlistItem, deleteWishlistItem, listWishlist, toggleWishlistItem } from '../../db/home'

export function WishlistModule() {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setItems(await listWishlist())
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      await createWishlistItem(draft)
      setDraft('')
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function toggle(id: string): Promise<void> {
    await toggleWishlistItem(id)
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    if (deleting !== id) {
      setDeleting(id)
      return
    }
    await deleteWishlistItem(id)
    setDeleting(null)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <label htmlFor="wishlist-title" className="sr-only">新愿望</label>
        <input id="wishlist-title" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={120} placeholder="想一起完成什么？" className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }} />
        <button type="submit" disabled={draft.trim() === ''} className="rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>添加</button>
      </form>
      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在读取愿望…</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>愿望清单还是空的。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <button type="button" aria-label={item.status === 'done' ? '标记为未完成' : '标记为已完成'} onClick={() => void toggle(item.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>{item.status === 'done' ? '✓' : ''}</button>
              <span className={`min-w-0 flex-1 break-words text-sm ${item.status === 'done' ? 'line-through opacity-60' : ''}`}>{item.title}</span>
              <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeleting(null)} className="shrink-0 text-xs" style={{ color: deleting === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deleting === item.id ? '确认删除？' : '删除'}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
