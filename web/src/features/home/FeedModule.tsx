import { useEffect, useState, type FormEvent } from 'react'
import type { Moment } from '@shared/types'
import { IconHeart, IconSparkle } from '../../components/qixi/Icons'
import { createMoment, createMomentBookmark, deleteMoment, listBookmarks, listMoments, updateMoment } from '../../db/home'
import { appendBookmarkLifeEvent } from '../life/api'

function historyLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const delta = Math.round((dayStart(today) - dayStart(date)) / 86_400_000)
  if (delta === 0) return '今天'
  if (delta === 1) return '昨天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** 朋友圈第一阶段：双方文字动态共用 Moment 事实源，但不与留言板混在同一入口。 */
export function FeedModule() {
  const [items, setItems] = useState<Moment[]>([])
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<'all' | 'user' | 'companion'>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const [nextItems, bookmarks] = await Promise.all([listMoments(undefined, undefined, 'feed'), listBookmarks()])
    setItems(nextItems)
    setFavoriteIds(new Set(bookmarks.filter((item) => item.targetType === 'moment').map((item) => item.targetId)))
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const created = await createMoment(draft, null, 'feed')
      setItems((current) => [created, ...current])
      setDraft('')
      setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  function startEdit(item: Moment): void {
    setEditingId(item.id)
    setEditingDraft(item.content)
    setDeletingId(null)
  }

  async function saveEdit(id: string): Promise<void> {
    try {
      setBusyId(id)
      const updated = await updateMoment(id, editingDraft)
      setItems((current) => current.map((item) => item.id === id ? updated : item))
      setEditingId(null)
      setEditingDraft('')
      setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) { setDeletingId(id); return }
    try {
      await deleteMoment(id)
      setItems((current) => current.filter((item) => item.id !== id))
      setDeletingId(null)
      setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function favorite(item: Moment): Promise<void> {
    if (favoriteIds.has(item.id)) return
    try {
      setBusyId(item.id)
      const created = await createMomentBookmark(item)
      void appendBookmarkLifeEvent({ eventType: 'bookmark.created', bookmarkId: created.id, targetType: created.targetType, title: created.title }).catch(() => undefined)
      setFavoriteIds((current) => new Set(current).add(item.id))
      setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  const visible = filter === 'all' ? items : items.filter((item) => item.author === filter)
  return <div className="space-y-4" data-testid="feed-module">
    <section className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-start gap-3"><IconSparkle size={18} /><div><h2 className="text-sm font-medium">分享此刻</h2><p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>这里是双方主动留下的生活动态；私密日记和独处记录不会自动公开。</p></div></div>
      <form onSubmit={(event) => void submit(event)} className="mt-3 grid gap-2">
        <textarea data-testid="feed-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} rows={3} placeholder="今天有什么想分享的？" className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <div className="flex items-center justify-between gap-3"><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{draft.length}/500 · 当前支持文字动态</span><button type="submit" data-testid="feed-submit" disabled={draft.trim() === ''} className="btn-pill" style={{ minHeight: 38, padding: '0 16px', fontSize: 12.5 }}>发布动态</button></div>
      </form>
    </section>
    <div className="flex items-center gap-2" role="tablist" aria-label="朋友圈筛选" data-testid="feed-filters">
      {([['all', '全部'], ['user', '我的'], ['companion', '小栖']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: filter === value ? 'var(--accent-strong)' : 'var(--border-soft)', color: filter === value ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{label}</button>)}
    </div>
    {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在整理朋友圈……</p> : visible.length === 0 ? <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>还没有动态。想说什么，就先留下一句吧。</p> : <div className="space-y-3" role="feed">{visible.map((item) => <article key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }} data-testid="feed-post">
      <div className="flex items-start justify-between gap-3"><div><strong className="text-sm">{item.author === 'companion' ? '小栖' : '你'}</strong><time className="ml-2 text-xs" style={{ color: 'var(--text-tertiary)' }} dateTime={new Date(item.createdAt).toISOString()}>{historyLabel(item.createdAt)} · {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.updatedAt !== item.createdAt ? '已编辑' : '动态'}</span></div>
      {editingId === item.id ? <div className="mt-3 grid gap-2"><textarea value={editingDraft} onChange={(event) => setEditingDraft(event.target.value)} maxLength={500} rows={3} className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} /><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingId(null)} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>取消</button><button type="button" disabled={busyId === item.id || editingDraft.trim() === ''} onClick={() => void saveEdit(item.id)} className="rounded-full px-3 py-1.5 text-xs disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>保存</button></div></div> : <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>}
      {editingId !== item.id && <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button type="button" disabled={favoriteIds.has(item.id) || busyId === item.id} onClick={() => void favorite(item)} className="inline-flex items-center gap-1 disabled:opacity-60" style={{ color: favoriteIds.has(item.id) ? 'var(--accent-strong)' : 'var(--text-secondary)' }}><IconHeart size={14} filled={favoriteIds.has(item.id)} />{favoriteIds.has(item.id) ? '已收藏' : '收藏'}</button>{item.author === 'user' && <><button type="button" onClick={() => startEdit(item)} style={{ color: 'var(--accent-strong)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></>}</div>}
    </article>)}</div>}
  </div>
}
