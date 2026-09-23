/**
 * Eventide 状态适配器。
 *
 * 边界：Python sidecar 负责时间推进与渲染；Node 负责持久化。每次请求都把旧 state 带过去、
 * 收到新 state 后再原子覆盖 SQLite，因此 sidecar 本身可随时重启且不掌握用户数据。
 */
import { ErrorCodes } from '@shared/errors.js'
import type {
  StateDreamTrigger,
  StateEventResult,
  StateProvider,
  StateTickOptions,
} from '@shared/providers.js'
import type { BodyStateSnapshot, StateProviderHealth } from '@shared/types.js'
import { getBodyStateSnapshot, saveBodyStateSnapshot } from '../db/state.js'
import { ProviderError } from './errors.js'

interface SidecarTickResponse {
  state: Record<string, unknown>
  state_card: string | null
  payload: Record<string, unknown>
}

interface SidecarEventResponse extends SidecarTickResponse {
  event_key: string | null
  started: boolean
}

interface SidecarDreamResponse extends SidecarTickResponse {
  trigger: {
    prompt: string
    probability: number
    roll: number
    created_at: number
  } | null
}

// 同机 sidecar 正常是毫秒级；挂起时不能让每轮聊天跟着空等十几秒。
const DEFAULT_TIMEOUT_MS = 3_000

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

function parseEventResponse(value: unknown): SidecarEventResponse {
  const snapshot = parseTickResponse(value)
  if (!isRecord(value) || (value.event_key !== null && typeof value.event_key !== 'string') || typeof value.started !== 'boolean') {
    throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Eventide sidecar 返回了无法识别的事件结果')
  }
  return { ...snapshot, event_key: value.event_key, started: value.started }
}

function parseDreamResponse(value: unknown): SidecarDreamResponse {
  const snapshot = parseTickResponse(value)
  if (!isRecord(value)) throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Eventide 梦境结果无效')
  if (value.trigger === null) return { ...snapshot, trigger: null }
  if (!isRecord(value.trigger)
    || typeof value.trigger.prompt !== 'string'
    || typeof value.trigger.probability !== 'number'
    || typeof value.trigger.roll !== 'number'
    || typeof value.trigger.created_at !== 'number') {
    throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Eventide sidecar 返回了无法识别的梦境结果')
  }
  return {
    ...snapshot,
    trigger: {
      prompt: value.trigger.prompt,
      probability: value.trigger.probability,
      roll: value.trigger.roll,
      created_at: value.trigger.created_at,
    },
  }
}

function localEventParts(now: Date, timeZone: string): { hour: number; dayKey: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = new Map(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  const year = parts.get('year') ?? '1970'
  const month = parts.get('month') ?? '01'
  const day = parts.get('day') ?? '01'
  const hour = Number(parts.get('hour') ?? 0) + Number(parts.get('minute') ?? 0) / 60
  return { hour, dayKey: `${year}-${month}-${day}` }
}

function zonedIso(now: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'longOffset',
  })
  const parts = new Map(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  const offset = (parts.get('timeZoneName') ?? 'GMT+00:00').replace('GMT', '') || '+00:00'
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}.${String(now.getMilliseconds()).padStart(3, '0')}${offset}`
}

export class EventideStateProvider implements StateProvider {
  private lastError: string | null = null
  private lastCheckedAt = 0
  /** 两轮聊天同时到达时，避免都读到同一份旧快照后互相覆盖。 */
  private tickQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  current(): BodyStateSnapshot | null {
    return getBodyStateSnapshot()
  }

  tick(now: Date, options: StateTickOptions = {}): Promise<BodyStateSnapshot> {
    if (Number.isNaN(now.getTime())) {
      return Promise.reject(new ProviderError(ErrorCodes.BadRequest, 'Eventide tick 的 now 不是有效时间'))
    }
    return this.enqueue(() => this.performTick(now, options))
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tickQueue.then(work)
    // 无论这一轮成功还是失败，后面的状态写入都能继续；调用方仍拿到原始 pending 的结果。
    this.tickQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async performTick(now: Date, options: StateTickOptions): Promise<BodyStateSnapshot> {
    const previous = this.current()
    const effectiveNow = new Date(Math.max(now.getTime(), previous?.settledAt ?? 0))
    const raw = await this.request('/v1/tick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: previous?.state ?? null,
        now: effectiveNow.toISOString(),
        last_counterpart_message_at: options.lastCounterpartMessageAt?.toISOString() ?? null,
      }),
    })
    const response = parseTickResponse(raw)
    const snapshot: BodyStateSnapshot = {
      state: response.state,
      stateCard: response.state_card,
      payload: response.payload,
      settledAt: effectiveNow.getTime(),
    }
    saveBodyStateSnapshot(snapshot)
    return snapshot
  }

  async settlementPrompt(messageWindowText: string): Promise<string> {
    const previous = this.current()
    if (previous === null) {
      throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'Eventide 尚未建立状态，无法生成互动结算 prompt')
    }
    const raw = await this.request('/v1/settlement/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: previous.state, message_window_text: messageWindowText }),
    })
    if (!isRecord(raw) || typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, 'Eventide sidecar 返回了空的互动结算 prompt')
    }
    return raw.prompt
  }

  settle(result: unknown, now = new Date()): Promise<BodyStateSnapshot> {
    return this.enqueue(async () => {
      const previous = this.current()
      if (previous === null) throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'Eventide 尚未建立状态')
      const effectiveNow = new Date(Math.max(now.getTime(), previous.settledAt))
      const raw = await this.request('/v1/settlement/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: previous.state, result, now: effectiveNow.toISOString() }),
      })
      return this.persistResponse(parseTickResponse(raw), effectiveNow)
    })
  }

  checkEvents(now: Date, options: StateTickOptions = {}): Promise<StateEventResult> {
    return this.enqueue(async () => {
      let previous = this.current()
      if (previous === null) previous = await this.performTick(now, options)
      const effectiveNow = new Date(Math.max(now.getTime(), previous.settledAt))
      const local = localEventParts(effectiveNow, options.timeZone ?? 'Asia/Shanghai')
      const raw = await this.request('/v1/events/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state: previous.state,
          now: effectiveNow.toISOString(),
          last_counterpart_message_at: options.lastCounterpartMessageAt?.toISOString() ?? null,
          counterpart_text: options.counterpartText ?? '',
          trigger_words: options.triggerWords ?? [],
          local_hour: local.hour,
          local_day_key: local.dayKey,
        }),
      })
      const response = parseEventResponse(raw)
      const snapshot = this.persistResponse(response, effectiveNow)
      return { snapshot, eventKey: response.event_key, started: response.started }
    })
  }

  checkDream(
    seed: string,
    now: Date,
    lastCounterpartMessageAt: Date,
    timeZone = 'Asia/Shanghai',
  ): Promise<StateDreamTrigger | null> {
    return this.enqueue(async () => {
      const previous = this.current()
      if (previous === null) throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'Eventide 尚未建立状态')
      const effectiveNow = new Date(Math.max(now.getTime(), previous.settledAt))
      const raw = await this.request('/v1/dream/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state: previous.state,
          now: zonedIso(effectiveNow, timeZone),
          seed,
          last_counterpart_message_at: lastCounterpartMessageAt.toISOString(),
        }),
      })
      const response = parseDreamResponse(raw)
      this.persistResponse(response, effectiveNow)
      if (response.trigger === null) return null
      return {
        prompt: response.trigger.prompt,
        probability: response.trigger.probability,
        roll: response.trigger.roll,
        createdAt: response.trigger.created_at,
      }
    })
  }

  applyDreamTags(tags: string[], now = new Date()): Promise<BodyStateSnapshot> {
    return this.enqueue(async () => {
      const previous = this.current()
      if (previous === null) throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'Eventide 尚未建立状态')
      const effectiveNow = new Date(Math.max(now.getTime(), previous.settledAt))
      const raw = await this.request('/v1/dream/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: previous.state, tags, now: effectiveNow.toISOString() }),
      })
      return this.persistResponse(parseTickResponse(raw), effectiveNow)
    })
  }

  private persistResponse(response: SidecarTickResponse, at: Date): BodyStateSnapshot {
    const snapshot: BodyStateSnapshot = {
      state: response.state,
      stateCard: response.state_card,
      payload: response.payload,
      settledAt: at.getTime(),
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
