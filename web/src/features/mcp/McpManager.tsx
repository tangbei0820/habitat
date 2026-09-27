import { useEffect, useState } from 'react'
import type { McpDiagnosticEntry, McpServerCreateInput, McpServerUpdateInput, McpServerView, McpToolView } from '@shared/types'
import { ApiRequestError } from '../../lib/api'
import * as api from './api'

const INPUT = 'w-full rounded-md border px-3 py-2 text-sm'
const INPUT_STYLE = { borderColor: 'var(--border-soft)', background: 'var(--bg-base)', color: 'var(--text-primary)' } as const

function message(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : String(error)
}

function statusText(server: McpServerView): string {
  if (!server.enabled) return '已关闭'
  if (!server.configured) return '未配置'
  if (server.state === 'ready') return `正常 · ${server.toolCount} 个工具`
  if (server.state === 'connecting' || server.state === 'handshake') return '连接中…'
  if (server.state === 'error') return '异常'
  return '未连接'
}

function statusColor(server: McpServerView): string {
  if (server.state === 'ready' && server.enabled) return 'var(--accent-strong)'
  if (server.state === 'error') return 'var(--danger)'
  return 'var(--text-secondary)'
}

interface EditorProps {
  initial?: McpServerView
  busy: boolean
  onCancel?: () => void
  onSave: (input: McpServerCreateInput | McpServerUpdateInput) => Promise<void>
}

function ServerEditor({ initial, busy, onCancel, onSave }: EditorProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [token, setToken] = useState('')
  // 新连接默认关闭：先保存、测试通过，再显式接入 Runtime 工具面。
  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [allowAutonomous, setAllowAutonomous] = useState(initial?.allowAutonomous ?? false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    if (name.trim() === '' || url.trim() === '') {
      setError('名称和 MCP URL 都要填写')
      return
    }
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        url: url.trim(),
        ...(token.trim() === '' ? {} : { token: token.trim() }),
        enabled,
        allowAutonomous,
      })
    } catch (cause) {
      setError(message(cause))
    }
  }

  return (
    <div className="mt-3 rounded-md border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid={initial ? `mcp-editor-${initial.serverId}` : 'mcp-editor-new'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">名称<input className={INPUT} style={INPUT_STYLE} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Nocturne" /></label>
        <label className="text-xs">Streamable HTTP URL<input className={INPUT} style={INPUT_STYLE} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:8000/mcp" /></label>
        <label className="text-xs sm:col-span-2">Bearer Token（只写入服务端）<input className={INPUT} style={INPUT_STYLE} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={initial?.hasToken === true ? '已保存；留空沿用' : '可留空'} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用连接</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={allowAutonomous} onChange={(event) => setAllowAutonomous(event.target.checked)} />允许 AI 自主绑定工具</label>
      </div>
      {error !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '保存连接'}</button>
        {onCancel !== undefined && <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy} onClick={onCancel}>取消</button>}
      </div>
    </div>
  )
}

function ToolList({ tools }: { tools: McpToolView[] }) {
  return (
    <div className="mt-3 rounded-md border p-3" style={{ borderColor: 'var(--border-soft)' }}>
      {tools.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>当前没有可用工具。</p> : (
        <ul className="flex flex-col gap-2">
          {tools.map((tool) => <li key={`${tool.serverId}:${tool.name}`}><div className="text-xs font-medium">{tool.name}</div>{tool.description !== null && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{tool.description}</div>}</li>)}
        </ul>
      )}
    </div>
  )
}

function DiagnosticList({ entries }: { entries: McpDiagnosticEntry[] }) {
  return (
    <div className="mt-3 rounded-md border p-3" style={{ borderColor: 'var(--border-soft)' }}>
      {entries.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>还没有调用记录。</p> : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-xs"><span style={{ color: 'var(--text-secondary)' }}>{new Date(entry.at).toLocaleString()}</span><span>{entry.method}</span><span style={{ color: entry.error === null ? 'var(--accent-strong)' : 'var(--danger)' }}>{entry.error === null ? `${entry.latencyMs ?? '-'}ms` : entry.error}</span></li>)}
        </ul>
      )}
    </div>
  )
}

export function McpManager() {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [tools, setTools] = useState<Record<string, McpToolView[]>>({})
  const [diagnostics, setDiagnostics] = useState<Record<string, McpDiagnosticEntry[]>>({})
  const [error, setError] = useState<string | null>(null)

  async function reload(): Promise<void> {
    setLoading(true)
    try {
      const result = await api.getMcpManager()
      setServers(result.servers)
      setError(null)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  async function run(id: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id)
    setError(null)
    try { await action(); await reload() } catch (cause) { setError(message(cause)) } finally { setBusyId(null) }
  }

  async function create(input: McpServerCreateInput | McpServerUpdateInput): Promise<void> {
    await api.createMcpServer(input as McpServerCreateInput)
    setShowNew(false)
    await reload()
  }

  async function update(id: string, input: McpServerCreateInput | McpServerUpdateInput): Promise<void> {
    await api.updateMcpServer(id, input as McpServerUpdateInput)
    setEditingId(null)
    await reload()
  }

  async function showTools(server: McpServerView): Promise<void> {
    if (tools[server.serverId] !== undefined) {
      setTools((current) => { const next = { ...current }; delete next[server.serverId]; return next })
      return
    }
    await run(server.serverId, async () => {
      const result = await api.getMcpTools(server.serverId)
      setTools((current) => ({ ...current, [server.serverId]: result.tools }))
    })
  }

  async function showDiagnostics(server: McpServerView): Promise<void> {
    if (diagnostics[server.serverId] !== undefined) {
      setDiagnostics((current) => { const next = { ...current }; delete next[server.serverId]; return next })
      return
    }
    await run(server.serverId, async () => {
      const result = await api.getMcpDiagnostics(server.serverId)
      setDiagnostics((current) => ({ ...current, [server.serverId]: result.entries }))
    })
  }

  return (
    <section className="mb-4" data-testid="mcp-manager">
      <div className="setting-group-label">工具与 MCP</div>
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface-solid)' }}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">MCP 连接</h2><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>管理连接状态与工具面；凭据只保存在服务端。</p></div><button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => { setShowNew((value) => !value); setEditingId(null) }}>{showNew ? '收起' : '+ 添加 MCP'}</button></div>
        {showNew && <ServerEditor busy={busyId === '__new__'} onCancel={() => setShowNew(false)} onSave={async (input) => { setBusyId('__new__'); try { await create(input) } finally { setBusyId(null) } }} />}
        {error !== null && <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
        {loading ? <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>读取中…</p> : servers.length === 0 ? <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>还没有 MCP 连接。</p> : (
          <ul className="mt-3 flex flex-col gap-2">
            {servers.map((server) => <li key={server.serverId} className="rounded-md border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid={`mcp-server-${server.serverId}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{server.name}</span><span className="text-xs" style={{ color: statusColor(server) }}>{statusText(server)}</span></div><div className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{server.url ?? '尚未配置 URL'}</div><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{server.hasToken ? 'Token 已保存' : '无 Token'} · {server.allowAutonomous ? '允许 AI 自主绑定' : '仅用户 / Runtime 显式使用'}</div></div><label className="inline-flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={server.enabled} disabled={busyId === server.serverId} onChange={(event) => void run(server.serverId, () => api.updateMcpServer(server.serverId, { enabled: event.target.checked }))} />启用</label></div>
              {server.lastError !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{server.lastError}</p>}
              {editingId === server.serverId && <ServerEditor initial={server} busy={busyId === server.serverId} onCancel={() => setEditingId(null)} onSave={(input) => update(server.serverId, input)} />}
              {tools[server.serverId] !== undefined && <ToolList tools={tools[server.serverId]} />}
              {diagnostics[server.serverId] !== undefined && <DiagnosticList entries={diagnostics[server.serverId]} />}
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busyId === server.serverId} onClick={() => void run(server.serverId, () => api.testMcpServer(server.serverId))}>测试连接</button><button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busyId === server.serverId || server.state !== 'ready'} onClick={() => void showTools(server)}>{tools[server.serverId] === undefined ? '查看工具' : '收起工具'}</button><button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busyId === server.serverId} onClick={() => void showDiagnostics(server)}>{diagnostics[server.serverId] === undefined ? '最近调用' : '收起记录'}</button><button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busyId === server.serverId} onClick={() => setEditingId((current) => current === server.serverId ? null : server.serverId)}>编辑</button><button type="button" className="rounded-md border px-2 py-1 text-xs" style={{ color: 'var(--danger)' }} disabled={busyId === server.serverId} onClick={() => { if (window.confirm(`删除「${server.name}」？`)) void run(server.serverId, () => api.deleteMcpServer(server.serverId)) }}>删除</button></div>
            </li>)}
          </ul>
        )}
      </div>
    </section>
  )
}
