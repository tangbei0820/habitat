/**
 * MCP 诊断日志的前端调用层（设置页「诊断日志」时间线）。
 *
 * 走 `/api/diagnostics/mcp`（只读）。筛选与游标都由服务端做 ——
 * 日志会越长越多，前端绝不能「先全量取回来再过滤」。
 */
import type { McpDiagnosticPage, McpDiagnosticQuery } from '@shared/types'
import { fetchJson } from './api'

function toSearchParams(query: McpDiagnosticQuery): string {
  const params = new URLSearchParams()
  if (query.serverId !== undefined) params.set('serverId', query.serverId)
  // 三态：只有显式给了布尔才带上，否则等于「不筛」
  if (query.handshake !== undefined) params.set('handshake', query.handshake ? '1' : '0')
  if (query.errorsOnly === true) params.set('errorsOnly', '1')
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.before !== undefined) params.set('before', String(query.before))
  const qs = params.toString()
  return qs === '' ? '' : `?${qs}`
}

export function listMcpDiagnostics(query: McpDiagnosticQuery = {}): Promise<McpDiagnosticPage> {
  return fetchJson<McpDiagnosticPage>(`/api/diagnostics/mcp${toSearchParams(query)}`)
}
