/**
 * Nocturne 记忆页（Phase 7A · `/llm/memory`，从「大脑」进）。
 *
 * 数据源全部是只读端点：健康（/api/health/mcp）、记忆全文（breath）、关键词搜索（trace）。
 * Nocturne 是可降级外部依赖 —— 它挂了这里必须**诚实说挂了**，但绝不影响其它页面与聊天
 * （chat-context 里记忆是增强项，读不到就少一段）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronLeft } from '../../components/qixi/Icons'
import { useSlideIn } from '../../components/qixi/useSlideIn'
import { ApiRequestError } from '../../lib/api'
import { getMcpHealthView, getMemoryBoot, getMemoryWriteAudit, searchMemory } from '../../lib/memory'
import { log } from '../../lib/log'
import type { MemoryWriteAuditRecord } from '@shared/types'

type HealthState = 'loading' | 'ready' | 'unconfigured' | 'error'

function healthText(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : String(err)
}

export function MemoryPage() {
  const slide = useSlideIn()
  const [health, setHealth] = useState<HealthState>('loading')
  const [healthError, setHealthError] = useState<string | null>(null)

  const [boot, setBoot] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootLoading, setBootLoading] = useState(false)

  const [query, setQuery] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  const [audit, setAudit] = useState<MemoryWriteAuditRecord[]>([])
  const [auditError, setAuditError] = useState<string | null>(null)

  const loadAudit = useCallback((): void => {
    getMemoryWriteAudit()
      .then((data) => {
        setAudit(data.items)
        setAuditError(null)
      })
      .catch((err: unknown) => {
        log.error('读取记忆写入审计失败', err)
        setAuditError(healthText(err))
      })
  }, [])

  const loadHealth = useCallback((): void => {
    setHealth('loading')
    getMcpHealthView()
      .then((data) => {
        const nocturne = data.servers.find((server) => server.serverId === 'nocturne')
        // 「没配 URL」是未配置（一种初始状态），「配了但连不上」才是异常 —— 两种病分开说
        if (nocturne === undefined || nocturne.configured === false) {
          setHealth('unconfigured')
        } else if (nocturne.state === 'ready') {
          setHealth('ready')
          setHealthError(null)
        } else {
          setHealth('error')
          setHealthError(nocturne.lastError ?? `状态：${nocturne.state}`)
        }
      })
      .catch((err: unknown) => {
        log.error('读取 MCP 健康失败', err)
        setHealth('error')
        setHealthError(healthText(err))
      })
  }, [])

  const loadBoot = useCallback((): void => {
    setBootLoading(true)
    getMemoryBoot()
      .then((data) => {
        setBoot(data.text)
        setBootError(null)
      })
      .catch((err: unknown) => {
        log.error('读取记忆全文失败', err)
        setBoot(null)
        setBootError(healthText(err))
      })
      .finally(() => setBootLoading(false))
  }, [])

  useEffect(loadHealth, [loadHealth])
  useEffect(loadAudit, [loadAudit])

  /**
   * 记忆全文只在实例就绪时去读。⚠️ 未配置 / 异常时**不发请求** ——
   * 那是一记必然失败的调用，除了在控制台留一条「读不到」的报错没有任何产出；
   * 降级路径是设计出来的，不是异常。
   */
  useEffect(() => {
    if (health !== 'ready') return
    loadBoot()
  }, [health, loadBoot])

  const runSearch = (): void => {
    const q = query.trim()
    if (q === '') return
    if (health !== 'ready') {
      setSearchError('记忆实例未就绪，搜不了。等它恢复后再试。')
      return
    }
    setSearchLoading(true)
    searchMemory(q)
      .then((data) => {
        setResult(data.text)
        setSearchError(null)
      })
      .catch((err: unknown) => {
        log.error('搜索记忆失败', err)
        setResult(null)
        setSearchError(healthText(err))
      })
      .finally(() => setSearchLoading(false))
  }

  return (
    <div className={slide}>
      <div className="topbar">
        <Link to="/llm" aria-label="返回小栖档案" data-testid="memory-back" className="icon-btn" style={{ flex: 'none' }}>
          <IconChevronLeft size={20} />
        </Link>
        <h1 className="topbar-title">记忆</h1>
      </div>

      <div className="px-5 pb-6 pt-2">
        {/* 健康状态（§9.2.4 口径：区分未配置 / 正常 / 异常） */}
        <div className="rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="memory-health">
          <span style={{ color: 'var(--text-secondary)' }}>Nocturne：</span>
          {health === 'loading' && <span>检查中…</span>}
          {health === 'ready' && (
            <span style={{ color: 'var(--accent-strong)' }} data-testid="memory-health-ok">正常</span>
          )}
          {health === 'unconfigured' && (
            <span style={{ color: 'var(--text-tertiary)' }} data-testid="memory-health-unconfigured">
              未配置（服务端没接记忆实例，聊天不受影响，只是少了这段长期记忆）
            </span>
          )}
          {health === 'error' && (
            <span style={{ color: 'var(--danger)' }} data-testid="memory-health-error">
              异常：{healthError}
              <button type="button" className="ml-2 underline" onClick={loadHealth}>重试</button>
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="memory-dashboard-entry">
          <div>
            <div className="text-sm font-medium">进入记忆深处</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>打开同一套 Nocturne 原生 Dashboard，管理记忆树、审计与回滚。</div>
          </div>
          <Link to="/llm/memory/dashboard" className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }} data-testid="memory-dashboard-link">
            打开管理器
          </Link>
      </div>

        <section className="mt-4" data-testid="memory-audit">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">最近的记忆动作</h2>
            <button
              type="button"
              className="rounded-lg border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border-soft)' }}
              onClick={loadAudit}
            >刷新</button>
          </div>
          {auditError !== null && <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>{auditError}</p>}
          {audit.length === 0 && auditError === null && (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>还没有 Habitat 侧的写入记录。小栖不想记时什么都不会留下。</p>
          )}
          <div className="mt-2 space-y-2">
            {audit.map((item) => {
              const sessionId = typeof item.source.sessionId === 'string' ? item.source.sessionId : null
              const sourceKind = typeof item.source.kind === 'string' ? item.source.kind : 'unknown'
              const statusText = item.status === 'written' ? '已写入' : item.status === 'duplicate' ? '已去重' : item.status === 'failed' ? '失败' : '处理中'
              return (
                <div key={item.id} className="rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--border-soft)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.mode === 'correction' ? '修正记忆' : '新增记忆'} · {statusText}</span>
                    <span style={{ color: item.status === 'failed' ? 'var(--danger)' : 'var(--text-tertiary)' }}>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words" style={{ color: 'var(--text-secondary)' }}>{item.contentPreview}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--text-tertiary)' }}>
                    <span>来源：{sourceKind}</span>
                    <span>类型：{item.kind}</span>
                    {item.correctionOf !== null && <span>修正线索：{item.correctionOf}</span>}
                    {sessionId !== null && <Link className="underline" to={`/chat/${encodeURIComponent(sessionId)}`}>回到原会话</Link>}
                  </div>
                  {item.error !== null && <p className="mt-1" style={{ color: 'var(--danger)' }}>失败原因：{item.error}</p>}
                </div>
              )
            })}
          </div>
        </section>

        {/* 记忆全文（breath） */}
        <section className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">记忆全文</h2>
            <button
              type="button"
              data-testid="memory-boot-refresh"
              disabled={bootLoading}
              className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
              style={{ borderColor: 'var(--border-soft)' }}
              onClick={loadBoot}
            >
              {bootLoading ? '读取中…' : '刷新'}
            </button>
          </div>
          {bootError !== null && (
            <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }} data-testid="memory-boot-error">
              读不到：{bootError}
            </p>
          )}
          {health !== 'ready' && boot === null && bootError === null && (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }} data-testid="memory-boot-hint">
              记忆实例未就绪，此刻没有可读的记忆。这不影响聊天 —— 小栖在对话里少了这段背景，其余照常。
            </p>
          )}
          {boot !== null && (
            <pre
              data-testid="memory-boot-text"
              className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-xs"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
            >
              {boot}
            </pre>
          )}
        </section>

        {/* 关键词搜索（trace） */}
        <section className="mt-4">
          <h2 className="text-sm font-medium">搜索记忆</h2>
          <div className="mt-2 flex gap-2">
            <input
              data-testid="memory-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="按关键词搜"
              className="min-w-0 flex-1 rounded-lg border p-2 text-sm"
              style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
            />
            <button
              type="button"
              data-testid="memory-search-run"
              disabled={searchLoading || query.trim() === ''}
              className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--accent-strong)' }}
              onClick={runSearch}
            >
              {searchLoading ? '搜索中…' : '搜索'}
            </button>
          </div>
          {searchError !== null && (
            <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }} data-testid="memory-search-error">
              搜不到：{searchError}
            </p>
          )}
          {result !== null && (
            <pre
              data-testid="memory-search-result"
              className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-xs"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
            >
              {result}
            </pre>
          )}
        </section>

        <p className="mt-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
          这里只有摘要、搜索和审计。记忆写入由小栖在 Runtime 中自行决定；不值得记时可以 no-op。原地编辑、删除与版本回滚进入同一套 Nocturne 原生 Dashboard，本页不复制那套管理器。
        </p>
      </div>
    </div>
  )
}
