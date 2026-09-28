import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronRight, IconMail, IconTimer } from '../../components/qixi/Icons'
import { listHomeWidgetViews, moveHomeWidget, type HomeWidgetView } from '../../db/home'
import { dayDistance, distanceLabel, nextOccurrenceDate } from './countdownDays'

type BoardView = Extract<HomeWidgetView, { kind: 'board' }>
type CountdownView = Extract<HomeWidgetView, { kind: 'countdown' }>
type DailyReadingView = Extract<HomeWidgetView, { kind: 'daily-reading' }>

function cardStyle() {
  return { borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }
}

function ArrangeControls({ view, index, total, onMove }: { view: HomeWidgetView; index: number; total: number; onMove: (id: string, direction: -1 | 1) => void }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-1 border-t pt-2" style={{ borderColor: 'var(--border-soft)' }}>
      <span className="mr-auto text-xs" style={{ color: 'var(--text-tertiary)' }}>主屏位置 {index + 1}/{total}</span>
      <button type="button" data-testid={`home-widget-move-up-${view.id}`} aria-label="主屏 Widget 上移" className="icon-btn" style={{ width: 32, height: 32, color: 'var(--text-secondary)' }} disabled={index === 0} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMove(view.id, -1) }}>↑</button>
      <button type="button" data-testid={`home-widget-move-down-${view.id}`} aria-label="主屏 Widget 下移" className="icon-btn" style={{ width: 32, height: 32, color: 'var(--text-secondary)' }} disabled={index === total - 1} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMove(view.id, 1) }}>↓</button>
    </div>
  )
}

function BoardWidget({ view, arranging, index, total, onMove }: { view: BoardView; arranging: boolean; index: number; total: number; onMove: (id: string, direction: -1 | 1) => void }) {
  const scopeLabel = view.scope.kind === 'recent' ? '最近留言' : view.scope.kind === 'group' ? '指定分组' : '指定留言'
  const target = view.scope.kind === 'moment' ? `/home/board#${encodeURIComponent(view.scope.momentId)}` : '/home/board'
  return (
    <section data-testid="home-widget-board" className="rounded-xl border p-4" style={cardStyle()}>
      <div className="mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-sm font-medium"><IconMail size={15} style={{ color: 'var(--accent-strong)' }} />留言板 · {scopeLabel}</span><Link to={target} className="flex shrink-0 items-center gap-0.5 text-xs" style={{ color: 'var(--accent-strong)' }}>{view.scope.kind === 'moment' ? '查看留言' : '打开留言板'}<IconChevronRight size={13} /></Link></div>
      {view.notes.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>还没有留言。写下第一句，这里就会出现。</p> : <ul className="space-y-1">{view.notes.map((note) => <li key={note.id} className="flex gap-1 text-sm">{note.author === 'companion' && <span className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>小栖</span>}<span className="min-w-0 flex-1 truncate">{note.content}</span></li>)}</ul>}
      {arranging && <ArrangeControls view={view} index={index} total={total} onMove={onMove} />}
    </section>
  )
}

function CountdownWidget({ view, arranging, index, total, onMove }: { view: CountdownView; arranging: boolean; index: number; total: number; onMove: (id: string, direction: -1 | 1) => void }) {
  const occurrenceDate = nextOccurrenceDate(view.day)
  const days = dayDistance(occurrenceDate)
  return (
    <Link to="/home/countdown" data-testid="home-widget-countdown" className="rounded-xl border p-4" style={cardStyle()}>
      <span className="flex items-center gap-3"><IconTimer size={20} style={{ color: 'var(--accent-strong)' }} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{view.day.title}</span><span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>{occurrenceDate}</span></span><strong className="shrink-0 text-sm" style={{ color: days < 0 ? 'var(--text-secondary)' : 'var(--accent-strong)' }}>{distanceLabel(days)}</strong></span>
      {arranging && <ArrangeControls view={view} index={index} total={total} onMove={onMove} />}
    </Link>
  )
}

function DailyReadingWidget({ view, arranging, index, total, onMove }: { view: DailyReadingView; arranging: boolean; index: number; total: number; onMove: (id: string, direction: -1 | 1) => void }) {
  return (
    <Link to={`/home/daily-reading#${encodeURIComponent(view.entry.id)}`} data-testid="home-widget-daily-reading" className="block rounded-xl border p-4" style={cardStyle()}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium" style={{ color: 'var(--accent-strong)' }}>每日品读</span><IconChevronRight size={13} style={{ color: 'var(--text-secondary)' }} /></div><p className="mt-2 line-clamp-2 text-sm leading-6">“{view.entry.text}”</p><p className="mt-2 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>《{view.entry.bookTitle}》 · {view.entry.author ?? '作者未标注'}</p>{arranging && <ArrangeControls view={view} index={index} total={total} onMove={onMove} />}</Link>
  )
}

/** 主屏 Widget 承载区（SPEC §1.4 / §5.2）。Dexie liveQuery 让多标签页保持同步。 */
export function HomeWidgets() {
  const [views, setViews] = useState<HomeWidgetView[] | null>(null)
  const [arranging, setArranging] = useState(false)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    const subscription = liveQuery(() => listHomeWidgetViews()).subscribe({ next: setViews, error: () => setViews([]) })
    return () => subscription.unsubscribe()
  }, [])

  if (views === null || views.length === 0) return null

  async function move(id: string, direction: -1 | 1): Promise<void> {
    if (moving) return
    setMoving(true)
    try { await moveHomeWidget(id, direction) } finally { setMoving(false) }
  }

  return (
    <>
      {views.length > 1 && <div className="mb-2 flex justify-end" data-testid="home-widget-toolbar"><button type="button" className="btn-pill btn-ghost" data-testid="home-widget-arrange" onClick={() => setArranging((value) => !value)}>{arranging ? '完成编排' : '编排主屏'}</button></div>}
      <section data-testid="home-widgets" data-home-part="widget-grid" className="mb-5 grid gap-2">
        {views.map((view, index) => {
          const props = { arranging, index, total: views.length, onMove: (id: string, direction: -1 | 1) => void move(id, direction) }
          return view.kind === 'board' ? <BoardWidget key={view.id} view={view} {...props} /> : view.kind === 'countdown' ? <CountdownWidget key={view.id} view={view} {...props} /> : <DailyReadingWidget key={view.id} view={view} {...props} />
        })}
      </section>
    </>
  )
}
