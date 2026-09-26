/**
 * Prompt / 世界书 API（Phase 7A · SPEC §9.4）。服务端权威，这里只是薄封装。
 */
import type { PromptView, WorldbookEntry, WorldbookMode } from '@shared/types'
import { fetchJson, fetchVoid } from './api'

export function getPromptView(): Promise<PromptView> {
  return fetchJson('/api/prompt/view')
}

export function savePersonaPrompt(content: string): Promise<{ content: string; customized: boolean }> {
  return fetchJson('/api/prompt/persona', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

/** 恢复默认 = 清空（SPEC §9.4.1：没有出厂人格）。 */
export function clearPersonaPrompt(): Promise<{ content: string; customized: boolean }> {
  return fetchJson('/api/prompt/persona', { method: 'DELETE' })
}

export function listWorldbookEntries(): Promise<{ entries: WorldbookEntry[] }> {
  return fetchJson('/api/worldbook')
}

export interface WorldbookInput {
  title: string
  content: string
  keys: string[]
  mode: WorldbookMode
  enabled?: boolean
  sortOrder?: number
}

export function createWorldbookEntry(input: WorldbookInput): Promise<WorldbookEntry> {
  return fetchJson('/api/worldbook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateWorldbookEntry(id: string, patch: Partial<WorldbookInput>): Promise<WorldbookEntry> {
  return fetchJson(`/api/worldbook/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteWorldbookEntry(id: string): Promise<void> {
  return fetchVoid(`/api/worldbook/${id}`, { method: 'DELETE' })
}
