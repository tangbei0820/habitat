/**
 * API 方案（LLM）的前端调用层。
 *
 * 两个约定：
 * - 所有请求走 `/api/providers*`，前端**不直连任何上游**（铁律 3）
 * - 密钥**只写不读**：写入走 `setProviderSecret`，清除走 `clearProviderSecret`，
 *   后端没有任何端点会回显它，所以这里也拿不到 —— 类型上就不给回读的口子
 */
import type {
  ApiProfileCreateInput,
  ApiProfilePublic,
  ApiProfileUpdateInput,
  ChatFallbackConfig,
  LlmProbeResult,
  ProviderCapabilityBinding,
  ProviderCenterState,
  ProviderDraftInput,
  ProviderDraftModelsResult,
  ProviderDraftVoicesResult,
  ProviderDraftTestInput,
  ProviderDraftTestResult,
  ProviderScheme,
} from '@shared/types'
import { fetchJson } from '../../lib/api'

export interface ProviderList {
  active: ApiProfilePublic | null
  profiles: ApiProfilePublic[]
}

/** 密钥写入 / 清除的回执：只说明「现在能不能用」，不含密钥本身 */
export type ProviderKeyState = Pick<ApiProfilePublic, 'id' | 'hasKey' | 'keySource'>

export interface ProviderDeleteResult {
  deleted: true
  id: string
  active: ApiProfilePublic | null
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function providerPath(id: string): string {
  return `/api/providers/${encodeURIComponent(id)}`
}

export function listProviders(): Promise<ProviderList> {
  return fetchJson<ProviderList>('/api/providers')
}

export function createProvider(input: ApiProfileCreateInput): Promise<ApiProfilePublic> {
  return fetchJson<ApiProfilePublic>('/api/providers', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  })
}

export function updateProvider(id: string, patch: ApiProfileUpdateInput): Promise<ApiProfilePublic> {
  return fetchJson<ApiProfilePublic>(providerPath(id), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  })
}

export function deleteProvider(id: string): Promise<ProviderDeleteResult> {
  return fetchJson<ProviderDeleteResult>(providerPath(id), { method: 'DELETE' })
}

export function activateProvider(id: string): Promise<{ active: ApiProfilePublic }> {
  return fetchJson<{ active: ApiProfilePublic }>(`${providerPath(id)}/activate`, { method: 'POST' })
}

export function setProviderSecret(id: string, secret: string): Promise<ProviderKeyState> {
  return fetchJson<ProviderKeyState>(`${providerPath(id)}/secret`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ secret }),
  })
}

export function clearProviderSecret(id: string): Promise<ProviderKeyState> {
  return fetchJson<ProviderKeyState>(`${providerPath(id)}/secret`, { method: 'DELETE' })
}

/** 「测试连接」：失败也是**结果**（ok=false + 原因），不是异常 */
export function testProvider(id: string): Promise<LlmProbeResult> {
  return fetchJson<LlmProbeResult>(`${providerPath(id)}/test`, { method: 'POST' })
}

export function getProviderCenter(): Promise<ProviderCenterState> {
  return fetchJson<ProviderCenterState>('/api/provider-center')
}

export function saveChatFallback(input: Pick<ChatFallbackConfig, 'enabled' | 'profileIds'>): Promise<ChatFallbackConfig> {
  return fetchJson<ChatFallbackConfig>('/api/provider-center/chat-fallback', {
    method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input),
  })
}

export function pullDraftModels(input: ProviderDraftInput): Promise<ProviderDraftModelsResult> {
  return fetchJson<ProviderDraftModelsResult>('/api/providers/draft/models', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input),
  })
}

export function pullDraftVoices(input: ProviderDraftInput): Promise<ProviderDraftVoicesResult> {
  return fetchJson<ProviderDraftVoicesResult>('/api/providers/draft/voices', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input),
  })
}

export function testDraft(input: ProviderDraftTestInput): Promise<ProviderDraftTestResult> {
  return fetchJson<ProviderDraftTestResult>('/api/providers/draft/test', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input),
  })
}

export function saveCapabilityBinding(input: Omit<ProviderCapabilityBinding, 'updatedAt'>): Promise<ProviderCapabilityBinding> {
  return fetchJson<ProviderCapabilityBinding>('/api/provider-center/bindings', {
    method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input),
  })
}

export function createScheme(name: string): Promise<ProviderScheme> {
  return fetchJson<ProviderScheme>('/api/provider-center/schemes', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }),
  })
}

export function renameScheme(id: string, name: string): Promise<ProviderScheme> {
  return fetchJson<ProviderScheme>(`/api/provider-center/schemes/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }),
  })
}

export function copyScheme(id: string, name: string): Promise<ProviderScheme> {
  return fetchJson<ProviderScheme>(`/api/provider-center/schemes/${encodeURIComponent(id)}/copy`, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }),
  })
}

export function activateScheme(id: string): Promise<ProviderScheme> {
  return fetchJson<ProviderScheme>(`/api/provider-center/schemes/${encodeURIComponent(id)}/activate`, { method: 'POST' })
}

export function deleteScheme(id: string): Promise<{ deleted: true }> {
  return fetchJson<{ deleted: true }>(`/api/provider-center/schemes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
