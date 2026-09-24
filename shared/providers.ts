/**
 * Provider / Gateway 接口族（技术方案 §7.1，定义于 shared/）
 * 业务代码只依赖这些接口；Adapter 在服务端注册表按 ApiProfile 装配。
 * 已落地：ToolGateway（P0）、LLMProvider（P1）；其余随对应 Phase 增补。
 */

/** ToolGateway：MCP 客户端聚合的统一出口（§7.2② 诊断链路） */
export interface ToolGateway {
  listTools(serverId?: string): Promise<unknown[]>
  callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown>
  health(): Promise<import('./types').McpServerHealth[]>
  diagnostics(): Promise<void>
}

/* ---------- LLM（§7.1）：以 OpenAI Chat Completions 兼容协议为最小公分母 ---------- */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

/** 送进模型的一条消息：只保留协议真正需要的字段（业务侧的 ChatMessage 另有一套） */
export interface LlmChatMessage {
  role: LlmRole
  content: string
  name?: string
  /** role='tool' 时对应哪次调用 */
  toolCallId?: string
}

/** 流式增量：一个 chunk 里可能同时带正文与思维链 */
export interface LlmStreamDelta {
  /** 正文增量 */
  content?: string
  /** 思维链增量（DeepSeek-R1 等以 `reasoning_content` 回传） */
  reasoning?: string
  /** 工具调用增量（Phase 3 用，本层只原样透传，不做聚合） */
  toolCall?: {
    index: number
    id?: string
    name?: string
    /** 参数是分片到达的字符串，需调用方自行拼接 */
    argumentsDelta?: string
  }
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * 流式事件：Adapter 只吐这三种，上层无需关心上游协议差异。
 * 顺序保证：若干 `delta` → 可选 `usage` → 恰好一个 `done`。
 */
export type LlmStreamChunk =
  | { type: 'delta'; delta: LlmStreamDelta }
  | { type: 'usage'; usage: LlmUsage }
  | { type: 'done'; finishReason: string | null }

export interface StreamChatOptions {
  /** 不传则用方案 `modelMap.chat` */
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: unknown[]
  /** 建连 / 等响应头的超时（毫秒），默认 30s */
  timeoutMs?: number
  /** 上游「多少毫秒没吐新数据」就判定挂死并中断，默认 60s */
  idleTimeoutMs?: number
  /** 调用方取消（如客户端断开） */
  signal?: AbortSignal
}

/** LLMProvider（§7.1）：业务代码只依赖这个接口，不碰具体服务商 */
export interface LLMProvider {
  readonly profileId: string
  /** 该方案 chat 服务的默认模型（取自 `profile.modelMap.chat`） */
  readonly defaultModel: string
  streamChat(messages: LlmChatMessage[], opts?: StreamChatOptions): AsyncIterable<LlmStreamChunk>
  /** 取上游模型列表（「测试连接」与「选模型」用） */
  listModels(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string[]>
}

/* ---------- Memory（§7.1）：Nocturne 文本型记忆契约 ---------- */

export interface MemoryTextResult {
  /** Nocturne 工具返回的是给模型阅读的文本，不依赖其内部数据库 schema。 */
  text: string
}

export interface MemorySearchOptions {
  limit?: number
}

/**
 * 记忆能力面（**只读**）。
 *
 * ⚠️ 2026-09-24 对齐真实实例后收敛。原设计按「URI 图谱」假设了六个方法
 * （`read(uri)` / `create(parentUri)` / `update(oldString,newString)` / `delete(uri)` …），
 * 但自部署实例**没有 URI 概念，也没有「更新正文」「删除」这两套语义**
 * （实测工具面见 `docs/MEMORY.md`「自部署实例的工具面」）——六个方法里只有
 * 「读一堆」与「按关键词搜」有对应工具，其余全是空中楼阁。
 *
 * 所以这里**直接删掉**，不做「保留方法但调用即抛错」的假接口：假接口会让调用方
 * 以为自己能用，等真跑起来才发现不行，比没有更糟。
 *
 * 写入（实例的 `hold`）等做记忆页时一并定义 —— 它的 `kind` 决定记忆进哪个抽屉，
 * 是产品决策而非机械映射，届时若需扩接口属设计变更，别顺手加回来。
 */
export interface MemoryProvider {
  /** 新窗 / Compact 后读取记忆全文（实例工具：`breath`，无参数）。 */
  recall(): Promise<MemoryTextResult>
  /** 按关键词搜索记忆（实例工具：`trace`，入参 `query` + `limit`）。 */
  search(query: string, options?: MemorySearchOptions): Promise<MemoryTextResult>
  /**
   * 工具面自检：实例是否真的提供上面两个工具。只做 `tools/list`，不调用任何工具。
   * 返回**缺失**的工具名（空数组 = 齐了）；实例未配置或连不上时也返回空数组，
   * 那种情况的告警归健康检查管，不在这里重复吵。
   */
  verifyToolFace(): Promise<string[]>
}

export interface StateTickOptions {
  /** 用户最后一次发言时间；Eventide 用它计算等待造成的状态变化。 */
  lastCounterpartMessageAt?: Date
  /** 最近一条用户文本；只用于宿主配置的称呼 / 关键词触发，不持久化原文。 */
  counterpartText?: string
  triggerWords?: string[]
  /** 事件时间窗口使用的 IANA 时区。 */
  timeZone?: string
}

export interface StateEventResult {
  snapshot: import('./types').BodyStateSnapshot
  eventKey: string | null
  started: boolean
}

export interface StateDreamTrigger {
  prompt: string
  probability: number
  roll: number
  createdAt: number
}

export interface StateProvider {
  /** 推进并持久化状态；调用方只拿状态卡与结构化载荷，不接触 Eventide 内部对象。 */
  tick(now: Date, options?: StateTickOptions): Promise<import('./types').BodyStateSnapshot>
  /** 读取最近一次已持久化的状态，不触发时间推进。 */
  current(): import('./types').BodyStateSnapshot | null
  /** sidecar 探活；失败作为状态返回，不拖垮 habitat-server。 */
  health(): Promise<import('./types').StateProviderHealth>
  /** 根据最近互动渲染只输出 JSON 的结算 prompt。 */
  settlementPrompt(messageWindowText: string): Promise<string>
  /** 把模型结算结果交回 Eventide 归一化并原子写回最新状态。 */
  settle(result: unknown, now?: Date): Promise<import('./types').BodyStateSnapshot>
  /** 宿主触发表检查；无候选或节流时仍返回推进后的快照。 */
  checkEvents(now: Date, options?: StateTickOptions): Promise<StateEventResult>
  /** 检查梦种是否触发；未触发返回 null。 */
  checkDream(seed: string, now: Date, lastCounterpartMessageAt: Date, timeZone?: string): Promise<StateDreamTrigger | null>
  /** 梦卡生成后将标签后效安全写回。 */
  applyDreamTags(tags: string[], now?: Date): Promise<import('./types').BodyStateSnapshot>
}

export interface TTSProvider {
  synthesize(text: string, voice?: string): Promise<{ audio: Uint8Array; mimeType: string; model: string }>
}

export interface ImageProvider {
  vision(dataUrl: string, prompt?: string): Promise<import('./types').MediaVisionResult>
  generate(prompt: string): Promise<import('./types').MediaImageResult>
}

export interface TranscriptionProvider {
  transcribe(data: Uint8Array, mimeType: string, fileName?: string): Promise<import('./types').MediaTranscriptionResult>
}

export interface SearchProvider {
  search(query: string): Promise<unknown[]>
}

export interface NotificationProvider {
  push(userId: string, payload: { title: string; body: string }): Promise<void>
}
