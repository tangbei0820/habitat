import { useEffect, useState, type FormEvent } from 'react'
import type { Bookmark } from '@shared/types'
import { createExternalBookmark, deleteBookmark, listBookmarks } from '../../db/home'
import { ContentSourceLink } from './ContentSourceLink'

export function BookmarksModule() {
  const [items, setItems] = useState<Bookmark[]>([])
  const [title, setTitle] = useState('')
  const [href, setHref] = useState('')
  const [note, setNote] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setItems(await listBookmarks())
  }

  useEffect(() => {
    refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      await createExternalBookmark(title, href, note)
      setTitle('')
      setHref('')
      setNote('')
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) {
      setDeletingId(id)
      return
    }
    try {
      await deleteBookmark(id)
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
        <h2 className="text-sm font-semibold">收藏一个链接</h2>
        <label htmlFor="bookmark-title" className="sr-only">收藏名称</label>
        <input id="bookmark-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="收藏名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="bookmark-url" className="sr-only">链接地址</label>
        <input id="bookmark-url" type="url" inputMode="url" value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://example.com" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <label htmlFor="bookmark-note" className="sr-only">备注</label>
        <textarea id="bookmark-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} placeholder="为什么想留下它？（可选）" className="resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <button type="submit" disabled={title.trim() === '' || href.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}>加入收藏</button>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>正在整理收藏……</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}>还没有收藏。遇到想再回来的地方，就放在这里。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              {item.targetType === 'external-link' ? (
                <a href={item.targetId} target="_blank" rel="noreferrer" className="font-medium underline decoration-1 underline-offset-4" style={{ color: 'var(--color-primary)' }}>{item.title}</a>
              ) : <p className="font-medium">{item.title}</p>}
              <p className="mt-1 break-all text-xs" style={{ color: 'var(--color-text-dim)' }}>{item.targetId}</p>
              {item.note !== null && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.note}</p>}
              <ContentSourceLink item={item} />
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} className="text-xs" style={{ color: deletingId === item.id ? 'var(--color-danger)' : 'var(--color-text-dim)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
