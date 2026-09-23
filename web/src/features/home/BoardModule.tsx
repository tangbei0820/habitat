import { useEffect, useState, type FormEvent } from 'react'
import type { Moment } from '@shared/types'
import {
  createMoment,
  deleteMoment,
  listHomeWidgets,
  listMoments,
  putHomeWidget,
  removeHomeWidget,
} from '../../db/home'

export function BoardModule() {
  const [items, setItems] = useState<Moment[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** 留言板 Widget 是否在主屏上（不同 kind 的 Widget 互不影响，各管各的） */
  const [onHome, setOnHome] = useState(false)

  async function refresh(): Promise<void> {
    const [nextItems, widgets] = await Promise.all([listMoments(), listHomeWidgets()])
    setItems(nextItems)
    setOnHome(widgets.some((widget) => widget.kind === 'board'))
  }

  useEffect(() => {
    refresh()
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

  /** 上主屏 = 放一张引用卡片；留言板 Widget 不指向某一条留言（SPEC §3.2.2） */
  async function toggleHome(): Promise<void> {
    try {
      if (onHome) await removeHomeWidget('board')
      else await putHomeWidget('board', null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
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

      <div className="flex items-center justify-between gap-3 text-xs">
        <span style={{ color: 'var(--color-text-dim)' }}>主屏 Widget：展示最近 3 条留言</span>
        <button
          type="button"
          data-testid="board-home-toggle"
          data-on-home={onHome ? 'true' : 'false'}
          aria-pressed={onHome}
          title={onHome ? '点击从主屏移除' : '把留言板放到主屏'}
          onClick={() => void toggleHome()}
          className="shrink-0"
          style={{ color: onHome ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
        >
          {onHome ? '✓ 已在主屏' : '放到主屏'}
        </button>
      </div>

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
