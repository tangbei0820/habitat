import { useEffect, useState, type FormEvent } from 'react'
import type { Moment } from '@shared/types'
import { IconCheck } from '../../components/qixi/Icons'
import {
  createMoment,
  createMomentBookmark,
  deleteMoment,
  listBookmarks,
  listHomeWidgets,
  listMoments,
  putHomeWidget,
  removeHomeWidget,
  updateMoment,
} from '../../db/home'
import { appendBookmarkLifeEvent } from '../life/api'

function emitBookmarkLifeEvent(event: Parameters<typeof appendBookmarkLifeEvent>[0]): void {
  void appendBookmarkLifeEvent(event).catch(() => undefined)
}

/**
 * 留言板（SPEC §3.3）。
 *
 * 与日记不同，这里**没有私密一说** —— 写出来就是给人看的，所以小栖的留言照样显示正文。
 * 编辑与删除都按作者隔离：用户能改 / 删自己的；小栖通过 Runtime 改自己的，用户不代替小栖改内容。
 */
export function BoardModule() {
  const [items, setItems] = useState<Moment[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoritingId, setFavoritingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'user' | 'companion'>('all')
  const [search, setSearch] = useState('')
  /** 留言板 Widget 是否在主屏上（不同 kind 的 Widget 互不影响，各管各的） */
  const [onHome, setOnHome] = useState(false)

  async function refresh(query = search): Promise<void> {
    const [nextItems, widgets, bookmarks] = await Promise.all([listMoments(query), listHomeWidgets(), listBookmarks()])
    setItems(nextItems)
    setOnHome(widgets.some((widget) => widget.kind === 'board'))
    setFavoriteIds(new Set(bookmarks.filter((item) => item.targetType === 'moment').map((item) => item.targetId)))
  }

  useEffect(() => {
    setLoading(true)
    const timer = window.setTimeout(() => {
      refresh(search)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [search])

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
    try {
      await deleteMoment(id)
      setItems((current) => current.filter((item) => item.id !== id))
      setDeleting(null)
      setError(null)
    } catch (err: unknown) {
      setDeleting(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function startEdit(item: Moment): void {
    setEditingId(item.id)
    setEditingDraft(item.content)
    setDeleting(null)
    setError(null)
  }

  function cancelEdit(): void {
    setEditingId(null)
    setEditingDraft('')
  }

  async function saveEdit(id: string): Promise<void> {
    try {
      setSavingId(id)
      const updated = await updateMoment(id, editingDraft)
      setItems((current) => current.map((item) => item.id === id ? updated : item))
      cancelEdit()
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  async function favorite(item: Moment): Promise<void> {
    if (favoriteIds.has(item.id)) return
    try {
      setFavoritingId(item.id)
      const created = await createMomentBookmark(item)
      emitBookmarkLifeEvent({ eventType: 'bookmark.created', bookmarkId: created.id, targetType: created.targetType, title: created.title })
      setFavoriteIds((current) => new Set(current).add(item.id))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFavoritingId(null)
    }
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

  const visibleItems = filter === 'all' ? items : items.filter((item) => item.author === filter)

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <label htmlFor="board-draft" className="mb-2 block text-sm font-medium">留下一句话</label>
        <textarea id="board-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} rows={3} placeholder="记下此刻想说的话…" className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{draft.length}/500</span>
          <button type="submit" disabled={draft.trim() === ''} className="rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>留言</button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-3 text-xs">
        <span style={{ color: 'var(--text-secondary)' }}>主屏 Widget：展示最近 3 条留言</span>
        <button
          type="button"
          data-testid="board-home-toggle"
          data-on-home={onHome ? 'true' : 'false'}
          aria-pressed={onHome}
          title={onHome ? '点击从主屏移除' : '把留言板放到主屏'}
          onClick={() => void toggleHome()}
          className="shrink-0"
          style={{ color: onHome ? 'var(--accent-strong)' : 'var(--text-secondary)' }}
        >
          <span className="flex items-center gap-1">
            {onHome && <IconCheck size={13} />}
            {onHome ? '已在主屏' : '放到主屏'}
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border-soft)' }} data-testid="board-filter">
        {([['all', '全部'], ['user', '我写的'], ['companion', '小栖写的']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="rounded-full px-3 py-1.5 text-xs"
            style={{ background: filter === value ? 'var(--bg-subtle)' : 'transparent', color: filter === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-tertiary)' }}>{visibleItems.length} 条</span>
      </div>

      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <label htmlFor="board-search" className="sr-only">搜索留言</label>
        <input id="board-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="搜索留言内容" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        {search !== '' && <button type="button" onClick={() => setSearch('')} className="text-xs" style={{ color: 'var(--text-secondary)' }}>清除</button>}
      </div>
      {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取留言…</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>{search === '' ? '还没有留言。第一条就从今天开始。' : '没有找到匹配的留言。'}</p>
      ) : visibleItems.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>这一栏还没有留言。</p>
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((item) => (
            <li id={item.id} key={item.id} data-testid="moment-item" data-author={item.author} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
              {editingId === item.id ? (
                <div className="space-y-2">
                  <label htmlFor={`moment-edit-${item.id}`} className="sr-only">编辑留言</label>
                  <textarea
                    id={`moment-edit-${item.id}`}
                    value={editingDraft}
                    onChange={(event) => setEditingDraft(event.target.value)}
                    maxLength={500}
                    rows={3}
                    className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm"
                    style={{ borderColor: 'var(--border-soft)' }}
                  />
                  <div className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>{editingDraft.length}/500</span>
                    <span className="flex items-center gap-3">
                      <button type="button" onClick={cancelEdit}>取消</button>
                      <button type="button" data-testid="moment-save" disabled={editingDraft.trim() === '' || savingId === item.id} onClick={() => void saveEdit(item.id)} style={{ color: 'var(--accent-strong)' }}>{savingId === item.id ? '保存中…' : '保存修改'}</button>
                    </span>
                  </div>
                </div>
              ) : <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>}
              <div className="mt-3 flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>
                  {item.author === 'companion' && <span style={{ color: 'var(--accent-strong)' }}>小栖 · </span>}
                  <time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                  {item.updatedAt !== item.createdAt && <span> · 已编辑</span>}
                </span>
                <span className="flex items-center gap-3">
                  <button type="button" data-testid="moment-favorite" disabled={favoritingId === item.id || favoriteIds.has(item.id)} onClick={() => void favorite(item)} style={{ color: favoriteIds.has(item.id) ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{favoriteIds.has(item.id) ? '已收藏' : favoritingId === item.id ? '收藏中…' : '收藏'}</button>
                  {item.author === 'user' && editingId !== item.id && <button type="button" data-testid="moment-edit-button" onClick={() => startEdit(item)}>编辑</button>}
                  {item.author === 'user' && (
                    <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeleting(null)} style={{ color: deleting === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deleting === item.id ? '确认删除？' : '删除'}</button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
