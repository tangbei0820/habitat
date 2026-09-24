import { useEffect, useState } from 'react'
import type { McpHealth, ServerHealth } from '@shared/types'
import { IconAlert, IconCheck, IconMoon, IconSun } from '../../components/qixi/Icons'
import { useTheme } from '../../theme/useTheme'
import { BackupPanel } from '../../features/backup/BackupPanel'
import { DiagnosticPanel } from '../../features/diagnostics/DiagnosticPanel'
import { ProviderSettings } from '../../features/providers/ProviderSettings'
import { ApiRequestError } from '../../lib/api'
import { getMcpHealth, getServerHealth } from '../../lib/health'
import { log } from '../../lib/log'

function useHealth<T>(fetcher: () => Promise<T>): {
  data: T | null
  error: string | null
  retry: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetcher()
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        log.error('健康检查失败', err)
        if (!cancelled) {
          setError(err instanceof ApiRequestError ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  return { data, error, retry: () => setTick((t) => t + 1) }
}

export function SettingPage() {
  const { mode, toggle } = useTheme()
  const server = useHealth<ServerHealth>(getServerHealth)
  const mcp = useHealth<McpHealth>(getMcpHealth)

  return (
    <div className="px-4 py-6">
      <h1 className="mb-4 text-lg font-semibold">设置</h1>

      <section
        className="mb-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-dim)' }}>
          外观
        </h2>
        <div className="flex items-center justify-between">
          <span>主题</span>
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-full border px-4 py-1 text-sm"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {mode === 'dark' ? <IconMoon size={14} /> : <IconSun size={14} />}
            {mode === 'dark' ? '深色' : '浅色'}
          </button>
        </div>
      </section>

      <ProviderSettings />

      <section
        className="mb-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-dim)' }}>
          系统状态
        </h2>
        {server.data && (
          <p className="flex items-center gap-1.5 text-sm">
            <IconCheck size={13} style={{ color: 'var(--color-primary)' }} />
            <span>habitat-server：正常（{new Date(server.data.time).toLocaleTimeString()}）</span>
          </p>
        )}
        {server.error !== null && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--color-danger)' }}>
            <IconAlert size={14} />
            <span>后端不可达：{server.error}</span>
            <button type="button" className="underline" onClick={server.retry}>
              重试
            </button>
          </p>
        )}

        <h3 className="mb-2 mt-4 text-sm font-semibold" style={{ color: 'var(--color-text-dim)' }}>
          MCP 工具网关
        </h3>
        {mcp.data?.servers.map((s) => (
          <div key={s.serverId} className="mb-1 flex flex-wrap items-center gap-1.5 text-sm">
            {s.state === 'ready' ? (
              <IconCheck size={13} style={{ color: 'var(--color-primary)' }} />
            ) : (
              <IconAlert size={13} style={{ color: 'var(--color-danger)' }} />
            )}
            <span>
              {s.serverId}（{s.state}
              {s.toolCount > 0 ? `，${s.toolCount} 个工具` : ''}）
            </span>
            {s.lastError !== null && (
              <span style={{ color: 'var(--color-danger)' }}> — {s.lastError}</span>
            )}
          </div>
        ))}
        {mcp.error !== null && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--color-danger)' }}>
            <IconAlert size={14} />
            <span>MCP 健康检查失败：{mcp.error}</span>
            <button type="button" className="underline" onClick={mcp.retry}>
              重试
            </button>
          </p>
        )}
      </section>

      <DiagnosticPanel serverIds={mcp.data?.servers.map((s) => s.serverId) ?? []} />

      <BackupPanel />

      <section
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-dim)' }}
      >
        记忆与状态模块（Nocturne / Eventide）将在 Phase 3 接入
      </section>
    </div>
  )
}
