import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronRight, IconMail, IconTimer } from '../../components/qixi/Icons'
import { listHomeWidgetViews, type HomeWidgetView } from '../../db/home'
import { dayDistance, distanceLabel, nextOccurrenceDate } from './countdownDays'

type BoardView = Extract<HomeWidgetView, { kind: 'board' }>
type CountdownView = Extract<HomeWidgetView, { kind: 'countdown' }>

function cardStyle() {
  return { borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }
}

/** 留言板 Widget：按范围读取留言 + 进模块页（SPEC §3.2.2） */
function BoardWidget({ view }: { view: BoardView }) {
  const scopeLabel = view.scope.kind === 'recent'
    ? '最近留言'
    : view.scope.kind === 'group'
      ? '指定分组'
      : '指定留言'
  const target = view.scope.kind === 'moment' ? `/home/board#${encodeURIComponent(view.scope.momentId)}` : '/home/board'
  return (
    <section data-testid="home-widget-board" className="rounded-xl border p-4" style={cardStyle()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <IconMail size={15} style={{ color: 'var(--accent-strong)' }} />
          留言板 · {scopeLabel}
        </span>
        <Link
          to={target}
          className="flex shrink-0 items-center gap-0.5 text-xs"
          style={{ color: 'var(--accent-strong)' }}
        >
          {view.scope.kind === 'moment' ? '查看留言' : '打开留言板'}
          <IconChevronRight size={13} />
        </Link>
      </div>
      {view.notes.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>还没有留言。写下第一句，这里就会出现。</p>
      ) : (
        <ul className="space-y-1">
          {view.notes.map((note) => (
            <li key={note.id} className="flex gap-1 text-sm">
              {/* 作者的区分要到 Phase 3 小栖能主动留言时才真正用得上，但位置现在留好：
                  等留言真的来自两边之后再补这一笔，等于要回头改所有展示点 */}
              {note.author === 'companion' && (
                <span className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>小栖</span>
              )}
              <span className="min-w-0 flex-1 truncate">{note.content}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 倒数日 Widget：整张卡片都是入口，点进模块页（SPEC §3.3.2「快捷进入详情」） */
function CountdownWidget({ view }: { view: CountdownView }) {
  const occurrenceDate = nextOccurrenceDate(view.day)
  const days = dayDistance(occurrenceDate)
  return (
    <Link to="/home/countdown" data-testid="home-widget-countdown" className="flex items-center gap-3 rounded-xl border p-4" style={cardStyle()}>
      <IconTimer size={20} style={{ color: 'var(--accent-strong)' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{view.day.title}</span>
        <span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>{occurrenceDate}</span>
      </span>
      <strong className="shrink-0 text-sm" style={{ color: days < 0 ? 'var(--text-secondary)' : 'var(--accent-strong)' }}>
        {distanceLabel(days)}
      </strong>
    </Link>
  )
}

/**
 * 主屏 Widget 承载区（SPEC §1.4 / §5.2）。
 *
 * 一张 Widget 都没有时**整个区域不渲染** —— 没放 Widget 的主屏要和「没有这项功能」时一模一样，
 * 不要出现一条空标题或占位框。
 */
export function HomeWidgets() {
  // null = 还没读回来。与空数组区分开：空数组是「确定没有 Widget」，不该再闪一下
  const [views, setViews] = useState<HomeWidgetView[] | null>(null)

  useEffect(() => {
    listHomeWidgetViews()
      .then(setViews)
      .catch(() => { setViews([]) })
  }, [])

  if (views === null || views.length === 0) return null

  return (
    <section data-testid="home-widgets" className="mb-5 grid gap-2">
      {views.map((view) =>
        view.kind === 'board' ? (
          <BoardWidget key={view.id} view={view} />
        ) : (
          <CountdownWidget key={view.id} view={view} />
        ),
      )}
    </section>
  )
}
