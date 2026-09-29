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

/** 模型发起的一次工具调用（增量累积完之后的形态） */
export interface LlmToolCall {
  id: string
  name: string
  /** 参数是 JSON 字符串 —— 上游协议本来就以字符串分片下发，这里不做二次解析 */
  arguments: string
}

/** 送进模型的一条消息：只保留协议真正需要的字段（业务侧的 ChatMessage 另有一套） */
export interface LlmChatMessage {
  role: LlmRole
  content: string
  name?: string
  /** role='tool' 时对应哪次调用 */
  toolCallId?: string
  /**
   * role='assistant' 且本轮发起了工具调用时**必须原样回传**。
   *
   * 少了它，紧随其后的 `role='tool'` 消息在上游看来就是「凭空出现」——
   * 多数上游会直接 400（OpenAI 协议要求 tool 消息前面必须有对应的 assistant.tool_calls）。
   */
  toolCalls?: LlmToolCall[]
}

/** 流式增量：一个 chunk 里可能同时带正文与思维链 */
export interface LlmStreamDelta {
  /** 正文增量 */
  content?: string
  /** 思维链增量（DeepSeek-R1 等以 `reasoning_content` 回传） */
  reasoning?: string
  /**
   * 工具调用增量（Phase 6.5 起由 `routes/chat.ts` 聚合后执行）。**本层只原样透传，不做聚合。**
   *
   * 是数组而不是单个：上游允许在一个 chunk 里下发改多个并行调用
   * （OpenAI 的 parallel tool calls 就是这么走的）。只取第一个会**静默丢掉**其余调用 ——
   * 模型以为调了、实际没执行，正是本 Phase 要根治的那类「自相矛盾」。
   */
  toolCalls?: Array<{
    index: number
    id?: string
    name?: string
    /** 参数是分片到达的字符串，需调用方自行拼接 */
    argumentsDelta?: string
  }>
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
  /** Habitat 会话与 Codex app-server thread 的稳定绑定键。 */
  conversationId?: string
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
  /** 写入时供 Runtime 判断是新写入还是重复去重；读 / 搜索不设置。 */
  status?: 'written' | 'duplicate'
  /** Habitat 侧审计记录 id；只用于可追溯卡片与日志。 */
  auditId?: string
}

export interface MemorySearchOptions {
  limit?: number
}

export type MemoryWriteMode = 'new' | 'correction'

/**
 * 记忆写入来源。它是审计 / 回链信息，不是给模型自由编造的 Nocturne 字段；
 * Runtime 会在调用入口补上当前会话与工具调用 id，后台能力则显式声明自己的来源。
 */
export interface MemoryWriteSource {
  kind: 'chat' | 'call' | 'surf' | 'wake' | 'solitude' | 'manual'
  sessionId?: string
  toolCallId?: string
  label?: string
}

/**
 * 写记忆的入参（实例工具：`hold`，2026-09-26 接入）。
 *
 * 只暴露四项有普适产品语义的参数；实例特有的 `pinned` / `protected`（importance 锁 10、
 * 不参与合并）、`drive` / `chord`（Nocturne 九维驱动 / 和弦设计）**不暴露** ——
 * 那些是记忆实例自己的产品设计，模型乱填会锁死重要度分。等真有产品需要再说。
 */
export interface MemoryWriteInput {
  /** 记忆正文。Nocturne 会按原样留下，不走脱水器。 */
  content: string
  /** 记忆种类；省略由实例按默认处理（`memory`）。 */
  kind?: 'memory' | 'feel' | 'writing' | 'unresolved' | 'window' | 'letter'
  /** 可选标题；不填实例就不会自动起名。 */
  name?: string
  /** 标签（实例侧是单个字符串，按逗号分隔的约定传）。 */
  tags?: string
  /** `correction` 仍是 hold 的追加语义，不假装实例支持原地编辑 / 删除。 */
  mode?: MemoryWriteMode
  /** 供本地审计与 Nocturne tags 回链的来源信息。 */
  source?: MemoryWriteSource
  /** 可读的旧记忆线索；实例无 URI 时作为“修正哪一类记忆”的审计说明。 */
  correctionOf?: string
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
 * 写入（实例的 `hold`）已于 Phase 7C 记忆沉淀批接入（2026-09-26）——只加一个
 * `write()` 方法，入参按 `hold` 的产品语义裁剪（见 `MemoryWriteInput`）；
 * 「更新 / 删除」这两套语义实例本来就没有，仍然不存在。
 */
export interface MemoryProvider {
  /** 新窗 / Compact 后读取记忆全文（实例工具：`breath`，无参数）。 */
  recall(): Promise<MemoryTextResult>
  /** 按关键词搜索记忆（实例工具：`trace`，入参 `query` + `limit`）。 */
  search(query: string, options?: MemorySearchOptions): Promise<MemoryTextResult>
  /**
   * 写入长期记忆（实例工具：`hold`，Phase 7C 记忆沉淀接入）。
   * ⚠️ 写入不是无副作用的 —— Core-3 的聊天 Runtime 由小栖自主决定并经过来源 / 去重审计，
   * 后台沉淀（Surf 升格）受自动化策略与行动审计约束。适配层只管 MCP 通道。
   */
  write(input: MemoryWriteInput): Promise<MemoryTextResult>
  /**
   * 工具面自检：实例是否真的提供上面的工具。只做 `tools/list`，不调用任何工具。
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

export interface TTSStreamingProvider {
  streamSynthesize(text: string, voice?: string): Promise<{
    stream: AsyncIterable<Uint8Array>
    mimeType: string
    model: string
  }>
}

export interface VoiceCatalogProvider {
  listVoices(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<import('./types').ElevenLabsVoiceOption[]>
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
