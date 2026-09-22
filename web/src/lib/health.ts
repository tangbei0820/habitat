import type { McpHealth, ServerHealth } from '@shared/types'
import { fetchJson } from './api'

export function getServerHealth(): Promise<ServerHealth> {
  return fetchJson<ServerHealth>('/api/health')
}

export function getMcpHealth(): Promise<McpHealth> {
  return fetchJson<McpHealth>('/api/health/mcp')
}
