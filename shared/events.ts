/**
 * SSE 事件协议（shared/ 唯一权威）
 * Phase 0 定义通道与信封；Phase 1 在此之上落地聊天流（§7.2① 的最小版）。
 */
import type { ErrorCode } from './errors'
import type { LlmChatMessage, LlmUsage } from './providers'
import type { MusicTrack } from './types'

/** 本轮聊天可供 AI 选择的本地表情元数据；图片正文留在浏览器，避免进模型上下文。 */
export interface ChatStickerCatalogItem {
  id: string
  name: string
  category: string | null
  tags: readonly string[]
}

/** 本轮聊天可供小栖选择的一起听曲目元数据；不上传音频正文。 */
export type ChatListeningCatalogItem = Pick<MusicTrack, 'id' | 'title' | 'artist' | 'externalUrl'>

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
  /** 当前会话的本地 id；仅用于把 AI 发起的来电绑定到原聊天，不由服务端保存聊天正文。 */
  sessionId?: string
  /** 不传则用注册表里的当前启用方案 */
  profileId?: string
  /** 不传则用方案的 modelMap.chat */
  model?: string
  messages: LlmChatMessage[]
  temperature?: number
  maxTokens?: number
  /** 用户从聊天“更多功能”明确发起的联网检索；缺省时 AI 看不到 Web 工具。 */
  webSearch?: { query: string }
  /** 当前浏览器本地图库的轻量目录；服务端只用它做本轮工具校验，不持久化。 */
  stickerCatalog?: ChatStickerCatalogItem[]
  listeningCatalog?: ChatListeningCatalogItem[]
}

/** 上下文压缩的非流式请求：原消息只在本次调用中用于生成摘要，服务端不落聊天正文。 */
export interface ChatContextCompactRequest {
  profileId?: string
  model?: string
  messages: LlmChatMessage[]
}

export interface ChatContextCompactResponse {
  summary: string
  profileId: string
  model: string
  usageRecordId: number
}

/** `chat-delta`：正文与供应商原生 reasoning 增量，可能只带其一 */
export interface ChatDeltaPayload {
  content?: string
  reasoning?: string
}

/** `thought`：小栖主动公开的角色内心增量，不等同于供应商原生 reasoning。 */
export interface ChatThoughtPayload {
  content: string
}

/**
 * `tool-call`：**AI 自主发起**的一次工具调用的结果（Phase 6.5，每调用一次发一帧）。
 *
 * 与 `role='tool'` 消息的分工：这帧是**即时播报**（流没结束也要让用户看到卡），
 * 消息是**落库留存**（刷新后卡片还在）。前端收到它时应同时做这两件事。
 *
 * ⚠️ 这里**只带给人看的字段**：工具原始返回值（可能巨大、可能含路径与 token）
 * 不进这帧 —— 它只进模型上下文（`role='tool'` 消息）。界面上要展开的是 `detail`，
 * 由服务端裁剪好后给出。
 */
export interface ChatToolCallPayload {
  /** 上游给的调用 id；前端只用来去重，不参与协议回传（回传由服务端在同一轮内完成） */
  id: string
  /** 内建工具名（如 `memory_search`），不是 MCP 实例的工具名 */
  name: string
  /** 归属能力（如 `memory.search`），用于卡片点进详情页 */
  capabilityId: string
  /** 面向用户的短名（如「搜索记忆」） */
  label: string
  /** 展示来源（如 `Nocturne`） */
  source: string
  /** 工具实际完成（或失败）的时间；前端落库后用于来源追溯 */
  occurredAt?: number
  ok: boolean
  /** 一句话结果，已裁剪 */
  summary: string
  /** 可折叠详情，已裁剪；失败时是给用户看的错误说明 */
  detail?: string
  /**
   * 待确认事件 id（Phase 6.5 P1）。有它就说明这次调用**没有真的执行**，
   * 而是挂成了一条待北北决策的事件 —— 前端渲染确认卡按钮、并把 id 存进消息块。
   *
   * ⚠️ 与 `ok` 的关系：挂起是**成功**的调用（`ok: true`）。模型看到 `ok: true` 才不会重试；
   * 前端看到 `eventId` 才知道该显示按钮。两个字段各管一件事，不要合并。
   */
  eventId?: string
  /** `sticker_send` 成功时返回的本地图库 id；前端据此取快照并落一条 sticker 消息。 */
  stickerId?: string
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
