import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DailyReadingEntry, HomeWidget, ReadingAnnotation, ReadingNote } from '@shared/types'
import {
  addReadingAnnotation,
  createReadingAnnotationBookmark,
  createReadingExcerptBookmark,
  deleteDailyReading,
  getReadingBook,
  listBookmarks,
  listDailyReadings,
  listHomeWidgets,
  listReadingNotes,
  pickDailyReading,
  putHomeWidget,
  removeHomeWidget,
} from '../../db/home'
import { fetchJson } from '../../lib/api'
import { appendBookmarkLifeEvent, appendReadingLifeEvent } from '../life/api'

function dateLabel(at: number): string {
  return new Date(at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 每日品读：复用共读书架的段落锚点，让片段、双方批注、收藏和主屏入口指向同一份来源事实。 */
export function DailyReadingModule() {
  const [history, setHistory] = useState<DailyReadingEntry[]>([])
  const [books, setBooks] = useState<ReadingNote[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [annotationFavoriteIds, setAnnotationFavoriteIds] = useState<Set<string>>(new Set())
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [dailyWidget, setDailyWidget] = useState<HomeWidget | null>(null)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [companionBusy, setCompanionBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = history.find((item) => item.id === currentId) ?? history[0] ?? null
  const sourceBook = current === null ? null : books.find((item) => item.id === current.sourceBookId) ?? null
  const sourceAnnotations = useMemo(() => {
    if (current === null || sourceBook === null) return []
    return getReadingBook(sourceBook)?.annotations.filter((item) => item.paragraphIndex === current.paragraphIndex) ?? []
  }, [current, sourceBook])
  const filteredHistory = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return history
    return history.filter((item) => `${item.bookTitle} ${item.author ?? ''} ${item.text}`.toLocaleLowerCase().includes(needle))
  }, [history, query])

  async function load(): Promise<void> {
    const [nextHistory, nextBooks, bookmarks, widgets] = await Promise.all([listDailyReadings(), listReadingNotes(), listBookmarks(), listHomeWidgets()])
    let entries = nextHistory
    if (entries.length === 0) {
      const first = await pickDailyReading()
      entries = first === null ? [] : [first]
    }
    setHistory(entries)
    setBooks(nextBooks)
    setFavoriteIds(new Set(bookmarks.filter((item) => item.targetType === 'reading-excerpt').map((item) => item.targetId)))
    setAnnotationFavoriteIds(new Set(bookmarks.filter((item) => item.targetType === 'reading-annotation').map((item) => item.targetId)))
    setDailyWidget(widgets.find((item) => item.kind === 'daily-reading') ?? null)
    setCurrentId((previous) => previous !== null && entries.some((item) => item.id === previous) ? previous : entries[0]?.id ?? null)
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  async function swap(): Promise<void> {
    setBusy(true); setError(null)
    try {
      const next = await pickDailyReading()
      if (next === null) throw new Error('书架里还没有可供品读的 TXT 片段')
      setHistory((previous) => [next, ...previous]); setCurrentId(next.id); setAnnotationOpen(false); setAnnotationDraft('')
      if (dailyWidget !== null) {
        await putHomeWidget('daily-reading', next.id)
        setDailyWidget({ ...dailyWidget, refId: next.id, updatedAt: Date.now() })
      }
      void appendReadingLifeEvent({ eventType: 'reading.daily.swapped', bookId: next.sourceBookId, bookTitle: next.bookTitle, paragraphIndex: next.paragraphIndex, mode: 'daily' }).catch(() => undefined)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function favorite(): Promise<void> {
    if (current === null || favoriteIds.has(current.id)) return
    setBusy(true); setError(null)
    try {
      const created = await createReadingExcerptBookmark(current)
      setFavoriteIds((previous) => new Set(previous).add(current.id))
      void appendBookmarkLifeEvent({ eventType: 'bookmark.created', bookmarkId: created.id, targetType: created.targetType, title: created.title }).catch(() => undefined)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function favoriteAnnotation(annotation: ReadingAnnotation): Promise<void> {
    if (current === null || annotationFavoriteIds.has(annotation.id)) return
    setBusy(true); setError(null)
    try {
      const created = await createReadingAnnotationBookmark(current, annotation)
      setAnnotationFavoriteIds((previous) => new Set(previous).add(annotation.id))
      void appendBookmarkLifeEvent({ eventType: 'bookmark.created', bookmarkId: created.id, targetType: created.targetType, title: created.title }).catch(() => undefined)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function saveAnnotation(): Promise<void> {
    if (current === null || sourceBook === null || annotationDraft.trim() === '') return
    setBusy(true); setError(null)
    try {
      const next = await addReadingAnnotation(current.sourceBookId, current.paragraphIndex, current.text, annotationDraft, 'user')
      setBooks((previous) => previous.map((item) => item.id === next.id ? next : item))
      setAnnotationDraft(''); setAnnotationOpen(false)
      void appendReadingLifeEvent({ eventType: 'reading.daily.annotation', bookId: current.sourceBookId, bookTitle: current.bookTitle, paragraphIndex: current.paragraphIndex, mode: 'daily', annotationAuthor: 'user' }).catch(() => undefined)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function requestCompanionComment(): Promise<void> {
    if (current === null) return
    setCompanionBusy(true); setError(null)
    try {
      const result = await fetchJson<{ comment: string }>('/api/reading/daily/comment', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookTitle: current.bookTitle, author: current.author, excerpt: current.text,
          annotations: sourceAnnotations.map((item) => ({ author: item.author, note: item.note, text: item.text })),
        }),
      })
      const next = await addReadingAnnotation(current.sourceBookId, current.paragraphIndex, current.text, result.comment, 'companion')
      setBooks((previous) => previous.map((item) => item.id === next.id ? next : item))
      void appendReadingLifeEvent({ eventType: 'reading.daily.comment', bookId: current.sourceBookId, bookTitle: current.bookTitle, paragraphIndex: current.paragraphIndex, mode: 'daily', annotationAuthor: 'companion' }).catch(() => undefined)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setCompanionBusy(false) }
  }

  async function toggleWidget(): Promise<void> {
    if (current === null) return
    setBusy(true); setError(null)
    try {
      if (dailyWidget === null) {
        await putHomeWidget('daily-reading', current.id)
        const widgets = await listHomeWidgets()
        setDailyWidget(widgets.find((item) => item.kind === 'daily-reading') ?? null)
      } else {
        await removeHomeWidget('daily-reading')
        setDailyWidget(null)
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function removeHistory(id: string): Promise<void> {
    setBusy(true); setError(null)
    try {
      await deleteDailyReading(id)
      const nextHistory = history.filter((item) => item.id !== id)
      setHistory(nextHistory); setDeletingId(null)
      if (currentId === id) setCurrentId(nextHistory[0]?.id ?? null)
      if (dailyWidget?.refId === id) {
        await removeHomeWidget('daily-reading')
        setDailyWidget(null)
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4" data-testid="daily-reading">
      <section className="rounded-lg border p-5" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>今日 · 每日品读</p>
            <h2 className="mt-1 text-lg font-semibold">留一段文字，和小栖慢慢读</h2>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>片段来自你的共读书架；每条批注都保留作品、段落与作者来源。</p>
          </div>
          <button type="button" data-testid="daily-reading-swap" onClick={() => void swap()} disabled={busy || loading} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--accent-strong)' }}>换一段</button>
        </div>
        {loading ? <p className="mt-6 text-sm" style={{ color: 'var(--text-secondary)' }}>正在翻找一段文字……</p> : current === null ? (
          <div className="mt-6 rounded-lg border p-5 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>
            还没有可品读的片段。<Link to="/home/reading" className="ml-1 underline" style={{ color: 'var(--accent-strong)' }}>先去共读书架导入 TXT</Link>
          </div>
        ) : (
          <article className="mt-6" data-testid="daily-reading-excerpt" id={current.id}>
            <blockquote className="border-l-2 pl-4 text-base leading-8" style={{ borderColor: 'var(--accent-strong)', color: 'var(--text-primary)' }}>{current.text}</blockquote>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>《{current.bookTitle}》</span><span>·</span><span>{current.author ?? '作者未标注'}</span><span>·</span><span>第 {current.paragraphIndex + 1} 段</span>
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}><time dateTime={new Date(current.createdAt).toISOString()}>{dateLabel(current.createdAt)}</time> · 来源可回到原书</div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <Link to={`/home/reading#${encodeURIComponent(current.sourceBookId)}`} className="underline" style={{ color: 'var(--accent-strong)' }}>打开原书</Link>
              <button type="button" onClick={() => void favorite()} disabled={busy || favoriteIds.has(current.id)} style={{ color: favoriteIds.has(current.id) ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{favoriteIds.has(current.id) ? '已收藏片段' : '收藏片段'}</button>
              <button type="button" onClick={() => void toggleWidget()} disabled={busy} style={{ color: 'var(--text-secondary)' }}>{dailyWidget === null ? '放到首页 Widget' : '撤下首页 Widget'}</button>
              <button type="button" onClick={() => setAnnotationOpen((value) => !value)} style={{ color: 'var(--text-secondary)' }}>{annotationOpen ? '收起批注' : '写下批注'}</button>
              <button type="button" data-testid="daily-reading-companion-comment" onClick={() => void requestCompanionComment()} disabled={busy || companionBusy} style={{ color: 'var(--accent-strong)' }}>{companionBusy ? '小栖正在读……' : '请小栖回应'}</button>
            </div>
            {annotationOpen && <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }}><label htmlFor="daily-reading-annotation" className="sr-only">品读批注</label><textarea id="daily-reading-annotation" data-testid="daily-reading-annotation" value={annotationDraft} onChange={(event) => setAnnotationDraft(event.target.value)} maxLength={2000} rows={3} placeholder="写下你想和小栖分享的想法……" className="w-full resize-y rounded-lg border bg-transparent p-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} /><div className="mt-2 flex justify-end"><button type="button" onClick={() => void saveAnnotation()} disabled={busy || annotationDraft.trim() === ''} className="rounded-full px-3 py-1.5 text-xs" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>保存批注</button></div></div>}
            {sourceAnnotations.length > 0 && <div className="mt-4 space-y-2" data-testid="daily-reading-annotations"><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>这段文字的批注</p>{sourceAnnotations.map((item) => <div key={item.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: item.author === 'companion' ? 'var(--accent-strong)' : 'var(--border-soft)' }}><div className="flex items-start justify-between gap-2"><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.author === 'companion' ? '小栖' : '你'} · {dateLabel(item.createdAt)}</span><button type="button" onClick={() => void favoriteAnnotation(item)} disabled={busy || annotationFavoriteIds.has(item.id)} className="text-xs" style={{ color: annotationFavoriteIds.has(item.id) ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{annotationFavoriteIds.has(item.id) ? '已收藏' : '收藏'}</button></div><p className="mt-2 whitespace-pre-wrap">{item.note || '（只标记了这段文字）'}</p></div>)}</div>}
          </article>
        )}
        {error !== null && <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      </section>
      <section className="rounded-lg border p-5" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }} data-testid="daily-reading-history">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">品读历史</h3><span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{history.length} 段</span></div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-soft)' }}><label htmlFor="daily-reading-search" className="sr-only">搜索品读历史</label><input id="daily-reading-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名、作者或片段" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />{query !== '' && <button type="button" onClick={() => setQuery('')} className="text-xs" style={{ color: 'var(--text-secondary)' }}>清除</button>}</div>
        {history.length === 0 ? <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>换一段之后，读过的文字会留在这里。</p> : filteredHistory.length === 0 ? <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>没有找到匹配的品读记录。</p> : <ul className="mt-3 space-y-2">{filteredHistory.slice(0, 12).map((item) => <li key={item.id} className="flex items-stretch gap-2"><button type="button" onClick={() => { setCurrentId(item.id); setAnnotationOpen(false) }} className="min-w-0 flex-1 rounded-lg border p-3 text-left" style={{ borderColor: item.id === current?.id ? 'var(--accent-strong)' : 'var(--border-soft)' }}><span className="block truncate text-sm">{item.text}</span><span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>《{item.bookTitle}》 · {dateLabel(item.createdAt)}</span></button>{deletingId === item.id ? <button type="button" onClick={() => void removeHistory(item.id)} disabled={busy} className="shrink-0 rounded-lg border px-2 text-xs" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>确认删除</button> : <button type="button" onClick={() => setDeletingId(item.id)} disabled={busy} aria-label={`删除品读记录：${item.bookTitle}`} className="shrink-0 px-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>删除</button>}</li>)}</ul>}
      </section>
    </div>
  )
}
