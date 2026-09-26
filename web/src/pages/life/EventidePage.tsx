/**
 * Eventide 状态页（Phase 7A · `/life/eventide`，从「生活 → 运行」进）。
 *
 * 四块：当前摘要 / 数值维度趋势 / 最近变化 / raw 高级视图。
 * 数据源：/api/life/eventide/current + /history。Eventide 未配置或还没有快照时诚实空态 ——
 * 假数据一律不搬（铁律），payload 键由上游自定，界面按真实键渲染，不预设「心情/睡眠」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronLeft } from '../../components/qixi/Icons'
import { useSlideIn } from '../../components/qixi/useSlideIn'
import type { EventideHistoryPoint } from '@shared/types'
import { ApiRequestError, fetchJson } from '../../lib/api'
import { stateValue } from '../../lib/format'
import { log } from '../../lib/log'

interface CurrentSnapshot {
  state: Record<string, unknown>
  stateCard: string | null
  payload: Record<string, unknown>
  settledAt: number
}

interface HistoryResponse {
  points: EventideHistoryPoint[]
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 简易趋势线：不引图表库，一条 polyline + 首末值标注足够看趋势。 */
function Sparkline({ values }: { values: number[] }) {
  const width = 280
  const height = 72
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * (height - 8) - 4
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-2 w-full"
      style={{ maxHeight: height }}
      data-testid="eventide-trend-line"
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

export function EventidePage() {
  const slide = useSlideIn()
  const [current, setCurrent] = useState<CurrentSnapshot | null>(null)
  const [points, setPoints] = useState<EventideHistoryPoint[]>([])
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendKey, setTrendKey] = useState<string | null>(null)

  const load = useCallback((): void => {
    setLoading(true)
    Promise.all([
      fetchJson<CurrentSnapshot>('/api/life/eventide/current'),
      fetchJson<HistoryResponse>('/api/life/eventide/history?limit=200'),
    ])
      .then(([snapshot, history]) => {
        setCurrent(snapshot)
        setPoints(history.points)
        setEmpty(false)
        setError(null)
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
          setEmpty(true)
          setError(null)
        } else {
          log.error('读取 Eventide 状态失败', err)
          setError(err instanceof ApiRequestError ? err.message : String(err))
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  /** 数值维度：各键在历史里至少出现过一次有限数值，才有画趋势的资格 */
  const numericKeys = useMemo(() => {
    const keys: string[] = []
    for (const point of points) {
      for (const [key, value] of Object.entries(point.payload)) {
        if (isNumber(value) && !keys.includes(key)) keys.push(key)
      }
    }
    return keys
  }, [points])

  const trendValues = useMemo(() => {
    if (trendKey === null) return []
    return points
      .filter((point) => isNumber(point.payload[trendKey]))
      .map((point) => point.payload[trendKey] as number)
  }, [points, trendKey])

  /** 最近变化：最后两个快照逐键对比，值不同才算变 */
  const changes = useMemo(() => {
    if (points.length < 2) return []
    const prev = points[points.length - 2].payload
    const last = points[points.length - 1].payload
    const keys = [...new Set([...Object.keys(prev), ...Object.keys(last)])]
    return keys
      .filter((key) => JSON.stringify(prev[key]) !== JSON.stringify(last[key]))
      .map((key) => ({ key, from: prev[key], to: last[key] }))
  }, [points])

  const activeTrend = trendKey ?? numericKeys[0] ?? null

  /** 趋势视图模式：快照 = 逐点连线（原样）；按天 = 跨天聚合（T-055），每天首→末值与波动幅度 */
  const [mode, setMode] = useState<'snapshot' | 'daily'>('snapshot')

  const dailyStats = useMemo(() => {
    if (activeTrend === null) return []
    const byDay = new Map<string, { first: number; last: number; min: number; max: number }>()
    for (const point of points) {
      const value = point.payload[activeTrend]
      if (!isNumber(value)) continue
      const at = new Date(point.settledAt)
      const dayKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
      const day = byDay.get(dayKey)
      if (day === undefined) {
        byDay.set(dayKey, { first: value, last: value, min: value, max: value })
      } else {
        day.last = value
        day.min = Math.min(day.min, value)
        day.max = Math.max(day.max, value)
      }
    }
    return [...byDay.entries()].map(([dayKey, stat]) => ({ dayKey, ...stat }))
  }, [points, activeTrend])

  return (
    <div className={slide}>
      <div className="topbar">
        <Link to="/life" aria-label="返回生活" data-testid="eventide-back" className="icon-btn" style={{ flex: 'none' }}>
          <IconChevronLeft size={20} />
        </Link>
        <h1 className="topbar-title">Eventide 状态</h1>
      </div>

      <div className="px-5 pb-6 pt-2">
        {loading && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取…</p>}
        {error !== null && (
          <p className="text-sm" style={{ color: 'var(--danger)' }} data-testid="eventide-error">
            {error}
            <button type="button" className="ml-2 underline" onClick={load}>重试</button>
          </p>
        )}
        {empty && !loading && (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }} data-testid="eventide-empty">
            还没有任何状态快照。Eventide 未配置，或者它还没被推进过。
          </p>
        )}

        {!loading && current !== null && (
          <>
            {/* 当前摘要 */}
            <section className="rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="eventide-summary">
              <h2 className="text-sm font-medium">当前状态</h2>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(current.payload).map(([key, value]) => (
                  <div key={key}>
                    <span style={{ color: 'var(--text-secondary)' }}>{key}</span>
                    <strong className="ml-2">{stateValue(value)}</strong>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                快照时间：{new Date(current.settledAt).toLocaleString()}
              </p>
            </section>

            {/* 数值趋势 */}
            <section className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="eventide-trend">
              <h2 className="text-sm font-medium">趋势</h2>
              {numericKeys.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  历史快照里还没有可画趋势的数值维度。
                </p>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {numericKeys.map((key) => (
                      <button
                        key={key}
                        type="button"
                        data-testid={`eventide-trend-key-${key}`}
                        className={`rounded-full border px-2.5 py-0.5 text-xs${activeTrend === key ? ' is-on' : ''}`}
                        style={{
                          borderColor: activeTrend === key ? 'var(--accent-strong)' : 'var(--border-soft)',
                          color: activeTrend === key ? 'var(--accent-strong)' : 'var(--text-secondary)',
                        }}
                        onClick={() => setTrendKey(key)}
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                  {/* 视图模式：快照逐点 / 按天聚合（跨天后逐点连线会被同一天的密集采样拉成锯齿） */}
                  <div className="mt-2 flex gap-1.5" data-testid="eventide-mode-switch">
                    <button
                      type="button"
                      data-testid="eventide-mode-snapshot"
                      className={`rounded-full border px-2.5 py-0.5 text-xs${mode === 'snapshot' ? ' is-on' : ''}`}
                      style={{
                        borderColor: mode === 'snapshot' ? 'var(--accent-strong)' : 'var(--border-soft)',
                        color: mode === 'snapshot' ? 'var(--accent-strong)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setMode('snapshot')}
                    >
                      逐快照
                    </button>
                    <button
                      type="button"
                      data-testid="eventide-mode-daily"
                      className={`rounded-full border px-2.5 py-0.5 text-xs${mode === 'daily' ? ' is-on' : ''}`}
                      style={{
                        borderColor: mode === 'daily' ? 'var(--accent-strong)' : 'var(--border-soft)',
                        color: mode === 'daily' ? 'var(--accent-strong)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setMode('daily')}
                    >
                      按天
                    </button>
                  </div>
                  {mode === 'snapshot' && (trendValues.length > 0 ? (
                    <>
                      <Sparkline values={trendValues} />
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        最近 {trendValues.length} 个快照 · {trendValues[0]} → {trendValues[trendValues.length - 1]}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>该维度暂无数值点。</p>
                  ))}
                  {mode === 'daily' && (dailyStats.length > 0 ? (
                    <div className="mt-2" data-testid="eventide-daily-list">
                      <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span>日期</span><span>首 → 末</span><span>波动</span>
                        {dailyStats.map((day) => (
                          <div key={day.dayKey} data-testid="eventide-daily-row" className="contents">
                            <span style={{ color: 'var(--text-primary)' }}>{day.dayKey}</span>
                            <strong>{day.first} → {day.last}</strong>
                            <span>{day.min === day.max ? `稳定 ${day.min}` : `${day.min} ~ ${day.max}`}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        共聚合 {dailyStats.length} 天（每天取当日快照的首值、末值与波动范围）
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>该维度暂无数值点。</p>
                  ))}
                </>
              )}
            </section>

            {/* 最近变化 */}
            <section className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="eventide-diff">
              <h2 className="text-sm font-medium">最近变化</h2>
              {changes.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {points.length < 2 ? '至少要有两个快照才能对比。' : '最近两次快照之间没有变化。'}
                </p>
              ) : (
                <div className="mt-2 grid gap-1 text-sm">
                  {changes.map(({ key, from, to }) => (
                    <div key={key}>
                      <span style={{ color: 'var(--text-secondary)' }}>{key}</span>
                      <span className="ml-2">{stateValue(from)}</span>
                      <span className="mx-1">→</span>
                      <strong>{stateValue(to)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* raw 高级视图 */}
            <details className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="eventide-raw">
              <summary className="cursor-pointer text-sm font-medium">原始状态（raw）</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                {JSON.stringify(current, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
