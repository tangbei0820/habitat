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

/* ---------- Memory（§7.1）：Nocturne 文本型 URI 图谱契约 ---------- */

export interface MemoryTextResult {
  /** Nocturne 工具返回的是给模型阅读的文本，不依赖其内部数据库 schema。 */
  text: string
}

export interface MemorySearchOptions {
  domain?: string
  limit?: number
}

export interface MemoryCreateInput {
  parentUri: string
  content: string
  priority: number
  disclosure: string
  title?: string
}

export interface MemoryUpdateInput {
  uri: string
  /** 精确 / `...` 块匹配；必须和 newString 同时出现。 */
  oldString?: string
  newString?: string
  /** 与替换模式互斥。Nocturne 刻意不提供全文覆盖。 */
  append?: string
  priority?: number
  disclosure?: string
}

export interface MemoryProvider {
  search(query: string, options?: MemorySearchOptions): Promise<MemoryTextResult>
  recall(): Promise<MemoryTextResult>
  read(uri: string): Promise<MemoryTextResult>
  create(input: MemoryCreateInput): Promise<MemoryTextResult>
  update(input: MemoryUpdateInput): Promise<MemoryTextResult>
  delete(uri: string): Promise<MemoryTextResult>
}

export interface StateTickOptions {
  /** 用户最后一次发言时间；Eventide 用它计算等待造成的状态变化。 */
  lastCounterpartMessageAt?: Date
}

export interface StateProvider {
  /** 推进并持久化状态；调用方只拿状态卡与结构化载荷，不接触 Eventide 内部对象。 */
  tick(now: Date, options?: StateTickOptions): Promise<import('./types').BodyStateSnapshot>
  /** 读取最近一次已持久化的状态，不触发时间推进。 */
  current(): import('./types').BodyStateSnapshot | null
  /** sidecar 探活；失败作为状态返回，不拖垮 habitat-server。 */
  health(): Promise<import('./types').StateProviderHealth>
}

export interface TTSProvider {
  synthesize(text: string, voice: string): Promise<string>
}

export interface ImageProvider {
  vision(url: string): Promise<unknown>
  generate(prompt: string): Promise<string>
}

export interface SearchProvider {
  search(query: string): Promise<unknown[]>
}

export interface NotificationProvider {
  push(userId: string, payload: { title: string; body: string }): Promise<void>
}
