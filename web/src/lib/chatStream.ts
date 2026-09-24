/**
 * 聊天流客户端（§7.2① 前端侧）
 *
 * 为什么不用 `EventSource`：它只支持 GET，而聊天请求要带历史与参数，必须是 POST。
 * 所以这里用 `fetch` + `ReadableStream` 自己解析 SSE —— 协议本身很简单（空行分帧、字段行取值）。
 */
import { ErrorCodes, type ApiError } from '@shared/errors'
import type {
  ChatDeltaPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatStreamRequest,
  ChatUsagePayload,
} from '@shared/events'
import { ApiRequestError, assertOnline } from './api'

export interface ChatStreamHandlers {
  onDelta?: (delta: ChatDeltaPayload) => void
  onUsage?: (usage: ChatUsagePayload) => void
  onDone?: (done: ChatDonePayload) => void
  /**
   * 流内错误：此时 HTTP 200 已经建立（服务端写完响应头才发现的上游故障走这里）。
   * 传输层错误（连不上、非 2xx）从 `streamChat` 抛出，不走这里。
   */
  onError?: (error: ChatErrorPayload) => void
}

/** 解析一帧（`event:` / `data:` 行）；注释行（以 `:` 开头，服务端的心跳）直接跳过 */
function dispatchFrame(raw: string, handlers: ChatStreamHandlers): void {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }

  if (dataLines.length === 0) return
  let payload: unknown
  try {
    payload = JSON.parse(dataLines.join('\n'))
  } catch {
    return // 无法解析的帧跳过，不打断整段流
  }

  switch (event) {
    case 'chat-delta':
      handlers.onDelta?.(payload as ChatDeltaPayload)
      break
    case 'chat-usage':
      handlers.onUsage?.(payload as ChatUsagePayload)
      break
    case 'chat-done':
      handlers.onDone?.(payload as ChatDonePayload)
      break
    case 'chat-error':
      handlers.onError?.(payload as ChatErrorPayload)
      break
    default:
      break
  }
}

/** 切出完整帧，返回未收尾的残余。（分隔符用空行；兼容 `\r\n`，反代有时会改写） */
function drainFrames(buffer: string, handlers: ChatStreamHandlers, flush: boolean): string {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  for (const frame of parts) dispatchFrame(frame, handlers)
  if (flush && rest.trim() !== '') dispatchFrame(rest, handlers)
  return flush ? '' : rest
}

/**
 * 发起一轮对话并消费流。
 * - 正常结束 / 流内错误 / 被中止：**函数正常返回**（结果都通过 handlers 给出）
 * - 传输层失败（连不上、HTTP 非 2xx）：抛出 `ApiRequestError`
 */
export async function streamChat(
  payload: ChatStreamRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  assertOnline()
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    ...(signal === undefined ? {} : { signal }),
  })

  if (!res.ok) {
    // 服务端在写响应头之前发现的错误（参数非法、方案不存在）走这里，是结构化的
    try {
      const body = (await res.json()) as Partial<ApiError>
      if (body.error) {
        throw new ApiRequestError(body.error.code, body.error.message, body.error.detail)
      }
    } catch (err) {
      if (err instanceof ApiRequestError) throw err
    }
    throw new ApiRequestError(ErrorCodes.UpstreamError, `请求失败：HTTP ${res.status}`)
  }
  if (res.body === null) {
    throw new ApiRequestError(ErrorCodes.UpstreamError, '响应没有流式主体')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = drainFrames(buffer, handlers, false)
    }
    buffer += decoder.decode()
    drainFrames(buffer, handlers, true)
  } finally {
    reader.releaseLock()
  }
}
