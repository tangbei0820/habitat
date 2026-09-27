import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronLeft } from '../../components/qixi/Icons'
import { ApiRequestError } from '../../lib/api'
import { getNocturneDashboard, NOCTURNE_DASHBOARD_OPEN_PATH } from '../../lib/nocturne'

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : String(error)
}

export function NocturneDashboardPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    getNocturneDashboard()
      .then((result) => {
        if (result.configured) {
          setState('ready')
          setMessage(null)
        } else {
          setState('empty')
          setMessage(result.error)
        }
      })
      .catch((error: unknown) => {
        setState('error')
        setMessage(errorText(error))
      })
  }, [])

  return (
    <div className="flex min-h-full flex-col" style={{ background: 'var(--bg-base)' }} data-testid="nocturne-dashboard-page">
      <div className="sub-header" style={{ flex: 'none' }}>
        <Link to="/llm/memory" aria-label="返回记忆摘要" data-testid="nocturne-dashboard-back" className="icon-btn" style={{ flex: 'none' }}>
          <IconChevronLeft size={20} />
        </Link>
        <div className="sub-header-main">
          <span className="sub-title">记忆深处</span>
          <span className="sub-caption">Nocturne 原生管理器</span>
        </div>
        <a
          href={NOCTURNE_DASHBOARD_OPEN_PATH}
          target="_blank"
          rel="noreferrer"
          data-testid="nocturne-dashboard-external"
          className="rounded-lg border px-3 py-1.5 text-xs"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          新窗口打开
        </a>
      </div>

      {state === 'loading' && <p className="p-5 text-sm" style={{ color: 'var(--text-secondary)' }}>检查原生 Dashboard…</p>}
      {(state === 'empty' || state === 'error') && (
        <div className="m-5 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--border-soft)' }} data-testid="nocturne-dashboard-empty">
          <h1 className="font-medium">原生 Dashboard 尚未可用</h1>
          <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
            {message ?? '请在服务端配置 NOCTURNE_DASHBOARD_URL。'}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            这不会影响聊天里的记忆读取；这里只是完整管理页面的入口。
          </p>
        </div>
      )}
      {state === 'ready' && (
        <div className="min-h-0 flex-1 p-2" data-testid="nocturne-dashboard-frame-wrap">
          <p className="mb-2 px-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            页面由你部署的 Nocturne 原生前端提供。若内嵌页被上游 CSP 或登录态拦截，请点右上角在受保护页面打开。
          </p>
          <iframe
            title="Nocturne 原生 Dashboard"
            src={NOCTURNE_DASHBOARD_OPEN_PATH}
            referrerPolicy="no-referrer"
            className="w-full rounded-xl border"
            style={{ height: 'calc(100vh - 142px)', minHeight: 520, borderColor: 'var(--border-soft)', background: 'var(--bg-surface-solid)' }}
            data-testid="nocturne-dashboard-frame"
          />
        </div>
      )}
    </div>
  )
}
