import { useEffect, useMemo, useState } from 'react'
import type { McpToolDescriptor, ToolResultBlock } from '@shared/types'
import { fetchJson } from '../../lib/api'
import { log } from '../../lib/log'
import { useOnlineStatus } from '../offline/useOnlineStatus'

export function MiniTerminal({ onClose, onResult }: { onClose: () => void; onResult: (block: ToolResultBlock) => void }) {
  const online = useOnlineStatus()
  const [tools, setTools] = useState<McpToolDescriptor[] | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = useMemo(() => tools?.find((tool) => `${tool.serverId}:${tool.name}` === selectedKey), [tools, selectedKey])

  // 工具清单本身就要问后端拿 —— 离线时不发这个请求，并在界面上说清原因。
  // 依赖 online 还有个好处：恢复联网后会自动重新拉一次，用户不用关掉面板重开。
  useEffect(() => {
    if (!online) return
    let cancelled = false
    void fetchJson<{ tools: McpToolDescriptor[] }>('/api/tools')
      .then((body) => { if (!cancelled) { setTools(body.tools); setSelectedKey(body.tools[0] === undefined ? '' : `${body.tools[0].serverId}:${body.tools[0].name}`) } })
      .catch((err: unknown) => { log.error('读取 MCP 工具失败', err); if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [online])

  async function call(): Promise<void> {
    if (selected === undefined || busy) return
    let args: unknown
    try { args = JSON.parse(argsText) } catch { setError('参数不是合法 JSON'); return }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) { setError('参数必须是 JSON 对象'); return }
    setBusy(true); setError(null)
    try {
      const body = await fetchJson<{ result: unknown }>('/api/tools/call', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serverId: selected.serverId, name: selected.name, args }),
      })
      onResult({ kind: 'tool-result', payload: { toolName: `${selected.serverId}/${selected.name}`, ok: true, summary: '调用完成', result: body.result }, order: 0 })
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onResult({ kind: 'tool-result', payload: { toolName: `${selected.serverId}/${selected.name}`, ok: false, summary: message }, order: 0 })
    } finally { setBusy(false) }
  }

  return (
    <div data-testid="mini-terminal" className="absolute inset-x-3 top-3 z-20 max-h-[80%] overflow-auto rounded-xl border p-3 shadow-lg" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
      <div className="mb-2 flex items-center"><strong className="flex-1 text-sm">Mini Terminal</strong><button type="button" onClick={onClose} aria-label="关闭工具面板">×</button></div>
      {!online ? (
        // 单独给一句，不复用下面的「没有可用工具」—— 那句会把「断网」说成「没配 MCP」，指向完全错
        <p data-testid="tool-offline" className="text-xs" style={{ color: 'var(--text-secondary)' }}>当前离线。工具需要联网，恢复联网后会自动读取。</p>
      ) : tools === null && error === null ? <p className="text-xs">正在读取工具…</p> : tools?.length === 0 ? <p className="text-xs">没有可用工具。请先在设置中检查 MCP Server 状态。</p> : (
        <>
          <select data-testid="tool-select" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="mb-2 w-full rounded border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-base)' }}>
            {tools?.map((tool) => <option key={`${tool.serverId}:${tool.name}`} value={`${tool.serverId}:${tool.name}`}>{tool.serverId} / {tool.name}</option>)}
          </select>
          {selected?.description && <p className="mb-2 text-xs opacity-70">{selected.description}</p>}
          {selected !== undefined && <details className="mb-2 text-xs"><summary>参数格式</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(selected.inputSchema, null, 2)}</pre></details>}
          <textarea data-testid="tool-args" value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={5} className="w-full rounded border p-2 font-mono text-xs" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-base)' }} />
          <button type="button" data-testid="tool-call" disabled={selected === undefined || busy || !online} onClick={() => void call()} className="mt-2 rounded px-3 py-1.5 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{busy ? '调用中…' : '确认调用'}</button>
        </>
      )}
      {error !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
