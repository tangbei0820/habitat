import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DailyReadingEntry, ReadingNote } from '@shared/types'
import {
  addReadingAnnotation,
  createReadingExcerptBookmark,
  getReadingBook,
  listBookmarks,
  listDailyReadings,
  listReadingNotes,
  pickDailyReading,
} from '../../db/home'
import { appendBookmarkLifeEvent, appendReadingLifeEvent } from '../life/api'

function dateLabel(at: number): string {
  return new Date(at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 每日品读第一阶段：从已有书架取可追溯片段，不伪造外部文学正文。 */
export function DailyReadingModule() {
  const [history, setHistory] = useState<DailyReadingEntry[]>([])
  const [books, setBooks] = useState<ReadingNote[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = history.find((item) => item.id === currentId) ?? history[0] ?? null
  const sourceBook = current === null ? null : books.find((item) => item.id === current.sourceBookId) ?? null
  const sourceAnnotations = useMemo(() => {
    if (current === null || sourceBook === null) return []
    return getReadingBook(sourceBook)?.annotations.filter((item) => item.paragraphIndex === current.paragraphIndex) ?? []
  }, [current, sourceBook])

  async function load(): Promise<void> {
    const [nextHistory, nextBooks, bookmarks] = await Promise.all([listDailyReadings(), listReadingNotes(), listBookmarks()])
    let entries = nextHistory
    if (entries.length === 0) {
      const first = await pickDailyReading()
      entries = first === null ? [] : [first]
    }
    setHistory(entries); setBooks(nextBooks)
    setFavoriteIds(new Set(bookmarks.filter((item) => item.targetType === 'reading-excerpt').map((item) => item.targetId)))
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

  async function saveAnnotation(): Promise<void> {
    if (current === null || sourceBook === null || annotationDraft.trim() === '') return
    setBusy(true); setError(null)
    try {
      const next = await addReadingAnnotation(current.sourceBookId, current.paragraphIndex, current.text, annotationDraft)
      setBooks((previous) => previous.map((item) => item.id === next.id ? next : item))
      setAnnotationDraft(''); setAnnotationOpen(false)
      void appendReadingLifeEvent({ eventType: 'reading.daily.annotation', bookId: current.sourceBookId, bookTitle: current.bookTitle, paragraphIndex: current.paragraphIndex, mode: 'daily' }).catch(() => undefined)
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
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>片段来自你的共读书架；私密聊天、日记和外部网页不会被自动带进来。</p>
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
              <button type="button" onClick={() => void favorite()} disabled={busy || favoriteIds.has(current.id)} style={{ color: favoriteIds.has(current.id) ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{favoriteIds.has(current.id) ? '已收藏' : '收藏片段'}</button>
              <button type="button" onClick={() => setAnnotationOpen((value) => !value)} style={{ color: 'var(--text-secondary)' }}>{annotationOpen ? '收起批注' : '写下批注'}</button>
            </div>
            {annotationOpen && <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }}><label htmlFor="daily-reading-annotation" className="sr-only">品读批注</label><textarea id="daily-reading-annotation" data-testid="daily-reading-annotation" value={annotationDraft} onChange={(event) => setAnnotationDraft(event.target.value)} maxLength={2000} rows={3} placeholder="写下你想和小栖分享的想法……" className="w-full resize-y rounded-lg border bg-transparent p-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} /><div className="mt-2 flex justify-end"><button type="button" onClick={() => void saveAnnotation()} disabled={busy || annotationDraft.trim() === ''} className="rounded-full px-3 py-1.5 text-xs" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>保存批注</button></div></div>}
            {sourceAnnotations.length > 0 && <div className="mt-4 space-y-2" data-testid="daily-reading-annotations"><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>你在原书留下的批注</p>{sourceAnnotations.map((item) => <div key={item.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }}>{item.note || '（只标记了这段文字）'}</div>)}</div>}
          </article>
        )}
        {error !== null && <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      </section>
      <section className="rounded-lg border p-5" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }} data-testid="daily-reading-history">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">品读历史</h3><span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{history.length} 段</span></div>
        {history.length === 0 ? <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>换一段之后，读过的文字会留在这里。</p> : <ul className="mt-3 space-y-2">{history.slice(0, 12).map((item) => <li key={item.id}><button type="button" onClick={() => { setCurrentId(item.id); setAnnotationOpen(false) }} className="w-full rounded-lg border p-3 text-left" style={{ borderColor: item.id === current?.id ? 'var(--accent-strong)' : 'var(--border-soft)' }}><span className="block truncate text-sm">{item.text}</span><span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>《{item.bookTitle}》 · {dateLabel(item.createdAt)}</span></button></li>)}</ul>}
      </section>
    </div>
  )
}
