/**
 * Eventide 状态适配器。
 *
 * 边界：Python sidecar 负责时间推进与渲染；Node 负责持久化。每次请求都把旧 state 带过去、
 * 收到新 state 后再原子覆盖 SQLite，因此 sidecar 本身可随时重启且不掌握用户数据。
 */
import { ErrorCodes } from '@shared/errors.js'
import type { StateProvider, StateTickOptions } from '@shared/providers.js'
import type { BodyStateSnapshot, StateProviderHealth } from '@shared/types.js'
import { getBodyStateSnapshot, saveBodyStateSnapshot } from '../db/state.js'
import { ProviderError } from './errors.js'

interface SidecarTickResponse {
  state: Record<string, unknown>
  state_card: string | null
  payload: Record<string, unknown>
}

const DEFAULT_TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.message)
      current = current.cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return parts.join(' <- ')
}

function parseTickResponse(value: unknown): SidecarTickResponse {
  if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.payload)) {
    throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Eventide sidecar 返回了无法识别的状态结果')
  }
  if (value.state_card !== null && typeof value.state_card !== 'string') {
    throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Eventide sidecar 的 state_card 类型无效')
  }
  return { state: value.state, state_card: value.state_card, payload: value.payload }
}

export class EventideStateProvider implements StateProvider {
  private lastError: string | null = null
  private lastCheckedAt = 0

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  current(): BodyStateSnapshot | null {
    return getBodyStateSnapshot()
  }

  async tick(now: Date, options: StateTickOptions = {}): Promise<BodyStateSnapshot> {
    if (Number.isNaN(now.getTime())) {
      throw new ProviderError(ErrorCodes.BadRequest, 'Eventide tick 的 now 不是有效时间')
    }
    const previous = this.current()
    const raw = await this.request('/v1/tick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: previous?.state ?? null,
        now: now.toISOString(),
        last_counterpart_message_at: options.lastCounterpartMessageAt?.toISOString() ?? null,
      }),
    })
    const response = parseTickResponse(raw)
    const snapshot: BodyStateSnapshot = {
      state: response.state,
      stateCard: response.state_card,
      payload: response.payload,
      settledAt: now.getTime(),
    }
    saveBodyStateSnapshot(snapshot)
    return snapshot
  }

  async health(): Promise<StateProviderHealth> {
    let revision: string | null = null
    try {
      const raw = await this.request('/health')
      if (!isRecord(raw) || raw.ok !== true) throw new Error('健康响应缺少 ok=true')
      revision = typeof raw.revision === 'string' ? raw.revision : null
    } catch (error) {
      // request 已经记下可读错误；健康端点永不抛出，避免一个 sidecar 拖垮聚合状态。
      return this.healthSnapshot(false, revision, errorMessage(error))
    }
    return this.healthSnapshot(true, revision, null)
  }

  private healthSnapshot(ok: boolean, revision: string | null, fallbackError: string | null): StateProviderHealth {
    return {
      ok,
      configured: true,
      service: 'eventide',
      revision,
      lastError: ok ? null : this.lastError ?? fallbackError,
      lastCheckedAt: this.lastCheckedAt || Date.now(),
    }
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const at = Date.now()
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      const text = await response.text()
      let body: unknown = text
      try { body = text === '' ? null : JSON.parse(text) } catch { /* 原文进入错误 detail */ }
      if (!response.ok) {
        throw new ProviderError(
          ErrorCodes.ProviderUpstreamError,
          `Eventide sidecar 返回 HTTP ${response.status}`,
          body,
        )
      }
      this.lastError = null
      this.lastCheckedAt = at
      return body
    } catch (error) {
      this.lastCheckedAt = at
      if (error instanceof ProviderError) {
        this.lastError = error.message
        throw error
      }
      const message = `连接 Eventide sidecar 失败：${errorMessage(error)}`
      this.lastError = message
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, message)
    }
  }
}

export function loadEventideStateProvider(env: NodeJS.ProcessEnv = process.env): EventideStateProvider | null {
  const raw = env.EVENTIDE_URL?.trim()
  if (raw === undefined || raw === '') return null
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('EVENTIDE_URL 必须是合法 URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('EVENTIDE_URL 只允许 http(s)')
  return new EventideStateProvider(raw.replace(/\/+$/, ''))
}
