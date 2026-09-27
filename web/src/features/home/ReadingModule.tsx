import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import type { ReadingNote, ReadingStatus } from '@shared/types'
import {
  addReadingAnnotation,
  createReadingBook,
  createReadingNote,
  deleteReadingAnnotation,
  deleteReadingNote,
  getReadingBook,
  listReadingNotes,
  MAX_READING_TEXT_CHARS,
  updateReadingBookState,
  updateReadingNote,
} from '../../db/home'

const STATUS_LABELS: Record<ReadingStatus, string> = { want: '想读', reading: '在读', finished: '读完' }

function splitParagraphs(content: string): string[] { return content.split('\n') }

function progressLabel(paragraph: number, total: number): string {
  if (total <= 1) return '刚翻开'
  return `${Math.min(paragraph + 1, total)} / ${total} 段`
}

function formatReadingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return minutes === 0 ? '不到 1 分钟' : `${minutes} 分钟`
}

export function ReadingModule() {
  const [items, setItems] = useState<ReadingNote[]>([])
  const [view, setView] = useState<'shelf' | 'reader'>('shelf')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [annotationTarget, setAnnotationTarget] = useState<number | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [status, setStatus] = useState<ReadingStatus>('reading')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> { setItems(await listReadingNotes()) }
  useEffect(() => { refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false)) }, [])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const selectedBook = selected === null ? null : getReadingBook(selected)
  const paragraphs = selectedBook === null ? [] : splitParagraphs(selectedBook.content)
  const matchingParagraphs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (query === '') return []
    return paragraphs.flatMap((paragraph, index) => paragraph.toLocaleLowerCase().includes(query) ? [index] : [])
  }, [paragraphs, search])

  /* 阅读器可见时每分钟落一次真实阅读时长，沿用既有 readingNotes 的 metadata，不造第二张书库表。 */
  useEffect(() => {
    if (view !== 'reader' || selectedId === null || selectedBook === null) return
    const timer = window.setInterval(() => {
      const current = items.find((item) => item.id === selectedId)
      const reader = current === undefined ? null : getReadingBook(current)
      if (reader === null) return
      void updateReadingBookState(selectedId, { readingSeconds: reader.readingSeconds + 60 }).then((next) => {
        setItems((previous) => previous.map((item) => item.id === next.id ? next : item))
      }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [items, selectedBook, selectedId, view])

  function replaceItem(next: ReadingNote): void {
    setItems((previous) => previous.map((item) => item.id === next.id ? next : item))
  }

  function reset(): void { setBookTitle(''); setAuthor(''); setStatus('reading'); setNote(''); setEditingId(null) }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      if (editingId === null) await createReadingNote(bookTitle, author, status, note)
      else await updateReadingNote(editingId, bookTitle, author, status, note)
      reset(); setError(null); await refresh()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  function edit(item: ReadingNote): void {
    setBookTitle(item.bookTitle); setAuthor(item.author ?? ''); setStatus(item.status); setNote(item.note); setEditingId(item.id); setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) { setDeletingId(id); return }
    try { await deleteReadingNote(id); if (editingId === id) reset(); if (selectedId === id) { setSelectedId(null); setView('shelf') }; setDeletingId(null); await refresh() }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function importText(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    try {
      if (!file.name.toLocaleLowerCase().endsWith('.txt') && file.type !== 'text/plain') throw new Error('第一批只支持 TXT 文本文件')
      const content = await file.text()
      if (content.length > MAX_READING_TEXT_CHARS) throw new Error('TXT 文件过大，请先拆分到 2,000,000 字以内')
      const item = await createReadingBook(file.name.replace(/\.txt$/i, '') || '未命名的书', '', content)
      setItems((previous) => [item, ...previous]); setSelectedId(item.id); setView('reader'); setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function setParagraph(index: number): Promise<void> {
    if (selectedId === null || selectedBook === null) return
    try { replaceItem(await updateReadingBookState(selectedId, { currentParagraph: index })); setError(null) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function toggleBookmark(): Promise<void> {
    if (selectedId === null || selectedBook === null) return
    const next = selectedBook.bookmarkParagraph === selectedBook.currentParagraph ? null : selectedBook.currentParagraph
    try { replaceItem(await updateReadingBookState(selectedId, { bookmarkParagraph: next })); setError(null) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function saveAnnotation(): Promise<void> {
    if (selectedId === null || selectedBook === null || annotationTarget === null) return
    try {
      const next = await addReadingAnnotation(selectedId, annotationTarget, paragraphs[annotationTarget] ?? '', annotationDraft)
      replaceItem(next); setAnnotationTarget(null); setAnnotationDraft(''); setError(null)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function removeAnnotation(annotationId: string): Promise<void> {
    if (selectedId === null) return
    try { replaceItem(await deleteReadingAnnotation(selectedId, annotationId)); setError(null) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)) }
  }

  if (view === 'reader' && selected !== null && selectedBook !== null) {
    const currentParagraph = Math.min(selectedBook.currentParagraph, Math.max(0, paragraphs.length - 1))
    const annotations = selectedBook.annotations
    return <div data-testid="reading-reader" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => { setView('shelf'); setSearch(''); setAnnotationTarget(null) }} className="rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: 'var(--border-soft)' }}>← 回到书架</button>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>TXT 阅读器 · 内容只保存在本机</span>
      </div>
      <section className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{selected.bookTitle}</h2>{selected.author !== null && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{selected.author}</p>}</div><div className="text-right text-xs" style={{ color: 'var(--text-secondary)' }}><div>{progressLabel(currentParagraph, paragraphs.length)}</div><div>已读 {formatReadingTime(selectedBook.readingSeconds)}</div></div></div>
        <div className="mt-4 flex items-center gap-3"><label htmlFor="reading-progress" className="sr-only">阅读进度</label><input id="reading-progress" data-testid="reading-progress" type="range" min={0} max={Math.max(0, paragraphs.length - 1)} value={currentParagraph} onChange={(event) => void setParagraph(Number(event.target.value))} className="min-w-0 flex-1" /><button type="button" onClick={() => void toggleBookmark()} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)', color: selectedBook.bookmarkParagraph === currentParagraph ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{selectedBook.bookmarkParagraph === currentParagraph ? '已书签' : '夹书签'}</button></div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><label htmlFor="reading-search" className="sr-only">搜索正文</label><input id="reading-search" data-testid="reading-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索这本书……" className="min-w-[12rem] flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />{search.trim() !== '' && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>命中 {matchingParagraphs.length} 段</span>}</div>
      </section>
      <section className="space-y-2" aria-label="正文">
        {paragraphs.map((paragraph, index) => {
          const paragraphAnnotations = annotations.filter((annotation) => annotation.paragraphIndex === index)
          const isCurrent = index === currentParagraph
          const isMatch = matchingParagraphs.includes(index)
          return <article key={`${selected.id}-${index}`} data-testid={`reading-paragraph-${index}`} className="rounded-lg border p-4 transition" style={{ borderColor: isCurrent ? 'var(--accent-strong)' : 'var(--border-soft)', backgroundColor: isMatch ? 'color-mix(in srgb, var(--accent-soft) 45%, transparent)' : 'var(--bg-surface-solid)', opacity: paragraph === '' ? 0.55 : 1 }} onClick={() => void setParagraph(index)}><p className="whitespace-pre-wrap break-words text-sm leading-7">{paragraph === '' ? ' ' : paragraph}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><button type="button" onClick={(event) => { event.stopPropagation(); setAnnotationTarget(index); setAnnotationDraft('') }} style={{ color: 'var(--accent-strong)' }}>划线 / 批注</button>{isCurrent && <span style={{ color: 'var(--text-secondary)' }}>正在这里</span>}</div>{annotationTarget === index && <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }} onClick={(event) => event.stopPropagation()}><label htmlFor={`reading-annotation-${index}`} className="sr-only">批注内容</label><textarea id={`reading-annotation-${index}`} data-testid="reading-annotation" value={annotationDraft} onChange={(event) => setAnnotationDraft(event.target.value)} maxLength={2000} rows={3} placeholder="写下你想和小栖分享的想法……" className="w-full resize-y rounded-lg border bg-transparent p-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setAnnotationTarget(null)} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>取消</button><button type="button" onClick={() => void saveAnnotation()} className="rounded-full px-3 py-1.5 text-xs" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>保存批注</button></div></div>}{paragraphAnnotations.map((annotation) => <div key={annotation.id} className="mt-3 rounded-lg border-l-2 pl-3 text-xs" style={{ borderColor: 'var(--accent-strong)', color: 'var(--text-secondary)' }}><div>你的划线 · {annotation.note || '暂未写批注'}</div><button type="button" onClick={(event) => { event.stopPropagation(); void removeAnnotation(annotation.id) }} className="mt-1" style={{ color: 'var(--danger)' }}>删除这条批注</button></div>)}</article>
        })}
      </section>
      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  }

  const books = items.filter((item) => getReadingBook(item) !== null)
  const notes = items.filter((item) => getReadingBook(item) === null)
  return <div data-testid="reading-shelf" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">共读书架</h2><p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>先从一本 TXT 开始，把阅读进度和批注留在同一页。</p></div><div className="flex gap-2"><label className="cursor-pointer rounded-full px-3 py-1.5 text-sm" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}><input data-testid="reading-import" type="file" accept=".txt,text/plain" onChange={(event) => void importText(event)} className="sr-only" />导入 TXT</label><button type="button" onClick={() => setView('shelf')} className="rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: 'var(--border-soft)' }}>书架</button></div></div>
    {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在翻书……</p> : books.length === 0 ? <p className="rounded-lg border p-5 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>书架还是空的。导入一本 TXT，开始真正阅读吧。</p> : <ul className="space-y-3">{books.map((item) => { const reader = getReadingBook(item); if (reader === null) return null; const total = splitParagraphs(reader.content).length; const current = Math.min(reader.currentParagraph, Math.max(0, total - 1)); return <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{item.bookTitle}</h3>{item.author !== null && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.author}</p>}<p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>TXT · {progressLabel(current, total)} · 已读 {formatReadingTime(reader.readingSeconds)}</p></div><span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>在读</span></div><div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => { setSelectedId(item.id); setView('reader'); setError(null) }} style={{ color: 'var(--accent-strong)' }}>继续阅读</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '移出书架'}</button></div></li> })}</ul>}

    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{editingId === null ? '记一页阅读' : '编辑读书笔记'}</h2>{editingId !== null && <button type="button" onClick={reset} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}</div>
      <label htmlFor="reading-title" className="sr-only">书名</label><input id="reading-title" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} maxLength={120} placeholder="书名" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="reading-author" className="sr-only">作者</label><input id="reading-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} placeholder="作者（可选）" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
      <label htmlFor="reading-status" className="text-xs" style={{ color: 'var(--text-secondary)' }}>阅读状态</label><select id="reading-status" value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor="reading-note" className="sr-only">读书笔记</label><textarea id="reading-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={5} placeholder="摘录、感受或想法……" className="resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--border-soft)' }} />
      <button type="submit" disabled={bookTitle.trim() === '' || note.trim() === ''} className="justify-self-end rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '保存笔记' : '保存修改'}</button>
    </form>
    {notes.length > 0 && <section><h2 className="mb-3 text-sm font-semibold">我的阅读笔记</h2><ul className="space-y-3">{notes.map((item) => <li key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{item.bookTitle}</h3>{item.author !== null && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{item.author}</p>}</div><span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>{STATUS_LABELS[item.status]}</span></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.note}</p><div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" onClick={() => edit(item)} style={{ color: 'var(--accent-strong)' }}>编辑</button><button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button></div></li>)}</ul></section>}
  </div>
}
