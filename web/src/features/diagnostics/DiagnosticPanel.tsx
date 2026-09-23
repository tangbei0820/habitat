/**
 * MCP 诊断日志时间线（§7.2②）—— 设置页的数据源是服务端 `mcp_diagnostic_log`。
 *
 * 它是「MCP 有问题时**不必猜**」的那块拼图：握手卡在哪一层、哪次工具调用失败、
 * 响应有多慢，都能在这里逐条看到原文。所以本组件**只做展示与筛选**，
 * 不加工错误文案 —— 屏幕上的字必须与库里存的一字不差。
 *
 * 筛选与翻页都交给服务端（日志只增不减，前端不能先全量拉回再过滤）。
 */
import { useEffect, useState } from 'react'
import type { McpDiagnosticEntry } from '@shared/types'
import { ApiRequestError } from '../../lib/api'
import { listMcpDiagnostics } from '../../lib/diagnostics'
import { log } from '../../lib/log'

/** 每页条数：够看清最近发生了什么，又不至于一次塞满整屏 */
const PAGE_SIZE = 30

/** 阶段筛选：三态，与接口的 `handshake` 一一对应 */
type PhaseFilter = 'all' | 'handshake' | 'tool'

const METHOD_LABELS: Record<string, string> = {
  initialize: '初始化握手',
  'tools/list': '列出工具',
  'tools/call': '调用工具',
}

const PHASE_OPTIONS: Array<{ value: PhaseFilter; label: string }> = [
  { value: 'all', label: '全部阶段' },
  { value: 'handshake', label: '仅握手' },
  { value: 'tool', label: '仅工具调用' },
]

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** `MM-DD HH:mm:ss.SSS` —— 毫秒是必要的：同一轮握手请求往往挨在一起 */
function formatAt(at: number): string {
  const d = new Date(at)
  return (
    `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

function describeDir(direction: McpDiagnosticEntry['direction']): string {
  // out = Gateway→Server 请求；in = Server→Gateway 响应
  return direction === 'out' ? '→ 请求' : '← 响应'
}

interface DiagnosticPanelProps {
  /** 供筛选下拉使用（来自 `/api/health/mcp`），不做去重以外的事情 */
  serverIds?: string[]
}

interface PanelState {
  entries: McpDiagnosticEntry[]
  total: number
  errorCount: number
  hasMore: boolean
}

const EMPTY: PanelState = { entries: [], total: 0, errorCount: 0, hasMore: false }

export function DiagnosticPanel({ serverIds = [] }: DiagnosticPanelProps) {
  const [serverId, setServerId] = useState('')
  const [phase, setPhase] = useState<PhaseFilter>('all')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [state, setState] = useState<PanelState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  /** 当前筛选条件（首屏与「加载更早」必须用同一份，否则翻页会串味） */
  const filters = {
    ...(serverId === '' ? {} : { serverId }),
    ...(phase === 'all' ? {} : { handshake: phase === 'handshake' }),
    ...(onlyErrors ? { errorsOnly: true } : {}),
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listMcpDiagnostics({ ...filters, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return
        setState({
          entries: page.entries,
          total: page.total,
          errorCount: page.errorCount,
          hasMore: page.hasMore,
        })
      })
      .catch((err: unknown) => {
        log.error('读取诊断日志失败', err)
        if (cancelled) return
        // 失败时清空列表：留着上一份数据配上新筛选条件会让人误读
        setState(EMPTY)
        setError(err instanceof ApiRequestError ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // filters 是每次渲染新建的对象，依赖项按它的原始来源列出（serverId / phase / onlyErrors）
  }, [serverId, phase, onlyErrors, reloadTick])

  async function loadMore(): Promise<void> {
    const last = state.entries[state.entries.length - 1]
    if (last === undefined || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listMcpDiagnostics({ ...filters, limit: PAGE_SIZE, before: last.id })
      setState((prev) => ({
        entries: [...prev.entries, ...page.entries],
        total: page.total,
        errorCount: page.errorCount,
        hasMore: page.hasMore,
      }))
    } catch (err: unknown) {
      log.error('加载更早的诊断日志失败', err)
      setError(err instanceof ApiRequestError ? err.message : String(err))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section
      className="mb-4 rounded-lg border p-4"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-dim)' }}>
          诊断日志
        </h2>
        <button
          type="button"
          onClick={() => setReloadTick((t) => t + 1)}
          className="rounded-full border px-3 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
        >
          刷新
        </button>
      </div>

      <p className="mb-3 text-xs" style={{ color: 'var(--color-text-dim)' }}>
        MCP 握手与每次工具调用全量留痕（服务端 SQLite，逐条可回放）
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          服务
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="rounded border px-2 py-1"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}
          >
            <option value="">全部</option>
            {serverIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          阶段
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as PhaseFilter)}
            className="rounded border px-2 py-1"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}
          >
            {PHASE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(e) => setOnlyErrors(e.target.checked)}
          />
          只看错误
        </label>
      </div>

      <p className="mb-2 text-xs" style={{ color: 'var(--color-text-dim)' }}>
        共 {state.total} 条
        {state.errorCount > 0 && (
          <span style={{ color: 'var(--color-danger)' }}>，其中 {state.errorCount} 条有错</span>
        )}
        {state.entries.length < state.total && `（已载入 ${state.entries.length} 条）`}
      </p>

      {loading && (
        <p className="text-xs" style={{ color: 'var(--color-text-dim)' }}>
          读取中…
        </p>
      )}

      {error !== null && (
        <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
          ⚠️ 读取失败：{error}
          <button type="button" className="ml-2 underline" onClick={() => setReloadTick((t) => t + 1)}>
            重试
          </button>
        </p>
      )}

      {!loading && error === null && state.entries.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--color-text-dim)' }}>
          没有符合条件的记录
        </p>
      )}

      {state.entries.length > 0 && (
        <ul className="text-xs">
          {state.entries.map((entry) => (
            <li
              key={entry.id}
              className="border-b py-2 last:border-b-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono" style={{ color: 'var(--color-text-dim)' }}>
                  {formatAt(entry.at)}
                </span>
                <span style={{ color: 'var(--color-text-dim)' }}>{describeDir(entry.direction)}</span>
                <span>{METHOD_LABELS[entry.method] ?? entry.method}</span>
                <span className="font-mono" style={{ color: 'var(--color-text-dim)' }}>
                  {entry.method}
                </span>
                {entry.handshake && (
                  <span
                    className="rounded px-1"
                    style={{ backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-dim)' }}
                  >
                    握手
                  </span>
                )}
                <span style={{ color: 'var(--color-text-dim)' }}>{entry.serverId}</span>
                {entry.latencyMs !== null && (
                  <span style={{ color: 'var(--color-text-dim)' }}>{entry.latencyMs}ms</span>
                )}
                {entry.httpStatus !== null && (
                  <span style={{ color: 'var(--color-text-dim)' }}>HTTP {entry.httpStatus}</span>
                )}
              </div>
              {entry.error !== null && (
                <p className="mt-1 break-all" style={{ color: 'var(--color-danger)' }}>
                  {entry.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.hasMore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-3 rounded-full border px-3 py-1 text-xs disabled:opacity-50"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {loadingMore ? '加载中…' : '加载更早的记录'}
        </button>
      )}
    </section>
  )
}
