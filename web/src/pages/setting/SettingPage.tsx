import { useEffect, useState } from 'react'
import type { McpHealth, ServerHealth } from '@shared/types'
import { IconAlert, IconCheck, IconMoon, IconSun } from '../../components/qixi/Icons'
import { useTheme } from '../../theme/useTheme'
import { BackupPanel } from '../../features/backup/BackupPanel'
import { DiagnosticPanel } from '../../features/diagnostics/DiagnosticPanel'
import { IdentitySettings } from '../../features/setting/IdentitySettings'
import { PromptSettings } from '../../features/setting/PromptSettings'
import { ProviderSettings } from '../../features/providers/ProviderSettings'
import { McpManager } from '../../features/mcp/McpManager'
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
  const { mode, setMode } = useTheme()
  const server = useHealth<ServerHealth>(getServerHealth)
  const mcp = useHealth<McpHealth>(getMcpHealth)

  return (
    <div>
      <div className="topbar">
        <h1 className="t-h1">设置</h1>
      </div>

      <div style={{ padding: '6px 20px 8px' }}>
        {/* 住客信息（screens-setting.jsx 的门面卡） */}
        <div className="card flex items-center" style={{ gap: 15, padding: '18px 20px' }}>
          <div
            className="flex flex-none items-center justify-center"
            style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'linear-gradient(145deg, #8b95a3, #4c5560 72%)',
              color: '#fff', fontSize: 21, fontWeight: 500,
              boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.35)',
            }}
          >
            栖
          </div>
          <div className="min-w-0 flex-1">
            <div className="t-h2">住在这里的人</div>
            <div className="t-caption" style={{ color: 'var(--text-tertiary)', marginTop: 3 }}>把日子过慢一点</div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-6">
        {/* 外观 */}
        <div className="setting-group-label">外观</div>
        <section className="setting-group" style={{ marginTop: 0 }}>
          <div className="setting-row">
            <span className="inline-flex flex-none" style={{ color: 'var(--text-secondary)' }}>
              {mode === 'dark' ? <IconMoon size={18} /> : <IconSun size={18} />}
            </span>
            <div className="setting-row-main">
              <div className="setting-row-title">主题</div>
              <div className="setting-row-sub">深色适合雨夜</div>
            </div>
            <div className="seg">
              <button
                type="button"
                data-testid="theme-light"
                className={`seg-item${mode === 'light' ? ' is-on' : ''}`}
                onClick={() => setMode('light')}
              >
                浅色
              </button>
              <button
                type="button"
                data-testid="theme-dark"
                className={`seg-item${mode === 'dark' ? ' is-on' : ''}`}
                onClick={() => setMode('dark')}
              >
                深色
              </button>
            </div>
          </div>
        </section>

        {/* 身份：双方的头像图与昵称（SPEC §9.1.3）—— 内容在这里配，显隐在聊天设置里控制 */}
        <IdentitySettings />

        {/* Prompt 与世界书（7A · SPEC §9.4）：人格 / 透明查看 / 世界书入口 */}
        <PromptSettings />

        <ProviderSettings />

        <McpManager />

        <BackupPanel />

        {/* 高级：系统状态与诊断（design §17：诊断分层、低调） */}
        <div className="setting-group-label">高级</div>
        <section
          className="setting-group mb-4"
          style={{ marginTop: 0 }}
        >
          <div className="setting-row">
            <div className="setting-row-main">
              <div className="setting-row-title">habitat-server</div>
            </div>
            {server.data && (
              <span className="flex items-center gap-1.5 text-sm">
                <IconCheck size={13} style={{ color: 'var(--accent-strong)' }} />
                正常（{new Date(server.data.time).toLocaleTimeString()}）
              </span>
            )}
            {server.error !== null && (
              <span className="flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
                <IconAlert size={14} />
                不可达：{server.error}
                <button type="button" className="underline" onClick={server.retry}>
                  重试
                </button>
              </span>
            )}
          </div>
          <div className="setting-row">
            <div className="setting-row-main">
              <div className="setting-row-title">MCP 工具网关</div>
              {mcp.data?.servers.map((s) => (
                <div key={s.serverId} className="mb-1 flex flex-wrap items-center gap-1.5 text-sm">
                  {s.state === 'ready' ? (
                    <IconCheck size={13} style={{ color: 'var(--accent-strong)' }} />
                  ) : (
                    <IconAlert size={13} style={{ color: 'var(--danger)' }} />
                  )}
                  <span>
                    {s.serverId}（{s.state}
                    {s.toolCount > 0 ? `，${s.toolCount} 个工具` : ''}）
                  </span>
                  {s.lastError !== null && (
                    <span style={{ color: 'var(--danger)' }}> — {s.lastError}</span>
                  )}
                </div>
              ))}
              {mcp.error !== null && (
                <p className="flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
                  <IconAlert size={14} />
                  <span>MCP 健康检查失败：{mcp.error}</span>
                  <button type="button" className="underline" onClick={mcp.retry}>
                    重试
                  </button>
                </p>
              )}
            </div>
          </div>
        </section>

        <DiagnosticPanel serverIds={mcp.data?.servers.map((s) => s.serverId) ?? []} />
      </div>
    </div>
  )
}
