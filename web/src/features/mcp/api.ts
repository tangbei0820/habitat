import type {
  McpDiagnosticPage,
  McpManagerState,
  McpServerCreateInput,
  McpServerUpdateInput,
  McpServerView,
  McpTestResult,
  McpToolView,
} from '@shared/types'
import { fetchJson } from '../../lib/api'

export function getMcpManager(): Promise<McpManagerState> {
  return fetchJson<McpManagerState>('/api/mcp/servers')
}

export function createMcpServer(input: McpServerCreateInput): Promise<McpServerView> {
  return fetchJson<McpServerView>('/api/mcp/servers', { method: 'POST', body: JSON.stringify(input) })
}

export function updateMcpServer(id: string, patch: McpServerUpdateInput): Promise<McpServerView> {
  return fetchJson<McpServerView>(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteMcpServer(id: string): Promise<{ deleted: true }> {
  return fetchJson<{ deleted: true }>(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function testMcpServer(id: string): Promise<McpTestResult> {
  return fetchJson<McpTestResult>(`/api/mcp/servers/${encodeURIComponent(id)}/test`, { method: 'POST', body: '{}' })
}

export function getMcpTools(id: string): Promise<{ tools: McpToolView[] }> {
  return fetchJson<{ tools: McpToolView[] }>(`/api/mcp/servers/${encodeURIComponent(id)}/tools`)
}

export function getMcpDiagnostics(id: string, limit = 5): Promise<McpDiagnosticPage> {
  const params = new URLSearchParams({ serverId: id, limit: String(limit) })
  return fetchJson<McpDiagnosticPage>(`/api/diagnostics/mcp?${params.toString()}`)
}
