/**
 * Nocturne 记忆页 API（Phase 7A）。服务端只有两个只读端点（对应实例工具 breath / trace），
 * 健康走 /api/health/mcp。
 */
import type { McpHealth } from '@shared/types'
import type { MemoryWriteAuditRecord } from '@shared/types'
import { fetchJson } from './api'

export interface MemoryTextResult {
  text: string
}

export function getMemoryBoot(): Promise<MemoryTextResult> {
  return fetchJson('/api/memory/boot')
}

export function searchMemory(query: string, limit = 30): Promise<MemoryTextResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return fetchJson(`/api/memory/search?${params.toString()}`)
}

export function getMcpHealthView(): Promise<McpHealth> {
  return fetchJson('/api/health/mcp')
}

export function getMemoryWriteAudit(limit = 20): Promise<{ items: MemoryWriteAuditRecord[] }> {
  return fetchJson(`/api/memory/audit?limit=${encodeURIComponent(String(limit))}`)
}
