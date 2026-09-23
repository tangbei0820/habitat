/**
 * SSE 事件协议（shared/ 唯一权威）
 * Phase 0 定义通道与信封；Phase 1 在此之上落地聊天流（§7.2① 的最小版）。
 */
import type { ErrorCode } from './errors'
import type { LlmChatMessage, LlmUsage } from './providers'

export type SseEventType =
  | 'health'
  | 'chat-delta'
  | 'chat-usage'
  | 'chat-done'
  | 'chat-error'
  | 'thought'
  | 'tool-call'

/** SSE 事件信封：event 字段为 SseEventType，data 为对应载荷 JSON */
export interface SseEnvelope<T = unknown> {
  event: SseEventType
  data: T
  at: number
}

/* ---------- 聊天流（§7.2①：服务端可在不改变请求形态的前提下追加隐藏上下文） ---------- */

/**
 * `POST /api/chat` 请求体。
 *
 * ⚠️ 按 §6.2，ChatMessage 归属**本地**（前端 Dexie），服务端不落聊天记录；
 * 因此历史每轮都由前端组装后送来。Eventide 状态卡已由服务端插入；世界书 / 记忆召回后续
 * 也从同一组装入口加入，本请求形态不变。
 */
export interface ChatStreamRequest {
  /** 不传则用注册表里的当前启用方案 */
  profileId?: string
  /** 不传则用方案的 modelMap.chat */
  model?: string
  messages: LlmChatMessage[]
  temperature?: number
  maxTokens?: number
}

/** `chat-delta`：正文与思维链增量，可能只带其一 */
export interface ChatDeltaPayload {
  content?: string
  reasoning?: string
}

/** `chat-usage`：上游末包用量（在 `chat-done` 之前到达） */
export interface ChatUsagePayload extends LlmUsage {
  profileId: string
  model: string
}

/**
 * `chat-done`：本轮正常收口。
 * `usageRecordId` 为 null 表示用量未成功落表（上游没回 usage 时仍会以 0 落一条并留痕）。
 */
export interface ChatDonePayload {
  finishReason: string | null
  usage: ChatUsagePayload
  usageRecordId: number | null
}

/**
 * `chat-error`：本轮失败。
 * ⚠️ 此时 HTTP 200 与 SSE 响应头**已经发出**（流已开，无法再改状态码），
 * 所以错误以事件形式回传；服务端在写响应头之前能发现的错误（参数非法、方案不存在）
 * 仍走正常的 JSON 错误体 + 4xx/5xx。
 */
export interface ChatErrorPayload {
  code: ErrorCode
  message: string
}
