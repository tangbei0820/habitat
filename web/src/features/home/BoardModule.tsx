import { useEffect, useState, type FormEvent } from 'react'
import type { BoardWidgetScope, Moment } from '@shared/types'
import { IconCheck } from '../../components/qixi/Icons'
import {
  createMoment,
  createMomentBookmark,
  createMomentGroup,
  deleteMomentGroup,
  deleteMoment,
  listBookmarks,
  listMomentGroups,
  listHomeWidgets,
  listMoments,
  putHomeWidget,
  removeHomeWidget,
  setMomentGroup,
  updateMoment,
  updateMomentGroup,
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
  const [groups, setGroups] = useState<import('@shared/types').MomentGroup[]>([])
  const [draft, setDraft] = useState('')
  const [draftGroupId, setDraftGroupId] = useState<string | null>(null)
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
  const [groupFilter, setGroupFilter] = useState<'all' | 'none' | string>('all')
  const [groupDraft, setGroupDraft] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupDraft, setEditingGroupDraft] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)
  /** 留言板 Widget 是否在主屏上（不同 kind 的 Widget 互不影响，各管各的） */
  const [onHome, setOnHome] = useState(false)
  const [widgetScope, setWidgetScope] = useState<BoardWidgetScope>({ kind: 'recent' })

  async function refresh(query = search, selectedGroup = groupFilter): Promise<void> {
    const apiGroup = selectedGroup === 'all' ? undefined : selectedGroup === 'none' ? null : selectedGroup
    const [nextItems, nextGroups, widgets, bookmarks] = await Promise.all([listMoments(query, apiGroup), listMomentGroups(), listHomeWidgets(), listBookmarks()])
    setItems(nextItems)
    setGroups(nextGroups)
    const boardWidget = widgets.find((widget) => widget.kind === 'board')
    setOnHome(boardWidget !== undefined)
    if (boardWidget?.boardScope !== null && boardWidget?.boardScope !== undefined && boardWidget?.boardScope.kind !== undefined) setWidgetScope(boardWidget.boardScope)
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
  }, [search, groupFilter])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const item = await createMoment(draft, draftGroupId)
      const matchesSelectedGroup = groupFilter === 'all' || (groupFilter === 'none' ? item.groupId === null : item.groupId === groupFilter)
      if (matchesSelectedGroup) setItems((current) => [item, ...current])
      setDraft('')
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function addGroup(): Promise<void> {
    try {
      const created = await createMomentGroup(groupDraft)
      setGroups((current) => [...current, created])
      setGroupDraft('')
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveGroup(id: string): Promise<void> {
    try {
      const updated = await updateMomentGroup(id, editingGroupDraft)
      setGroups((current) => current.map((group) => group.id === id ? updated : group))
      setEditingGroupId(null)
      setEditingGroupDraft('')
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeGroup(id: string): Promise<void> {
    try {
      const result = await deleteMomentGroup(id)
      setGroups((current) => current.filter((group) => group.id !== id))
      setItems((current) => current.map((item) => item.groupId === id ? { ...item, groupId: null } : item))
      if (groupFilter === id) setGroupFilter('all')
      if (draftGroupId === id) setDraftGroupId(null)
      setError(result.moved > 0 ? `分组已删除，${result.moved} 条留言回到未分组。` : null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function moveItem(item: Moment, groupId: string | null): Promise<void> {
    if (item.groupId === groupId) return
    try {
      setMovingId(item.id)
      const updated = await setMomentGroup(item.id, groupId)
      setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry).filter((entry) => groupFilter === 'all' || (groupFilter === 'none' ? entry.groupId === null : entry.groupId === groupFilter)))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMovingId(null)
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

  /** 上主屏 = 放一张范围引用卡片；正文仍从留言服务端实时读取。 */
  async function toggleHome(): Promise<void> {
    try {
      if (onHome) await removeHomeWidget('board')
      else await putHomeWidget('board', null, widgetScope)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function updateHomeScope(): Promise<void> {
    try {
      await putHomeWidget('board', null, widgetScope)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function scopeValue(scope: BoardWidgetScope): string {
    if (scope.kind === 'recent') return 'recent'
    if (scope.kind === 'group') return `group:${scope.groupId}`
    return `moment:${scope.momentId}`
  }

  function scopeFromValue(value: string): BoardWidgetScope {
    if (value === 'recent') return { kind: 'recent' }
    if (value.startsWith('group:')) return { kind: 'group', groupId: value.slice('group:'.length) }
    return { kind: 'moment', momentId: value.slice('moment:'.length) }
  }

  const visibleItems = filter === 'all' ? items : items.filter((item) => item.author === filter)
  const groupName = new Map(groups.map((group) => [group.id, group.name]))
  const history = new Map<string, Moment[]>()
  for (const item of visibleItems) {
    const date = new Date(item.createdAt)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const bucket = history.get(key) ?? []
    bucket.push(item)
    history.set(key, bucket)
  }
  const historyLabel = (timestamp: number): string => {
    const date = new Date(timestamp)
    const today = new Date()
    const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
    const delta = Math.round((dayStart(today) - dayStart(date)) / 86_400_000)
    if (delta === 0) return '今天'
    if (delta === 1) return '昨天'
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <label htmlFor="board-draft" className="mb-2 block text-sm font-medium">留下一句话</label>
        <textarea id="board-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} rows={3} placeholder="记下此刻想说的话…" className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{draft.length}/500</span>
          <span className="flex items-center gap-2">
            <label htmlFor="board-draft-group" className="sr-only">新留言分组</label>
            <select id="board-draft-group" value={draftGroupId ?? ''} onChange={(event) => setDraftGroupId(event.target.value === '' ? null : event.target.value)} className="rounded border bg-transparent px-2 py-1 text-xs" style={{ borderColor: 'var(--border-soft)' }}>
              <option value="">未分组</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <button type="submit" disabled={draft.trim() === ''} className="rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>留言</button>
          </span>
        </div>
      </form>

      <section className="rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }} data-testid="board-groups">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">留言分组</span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>删组不会删除留言</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={groupFilter === 'all'} onClick={() => setGroupFilter('all')} className="rounded-full px-3 py-1.5 text-xs" style={{ background: groupFilter === 'all' ? 'var(--bg-subtle)' : 'transparent' }}>全部</button>
          <button type="button" aria-pressed={groupFilter === 'none'} onClick={() => setGroupFilter('none')} className="rounded-full px-3 py-1.5 text-xs" style={{ background: groupFilter === 'none' ? 'var(--bg-subtle)' : 'transparent' }}>未分组</button>
          {groups.map((group) => (
            <span key={group.id} className="flex items-center gap-1 rounded-full border px-2 py-1" style={{ borderColor: groupFilter === group.id ? 'var(--accent-strong)' : 'var(--border-soft)' }}>
              {editingGroupId === group.id ? <input autoFocus value={editingGroupDraft} onChange={(event) => setEditingGroupDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveGroup(group.id); if (event.key === 'Escape') setEditingGroupId(null) }} className="w-20 bg-transparent text-xs outline-none" maxLength={30} /> : <button type="button" className="text-xs" onClick={() => setGroupFilter(group.id)}>{group.name}</button>}
              <button type="button" aria-label={`编辑分组 ${group.name}`} onClick={() => { setEditingGroupId(group.id); setEditingGroupDraft(group.name) }} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>改</button>
              <button type="button" aria-label={`删除分组 ${group.name}`} onClick={() => void removeGroup(group.id)} className="text-xs" style={{ color: 'var(--danger)' }}>删</button>
              {editingGroupId === group.id && <button type="button" onClick={() => void saveGroup(group.id)} className="text-xs" style={{ color: 'var(--accent-strong)' }}>存</button>}
            </span>
          ))}
          <form onSubmit={(event) => { event.preventDefault(); void addGroup() }} className="flex items-center gap-1">
            <input value={groupDraft} onChange={(event) => setGroupDraft(event.target.value)} placeholder="新分组" maxLength={30} className="w-20 rounded border bg-transparent px-2 py-1 text-xs" style={{ borderColor: 'var(--border-soft)' }} />
            <button type="submit" disabled={groupDraft.trim() === ''} className="text-xs disabled:opacity-40" style={{ color: 'var(--accent-strong)' }}>添加</button>
          </form>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <span className="shrink-0">主屏 Widget</span>
          <label className="min-w-0">
            <span className="sr-only">留言 Widget 展示范围</span>
            <select data-testid="board-widget-scope" value={scopeValue(widgetScope)} onChange={(event) => setWidgetScope(scopeFromValue(event.target.value))} className="max-w-44 rounded border bg-transparent px-2 py-1 text-xs" style={{ borderColor: 'var(--border-soft)' }}>
              <option value="recent">最近 3 条留言</option>
              {groups.map((group) => <option key={`widget-group-${group.id}`} value={`group:${group.id}`}>分组：{group.name}</option>)}
              {items.map((item) => <option key={`widget-moment-${item.id}`} value={`moment:${item.id}`}>留言：{item.content.slice(0, 18)}</option>)}
            </select>
          </label>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {onHome && <button type="button" data-testid="board-widget-apply" onClick={() => void updateHomeScope()} style={{ color: 'var(--accent-strong)' }}>更新范围</button>}
          <button
            type="button"
            data-testid="board-home-toggle"
            data-on-home={onHome ? 'true' : 'false'}
            aria-pressed={onHome}
            title={onHome ? '点击从主屏移除' : '把留言板放到主屏'}
            onClick={() => void toggleHome()}
            style={{ color: onHome ? 'var(--accent-strong)' : 'var(--text-secondary)' }}
          >
            <span className="flex items-center gap-1">
              {onHome && <IconCheck size={13} />}
              {onHome ? '已在主屏' : '放到主屏'}
            </span>
          </button>
        </span>
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
        <div className="space-y-5">
          {[...history.entries()].map(([key, dayItems]) => (
            <section key={key}>
              <h3 className="mb-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{historyLabel(dayItems[0]?.createdAt ?? Date.now())}</h3>
              <ul className="space-y-2">
          {dayItems.map((item) => (
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
                  {item.groupId !== null && groupName.has(item.groupId) && <span>{groupName.get(item.groupId)} · </span>}
                  <time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                  {item.updatedAt !== item.createdAt && <span> · 已编辑</span>}
                </span>
                <span className="flex items-center gap-3">
                  <label className="flex items-center gap-1">
                    <span className="sr-only">留言分组</span>
                    <select aria-label={`设置留言分组 ${item.content.slice(0, 12)}`} value={item.groupId ?? ''} disabled={movingId === item.id} onChange={(event) => void moveItem(item, event.target.value === '' ? null : event.target.value)} className="max-w-24 rounded border bg-transparent px-1 py-0.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>
                      <option value="">未分组</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                  </label>
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
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
