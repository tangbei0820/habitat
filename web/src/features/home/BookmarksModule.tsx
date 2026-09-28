/**
 * 收藏中心（SPEC §3.5.4）
 *
 * 分类是**单归属**的收纳维度：一条收藏最多属于一个分类，没选中就是「未分类」。
 * 想给一条收藏同时挂多个维度，那是「标签」要干的事（SPEC 里明确列在后续），不让分类兼任。
 *
 * 分类的管理（新建 / 重命名 / 删除）全在筛选条的「⋯」里，
 * 条目本身只有一枚「⋯」—— 收藏卡片本来就高，行内再并排几个按钮会把内容挤没。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Bookmark, BookmarkCategory } from '@shared/types'
import { ActionSheet, type SheetAction } from '../../components/ActionSheet'
import {
  createBookmarkCategory,
  createExternalBookmark,
  deleteBookmark,
  deleteBookmarkCategory,
  listBookmarkCategories,
  listBookmarks,
  renameBookmarkCategory,
  setBookmarkCategory,
} from '../../db/home'
import { CategoryBar } from './CategoryBar'
import {
  countByCategory,
  filterByCategory,
  normalizeSelection,
  type CategorySelection,
} from './categories'
import { ContentSourceLink } from './ContentSourceLink'
import { appendBookmarkLifeEvent } from '../life/api'

type SheetTarget = { kind: 'item'; id: string } | { kind: 'move'; id: string }

/** 二次确认的自动退回时间：确认态不该在列表里长期挂着 */
const CONFIRM_MS = 3000
const TOAST_MS = 2500

function emitBookmarkLifeEvent(event: Parameters<typeof appendBookmarkLifeEvent>[0]): void {
  /* Life 是跨模块投影；收藏中心必须在服务端短暂不可用时仍可用。 */
  void appendBookmarkLifeEvent(event).catch(() => undefined)
}

export function BookmarksModule() {
  const [items, setItems] = useState<Bookmark[]>([])
  const [categories, setCategories] = useState<BookmarkCategory[]>([])
  const [selection, setSelection] = useState<CategorySelection>({ kind: 'all' })
  const [title, setTitle] = useState('')
  const [href, setHref] = useState('')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** 从「移入分类 → 新建分类」进来时记住这条收藏，建完直接放进去，省掉「移入」的第二趟 */
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null)
  /** 递增即请求筛选条打开「新建分类」弹层（弹层状态在 CategoryBar 内部） */
  const [createToken, setCreateToken] = useState(0)
  const confirmTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(
    () => () => {
      for (const ref of [confirmTimerRef, toastTimerRef]) {
        if (ref.current !== null) window.clearTimeout(ref.current)
      }
    },
    [],
  )

  async function refresh(): Promise<void> {
    const [nextItems, nextCategories] = await Promise.all([listBookmarks(), listBookmarkCategories()])
    setItems(nextItems)
    setCategories(nextCategories)
    setSelection((prev) => normalizeSelection(prev, nextCategories))
  }

  function showToast(message: string): void {
    setToast(message)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }

  function askRemove(id: string): void {
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current)
    setConfirmingId(id)
    confirmTimerRef.current = window.setTimeout(() => setConfirmingId(null), CONFIRM_MS)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      const created = await createExternalBookmark(title, href, note)
      emitBookmarkLifeEvent({ eventType: 'bookmark.created', bookmarkId: created.id, targetType: created.targetType, title: created.title })
      setTitle('')
      setHref('')
      setNote('')
      setError(null)
      await refresh()
      // 新收藏一律落在「未分类」。若正筛着某个分类，它会连影子都不出现 ——
      // 看起来就是「刚加的丢了」，所以回到「全部」让这条真的出现在眼前
      setSelection({ kind: 'all' })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      const item = items.find((candidate) => candidate.id === id)
      await deleteBookmark(id)
      if (item !== undefined) emitBookmarkLifeEvent({ eventType: 'bookmark.deleted', bookmarkId: item.id, targetType: item.targetType, title: item.title })
      setConfirmingId(null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function applyMove(bookmarkId: string, categoryId: string | null): Promise<void> {
    const bookmark = items.find((item) => item.id === bookmarkId)
    await setBookmarkCategory(bookmarkId, categoryId)
    if (bookmark !== undefined) {
      const categoryName = categoryId === null ? null : (categories.find((category) => category.id === categoryId)?.name ?? null)
      emitBookmarkLifeEvent({ eventType: 'bookmark.category.updated', bookmarkId: bookmark.id, targetType: bookmark.targetType, title: bookmark.title, categoryId, categoryName })
    }
    await refresh()
    setError(null)
    const name = categoryId === null ? null : (categories.find((c) => c.id === categoryId)?.name ?? null)
    showToast(name === null ? '已移出分类' : `已移入「${name}」`)
  }

  async function removeCategory(categoryId: string): Promise<void> {
    const moved = await deleteBookmarkCategory(categoryId)
    await refresh()
    showToast(moved === 0 ? '已删除分类' : `已删除分类，${moved} 条回到未分类`)
  }

  const counts = useMemo(
    () => countByCategory(items, categories, (item) => item.categoryId),
    [items, categories],
  )
  const visible = useMemo(
    () => filterByCategory(items, selection, categories, (item) => item.categoryId).filter((item) => {
      const query = search.trim().toLocaleLowerCase()
      if (query === '') return true
      const sourceMetadata = Object.entries(item.metadata ?? {})
        .filter(([key]) => key.startsWith('source'))
        .map(([, value]) => typeof value === 'string' || typeof value === 'number' ? String(value) : '')
      return [item.title, item.note ?? '', item.targetId, ...sourceMetadata].join('\n').toLocaleLowerCase().includes(query)
    }),
    [items, selection, categories, search],
  )

  const sheetActions = useMemo<SheetAction[] | null>(() => {
    if (sheet === null) return null
    const bookmark = items.find((item) => item.id === sheet.id)
    if (bookmark === undefined) return null
    if (sheet.kind === 'move') {
      const current = bookmark.categoryId
      return [
        // 当前所在分类不列出来：点了等于原地不动
        ...categories
          .filter((category) => category.id !== current)
          .map((category) => ({ id: `category:${category.id}`, label: category.name })),
        { id: 'move-new-category', label: '＋ 新建分类' },
        ...(current === null ? [] : [{ id: 'move-none', label: '移出分类' }]),
      ]
    }
    return [
      { id: 'move', label: '移入分类' },
      ...(bookmark.categoryId === null ? [] : [{ id: 'unassign', label: '移出分类' }]),
      { id: 'delete', label: '删除收藏', danger: true },
    ]
  }, [sheet, items, categories])

  const sheetTitle = useMemo(() => {
    if (sheet === null) return undefined
    const bookmark = items.find((item) => item.id === sheet.id)
    if (bookmark === undefined) return undefined
    return sheet.kind === 'move' ? `把「${bookmark.title}」移到…` : bookmark.title
  }, [sheet, items])

  async function runSheetAction(actionId: string): Promise<void> {
    if (sheet === null) return
    const target = sheet
    setSheet(null)
    try {
      if (target.kind === 'move') {
        if (actionId === 'move-new-category') {
          setPendingMoveId(target.id)
          setCreateToken((token) => token + 1)
        } else if (actionId === 'move-none') {
          await applyMove(target.id, null)
        } else if (actionId.startsWith('category:')) {
          await applyMove(target.id, actionId.slice('category:'.length))
        }
        return
      }
      if (actionId === 'move') setSheet({ kind: 'move', id: target.id })
      else if (actionId === 'unassign') await applyMove(target.id, null)
      else if (actionId === 'delete') askRemove(target.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const filteredOut = !loading && items.length > 0 && visible.length === 0

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <h2 className="text-sm font-semibold">收藏一个链接</h2>
        <label htmlFor="bookmark-title" className="sr-only">收藏名称</label>
        <input id="bookmark-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="收藏名称" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <label htmlFor="bookmark-url" className="sr-only">链接地址</label>
        <input id="bookmark-url" type="url" inputMode="url" value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://example.com" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <label htmlFor="bookmark-note" className="sr-only">备注</label>
        <textarea id="bookmark-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} placeholder="为什么想留下它？（可选）" className="resize-none rounded-lg border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <button type="submit" disabled={title.trim() === '' || href.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>加入收藏</button>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

      <CategoryBar
        noun="分类"
        categories={categories}
        selection={selection}
        counts={counts}
        createToken={createToken}
        onSelect={setSelection}
        onCreate={async (name) => {
          const created = await createBookmarkCategory(name)
          await refresh()
          if (pendingMoveId !== null) {
            await applyMove(pendingMoveId, created.id)
            setPendingMoveId(null)
          }
        }}
        onRename={async (id, name) => {
          await renameBookmarkCategory(id, name)
          await refresh()
        }}
        onDelete={removeCategory}
      />

      <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <label htmlFor="bookmark-search" className="sr-only">搜索收藏</label>
        <input id="bookmark-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="搜索标题、备注或来源" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        {search !== '' && <button type="button" onClick={() => setSearch('')} className="text-xs" style={{ color: 'var(--text-secondary)' }}>清除</button>}
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在整理收藏……</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>还没有收藏。遇到想再回来的地方，就放在这里。</p>
      ) : filteredOut ? (
        <p data-testid="bookmark-filter-empty" className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>{search === '' ? '这个筛选下还没有收藏。' : '没有找到匹配的收藏。'}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <li key={item.id} data-testid={`bookmark-row-${item.id}`} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
              {item.targetType === 'external-link' ? (
                <a href={item.targetId} target="_blank" rel="noreferrer" className="font-medium underline decoration-1 underline-offset-4" style={{ color: 'var(--accent-strong)' }}>{item.title}</a>
              ) : <p className="font-medium">{item.title}</p>}
              {item.targetType === 'moment' ? (
                <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>留言原文快照</p>
              ) : <p className="mt-1 break-all text-xs" style={{ color: 'var(--text-secondary)' }}>{item.targetId}</p>}
              {item.note !== null && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.note}</p>}
              <ContentSourceLink item={item} />
              <div className="mt-3 flex justify-end">
                {confirmingId === item.id ? (
                  <button
                    type="button"
                    data-testid={`bookmark-confirm-${item.id}`}
                    onClick={() => void remove(item.id)}
                    className="rounded border px-2 py-0.5 text-xs"
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  >
                    确认删除？
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`bookmark-menu-${item.id}`}
                    aria-label={`收藏操作：${item.title}`}
                    onClick={() => setSheet({ kind: 'item', id: item.id })}
                    className="px-2 text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    ⋯
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {toast !== null && (
        <p
          data-testid="list-toast"
          className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-2 text-sm"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
        >
          {toast}
        </p>
      )}

      <ActionSheet
        actions={sheetActions}
        title={sheetTitle}
        onSelect={(id) => void runSheetAction(id)}
        onClose={() => setSheet(null)}
      />
    </div>
  )
}
