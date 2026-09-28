import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  IconBook,
  IconCalendar,
  IconChevronRight,
  IconDrop,
  IconNote,
  IconQuote,
  IconStar,
  QixiIcon,
} from '../../components/qixi/Icons'
import { greetingByHour } from '../../features/home/welcome'
import { HOME_MODULES } from '../../features/home/modules'
import { HomeWidgets } from '../../features/home/HomeWidgets'
import { useOnlineStatus } from '../../features/offline/useOnlineStatus'
import { formatDayLabel } from '../../lib/format'
import {
  listBookmarks,
  listCountdowns,
  listDiaries,
  listMoments,
  listMusicTracks,
} from '../../db/home'
import { dayDistance, nextOccurrenceDate } from '../../features/home/countdownDays'
import { checkCountdownReminders } from '../../features/home/countdownReminders'

/**
 * 家 = 6 格 Bento + 一行全入口（UI_DESIGN.md §5 已拍板）。
 *
 * 数据口径（铁律：假数据一律不搬）：Bento 里每一格都是**真库里的数据**，没数据就空态 ——
 *  ① 小栖 · 现在：真实联网状态（`useOnlineStatus`），不装「在窗边听雨」这种占位心情；
 *  ② 留言板 / 倒数日 / 最近收藏：各取最新一条（没有就明说还空着）；
 *  ③ 一起听：只放最近一首歌的入口 —— **真播放是第 6 批的事**，在这之前不放会响的假按钮；
 *  ④ 小栖的日记：只数**本周篇数**，「请求查看」在日记模块里是**按篇**发起的（那是真机制），
 *     Bento 上不放全局请求按钮 —— 那等于做一个点不进真流程的假入口。
 */

/** 本周（含今天共 7 天）的小栖日记篇数；entryDate 是 YYYY-MM-DD，字符串比较即可 */
function companionDiariesThisWeek(entryDates: string[]): number {
  const from = new Date()
  from.setDate(from.getDate() - 6)
  const floor = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
  return entryDates.filter((d) => d >= floor).length
}

export function HomePage() {
  const online = useOnlineStatus()
  const now = new Date()
  const greeting = greetingByHour(now.getHours())
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日 · 周${'日一二三四五六'[now.getDay()]}`

  const [latestNote, setLatestNote] = useState<{ content: string; author: string; createdAt: number } | null>(null)
  const [nearestDay, setNearestDay] = useState<{ title: string; days: number } | null>(null)
  const [diaryWeekCount, setDiaryWeekCount] = useState<number | null>(null)
  const [latestBookmarks, setLatestBookmarks] = useState<{ id: string; title: string; createdAt: number }[]>([])
  const [latestTrack, setLatestTrack] = useState<{ title: string; artist: string | null } | null>(null)

  useEffect(() => {
    // 六格的数据源互相独立，一起拉；谁失败谁空态，不连坐
    listMoments()
      .then((items) => {
        const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt)
        setLatestNote(sorted[0] ?? null)
      })
      .catch(() => setLatestNote(null))
    listCountdowns()
      .then((days) => {
        void checkCountdownReminders(days)
        const upcoming = days
          .map((d) => ({ title: d.title, days: dayDistance(nextOccurrenceDate(d)) }))
          .sort((a, b) => a.days - b.days)
        setNearestDay(upcoming[0] ?? null)
      })
      .catch(() => setNearestDay(null))
    listDiaries()
      .then((items) =>
        setDiaryWeekCount(
          companionDiariesThisWeek(
            items.filter((d) => d.author === 'companion').map((d) => d.entryDate),
          ),
        ),
      )
      .catch(() => setDiaryWeekCount(null))
    listBookmarks()
      .then((items) =>
        setLatestBookmarks(
          [...items]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 2)
            .map((b) => ({ id: b.id, title: b.title, createdAt: b.createdAt })),
        ),
      )
      .catch(() => setLatestBookmarks([]))
    listMusicTracks()
      .then((tracks) => {
        const sorted = [...tracks].sort((a, b) => b.updatedAt - a.updatedAt)
        setLatestTrack(sorted[0] ?? null)
      })
      .catch(() => setLatestTrack(null))
  }, [])

  return (
    <div data-page="home">
      {/* 页头：低存在感。⚠️ `<header>` 与顺序（header → widgets → entries）被 verify-home 的布局断言依赖 */}
      <header style={{ padding: '18px 20px 4px' }}>
        <div className="t-caption" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.1em', marginBottom: 4 }}>
          {dateLine}
        </div>
        <h1 className="t-h1">{greeting}，欢迎回来</h1>
      </header>

      <div className="bento" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {/* ① 小栖 · 现在（2×2） */}
        <div className="bento-cell ai-presence cell-2x2" style={{ gridRow: 'span 2', minHeight: 196, justifyContent: 'space-between' }}>
          <div className="flex items-center gap-2">
            <span className={`dot${online ? ' pulse' : ''}`} />
            <span className="cell-label" style={{ color: 'var(--text-secondary)' }}>小栖 · 现在</span>
            <span className="flex-1" />
            <IconDrop size={15} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div>
            <div className="t-h1" style={{ fontSize: 24, marginBottom: 8 }}>{online ? '在，随时都在' : '暂时不在'}</div>
            <div className="t-body" style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>
              {online ? '今天也保持在线，' : '现在离线，'}
              <br />
              {online ? '随时回来，它都在。' : '联网后它就能回话。'}
            </div>
          </div>
          <Link to="/chat" className="btn-pill btn-ghost" style={{ alignSelf: 'flex-start', minHeight: 40, padding: '0 20px', fontSize: 13 }}>
            去说句话
            <IconChevronRight size={14} />
          </Link>
        </div>

        {/* ② 留言板（2×1） */}
        <Link to="/home/board" className="bento-cell cell-2x1 pressable" data-testid="home-bento-board">
          <div className="cell-label"><IconQuote size={13} /> 留言板</div>
          {latestNote === null ? (
            <div className="t-body" style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>
              还没有留言。去写下第一句，这里就会出现。
            </div>
          ) : (
            <>
              <div className="t-body" style={{ fontSize: 14 }}>
                {latestNote.author === 'companion' && <span style={{ color: 'var(--text-tertiary)' }}>小栖：</span>}
                {latestNote.content}
              </div>
              <div className="t-micro" style={{ color: 'var(--text-tertiary)' }}>{formatDayLabel(latestNote.createdAt)}</div>
            </>
          )}
        </Link>

        {/* ③ 一起听（2×1）：真播放第 6 批接，这里只做入口 */}
        <Link to="/home/music" className="bento-cell cell-2x1 pressable">
          <div className="flex items-center" style={{ gap: 13 }}>
            <div
              className="flex items-center justify-center"
              style={{
                width: 52, height: 52, borderRadius: 16, flex: 'none',
                background: 'linear-gradient(145deg, #566274, #2b323d 70%)',
                color: 'rgba(255,255,255,0.85)',
                boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.18), 0 6px 14px rgba(0,0,0,0.18)',
              }}
            >
              <IconNote size={22} />
            </div>
            <div className="min-w-0 flex-1">
              {latestTrack === null ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>歌单还空着</div>
                  <div className="t-micro" style={{ color: 'var(--text-tertiary)', marginTop: 3 }}>放一首想一起听的歌</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{latestTrack.title}</div>
                  <div className="t-micro" style={{ color: 'var(--text-tertiary)', marginTop: 3 }}>{latestTrack.artist || ' '}</div>
                </>
              )}
            </div>
          </div>
        </Link>

        {/* ④ 倒数日 */}
        <Link to="/home/countdown" className="bento-cell pressable">
          <div className="cell-label"><IconCalendar size={13} /> 倒数日</div>
          {nearestDay === null ? (
            <div className="t-caption" style={{ color: 'var(--text-tertiary)' }}>还没定日子</div>
          ) : (
            <>
              <div>
                <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: '0.01em' }}>{Math.abs(nearestDay.days)}</span>
                <span className="t-caption" style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>天</span>
              </div>
              <div className="t-caption" style={{ color: 'var(--text-secondary)' }}>
                {nearestDay.days < 0 ? '已过' : '距'}「{nearestDay.title}」
              </div>
            </>
          )}
        </Link>

        {/* ⑤ 小栖的日记（情绪入口，轻 T&G） */}
        <Link to="/home/diary" className="bento-cell pressable" style={{ background: 'linear-gradient(160deg, #3a424e, #20252d 68%)', borderColor: 'transparent' }}>
          <div className="cell-label" style={{ color: 'rgba(255,255,255,0.55)' }}><IconBook size={13} /> 小栖的日记</div>
          <div className="flex items-baseline" style={{ gap: 5, color: 'rgba(255,255,255,0.94)' }}>
            <span style={{ fontSize: 24, fontWeight: 700 }}>{diaryWeekCount ?? 0}</span>
            <span className="t-caption" style={{ color: 'rgba(255,255,255,0.55)' }}>篇 · 本周</span>
          </div>
          <span
            className="btn-pill"
            style={{ minHeight: 36, padding: '0 16px', fontSize: 12, alignSelf: 'flex-start', background: 'rgba(255,255,255,0.94)', color: '#171b21' }}
          >
            去翻翻
          </span>
        </Link>

        {/* ⑥ 最近收藏（2×1，标题与日期上下排避免挤压） */}
        <Link to="/home/bookmarks" className="bento-cell cell-2x1 pressable">
          <div className="cell-label"><IconStar size={13} /> 最近收藏</div>
          {latestBookmarks.length === 0 ? (
            <div className="t-caption" style={{ color: 'var(--text-tertiary)' }}>收藏夹还空着</div>
          ) : (
            latestBookmarks.map((b) => (
              <div key={b.id} className="flex min-w-0 items-center" style={{ gap: 9 }}>
                <IconStar size={12} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13 }}>{b.title}</span>
                <span className="t-micro flex-none" style={{ color: 'var(--text-tertiary)' }}>{formatDayLabel(b.createdAt)}</span>
              </div>
            ))
          )}
        </Link>
      </div>

      {/* 主屏 Widget 区：问候语之下、功能入口之上（SPEC §1.4）；一张都没有时它自己什么都不渲染 */}
      <div style={{ padding: '0 20px' }}>
        <HomeWidgets />

        {/* 一行全入口：12 个模块一个不漏（朋友圈、每日品读、愿望清单、读书不放走） */}
        <ul className="flex flex-wrap gap-2 pt-2" data-testid="home-entries">
          {HOME_MODULES.map((mod) => (
            <li key={mod.key}>
              <Link
                to={`/home/${mod.key}`}
                className="btn-pill"
                style={{ minHeight: 38, padding: '0 14px', fontSize: 12.5, gap: 6 }}
              >
                <QixiIcon name={mod.icon} size={15} />
                {mod.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
