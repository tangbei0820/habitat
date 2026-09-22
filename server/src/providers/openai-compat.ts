/**
 * 通用 OpenAI Chat Completions 兼容 Adapter（技术方案 §7.1）
 *
 * 只要一个服务能拼出 `{baseUrl}/chat/completions` 与 `{baseUrl}/models`，
 * 就能用它：DeepSeek 官方、各类中转、本地 vLLM / Ollama 的 `/v1` 全都属于这一类。
 * 差异（baseUrl、鉴权头、模型名）全部收敛在 ApiProfile 里，业务代码不感知。
 *
 * 刻意不引第三方 SDK：只需要 fetch + SSE 解析，自己写反而更好控错、更好排障。
 */
import { ErrorCodes } from '@shared/errors.js'
import type { LLMProvider, LlmChatMessage, LlmStreamChunk, StreamChatOptions } from '@shared/providers.js'
import type { ApiProfile } from '@shared/types.js'
import { ProviderError } from './errors.js'

/** 建连 / 等响应头的超时（不是整段流的总时限——长回复不能被杀） */
const DEFAULT_HEADER_TIMEOUT_MS = 30_000
/** 上游「多久没吐新数据」判定挂死 */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000
/** 错误详情里截断上游响应体，避免把整个 HTML 错误页塞进日志 */
const ERROR_SNIPPET_LIMIT = 400

/**
 * 取可读的失败原因。`fetch failed` 本身毫无信息量，
 * 真正的原因（ECONNREFUSED / 证书 / DNS）在 `err.cause` 里，必须带出来。
 */
function errMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause: unknown = err.cause
  if (cause === undefined || cause === null) return err.message
  const causeText = cause instanceof Error ? cause.message : String(cause)
  if (causeText === '' || causeText === err.message) return err.message
  return `${err.message}（${causeText}）`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === target)
}

/**
 * 把一个上游 chunk 翻译成 0..n 个 `LlmStreamChunk`。
 * 全程窄化，不信任上游结构（各家中转的实现细节差别很大）。
 */
function toStreamChunks(payload: unknown): LlmStreamChunk[] {
  if (!isRecord(payload)) return []
  const events: LlmStreamChunk[] = []

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const choice = choices.find(isRecord)
  let finishReason: string | null = null

  if (choice) {
    const rawDelta = choice.delta
    if (isRecord(rawDelta)) {
      const delta: NonNullable<Extract<LlmStreamChunk, { type: 'delta' }>['delta']> = {}
      const content = asString(rawDelta.content)
      // DeepSeek-R1 走 reasoning_content，部分中转直接用 reasoning
      const reasoning = asString(rawDelta.reasoning_content) ?? asString(rawDelta.reasoning)
      if (content !== undefined && content !== '') delta.content = content
      if (reasoning !== undefined && reasoning !== '') delta.reasoning = reasoning

      const calls = Array.isArray(rawDelta.tool_calls) ? rawDelta.tool_calls : []
      const call = calls.find(isRecord)
      if (call) {
        const fn = isRecord(call.function) ? call.function : {}
        const id = asString(call.id)
        const name = asString(fn.name)
        const args = asString(fn.arguments)
        delta.toolCall = {
          index: asNumber(call.index) ?? 0,
          ...(id === undefined ? {} : { id }),
          ...(name === undefined ? {} : { name }),
          ...(args === undefined ? {} : { argumentsDelta: args }),
        }
      }
      if (Object.keys(delta).length > 0) events.push({ type: 'delta', delta })
    }
    finishReason = asString(choice.finish_reason) ?? null
  }

  // 顺序保证：delta → usage → done（部分上游把 finish_reason 与 usage 塞在同一 chunk）
  if (isRecord(payload.usage)) {
    const usage = payload.usage
    events.push({
      type: 'usage',
      usage: {
        promptTokens: asNumber(usage.prompt_tokens) ?? 0,
        completionTokens: asNumber(usage.completion_tokens) ?? 0,
        totalTokens: asNumber(usage.total_tokens) ?? 0,
      },
    })
  }
  if (finishReason !== null) events.push({ type: 'done', finishReason })

  return events
}

/**
 * 逐 `data:` 行读取 SSE，并做**空闲超时**：上游静默挂死时主动中断，
 * 而不是让调用方无限等下去（这是流式最常见的「假死」形态）。
 */
async function* readSseData(body: ReadableStream<Uint8Array>, idleMs: number): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  const rearm = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      void reader.cancel()
    }, idleMs)
  }

  try {
    rearm()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rearm()
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        // 只关心 data: 行；event: / id: / 以 `:` 开头的注释（心跳）一律跳过
        if (line.startsWith('data:')) yield line.slice(5).trim()
        nl = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail.startsWith('data:')) yield tail.slice(5).trim()
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer)
    reader.releaseLock()
  }

  if (timedOut) {
    throw new ProviderError(ErrorCodes.ProviderUpstreamError, `上游 ${idleMs}ms 无新数据，已中断`)
  }
}

async function safeSnippet(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).trim()
    if (text === '') return null
    return text.length > ERROR_SNIPPET_LIMIT ? `${text.slice(0, ERROR_SNIPPET_LIMIT)}…` : text
  } catch {
    return null
  }
}

export class OpenAICompatProvider implements LLMProvider {
  constructor(
    private readonly profile: ApiProfile,
    /** 从 `profile.keyRef` 指向的环境变量解析出来的密钥；null = 未配置 */
    private readonly key: string | null,
  ) {}

  get profileId(): string {
    return this.profile.id
  }

  get defaultModel(): string {
    return this.profile.modelMap.chat ?? ''
  }

  async listModels(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string[]> {
    const res = await this.request('GET', '/models', undefined, {
      ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    })
    let body: unknown
    try {
      body = await res.json()
    } catch (err) {
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, `解析 /models 响应失败`, errMessage(err))
    }
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : []
    return data
      .map((item) => (isRecord(item) ? asString(item.id) : undefined))
      .filter((id): id is string => id !== undefined && id !== '')
  }

  async *streamChat(messages: LlmChatMessage[], opts: StreamChatOptions = {}): AsyncIterable<LlmStreamChunk> {
    const model = opts.model ?? this.defaultModel
    if (model === '') {
      throw new ProviderError(
        ErrorCodes.ProviderNotConfigured,
        `方案 '${this.profile.id}' 未指定 chat 模型（ApiProfile.modelMap.chat）`,
      )
    }
    if (messages.length === 0) {
      throw new ProviderError(ErrorCodes.BadRequest, 'streamChat 需要至少一条消息')
    }

    const payload = {
      model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.name === undefined ? {} : { name: message.name }),
        ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
      })),
      stream: true,
      // 让上游在末包回 usage，账本（§6.2 UsageRecord）才有 token 可记。
      // 极少数不支持该字段的自建上游可能报 400 —— 届时按方案加开关（见 docs/TASKS.md）。
      stream_options: { include_usage: true },
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      ...(opts.maxTokens === undefined ? {} : { max_tokens: opts.maxTokens }),
      ...(opts.tools === undefined ? {} : { tools: opts.tools }),
    }

    const res = await this.request('POST', '/chat/completions', payload, {
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    })
    if (res.body === null) {
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, `上游未返回流式响应体（${this.profile.id}）`)
    }

    const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    let doneEmitted = false
    for await (const data of readSseData(res.body, idleMs)) {
      if (data === '[DONE]') break
      if (data === '') continue
      let payloadChunk: unknown
      try {
        payloadChunk = JSON.parse(data)
      } catch {
        continue // 无法解析的行（心跳、厂商自定义）跳过，不打断整段流
      }
      for (const event of toStreamChunks(payloadChunk)) {
        if (event.type === 'done') doneEmitted = true
        yield event
      }
    }
    // 上游没给 finish_reason 也要收口，保证调用方一定拿到 done
    if (!doneEmitted) yield { type: 'done', finishReason: null }
  }

  /** 统一的出站请求：拼 URL、装配鉴权头、建连超时、非 2xx 映射为带错误码的 ProviderError */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    opts: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Response> {
    const url = `${this.profile.baseUrl.replace(/\/+$/, '')}${path}`
    const headers: Record<string, string> = {
      accept: method === 'GET' ? 'application/json' : 'text/event-stream, application/json',
      ...(this.profile.headers ?? {}),
      ...this.authHeaders(),
    }
    if (body !== undefined) headers['content-type'] = 'application/json'

    const timeoutMs = opts.timeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS
    // 用自有 controller 而非 AbortSignal.timeout：后者在读完响应头后仍会掐住响应体，
    // 长回复会被误杀。这里在拿到响应头后就解除计时。
    const headerTimer = new AbortController()
    const timer = setTimeout(() => headerTimer.abort(), timeoutMs)
    const signal =
      opts.signal === undefined ? headerTimer.signal : AbortSignal.any([opts.signal, headerTimer.signal])

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
      })
    } catch (err) {
      if (opts.signal?.aborted === true) {
        throw new ProviderError(ErrorCodes.ProviderUpstreamError, `请求 '${this.profile.id}' 已被取消`)
      }
      if (headerTimer.signal.aborted) {
        throw new ProviderError(
          ErrorCodes.ProviderUpstreamError,
          `连接 '${this.profile.id}' 超过 ${timeoutMs}ms 未响应：${url}`,
        )
      }
      throw new ProviderError(
        ErrorCodes.ProviderUpstreamError,
        `连接 '${this.profile.id}' 失败：${errMessage(err)}`,
        errMessage(err),
      )
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      const snippet = await safeSnippet(res)
      const unauthorized = res.status === 401 || res.status === 403
      throw new ProviderError(
        unauthorized ? ErrorCodes.ProviderUnauthorized : ErrorCodes.ProviderUpstreamError,
        `上游返回 ${res.status}${res.statusText === '' ? '' : ` ${res.statusText}`}（方案 '${this.profile.id}'）`,
        snippet,
      )
    }
    return res
  }

  /**
   * 鉴权头。`keyRef` 留空串 = 该上游不需要鉴权（本地 vLLM / Ollama），
   * 非空但环境变量没设置 = 配置缺失，明确报错而不是发一个必然 401 的请求。
   */
  private authHeaders(): Record<string, string> {
    const configured = { ...(this.profile.headers ?? {}) }
    if (this.key !== null && this.key !== '') {
      // 部分中转把凭证放自定义头；已显式配了 Authorization 就不覆盖
      if (!hasHeader(configured, 'authorization')) configured.Authorization = `Bearer ${this.key}`
      return configured
    }
    if (this.profile.keyRef !== '') {
      throw new ProviderError(
        ErrorCodes.ProviderNotConfigured,
        `方案 '${this.profile.id}' 的密钥环境变量 ${this.profile.keyRef} 未设置`,
      )
    }
    return configured
  }
}
