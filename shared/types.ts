/**
 * 统一数据模型类型（技术方案 §6）
 * 前后端共享的唯一权威定义；实现细节（Dexie / Drizzle schema）各自映射。
 */

/** 统一基座（§6.1）：所有可收藏、可统计、可关联实体继承它 */
export interface BaseObject {
  id: string
  type: string
  createdAt: number
  updatedAt: number
  sourceId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

export type BubbleMode = 'chat' | 'native'

/** 聊天会话（本地 Dexie） */
export interface ChatSession extends BaseObject {
  type: 'chat-session'
  title: string
  pinnedAt: number | null
  remark: string | null
  background: string | null
  bubbleMode: BubbleMode
  archivedAt: number | null
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error' | 'aborted'

/** 可扩展消息块（§6.2）：渲染器按 kind 分发，Phase 1 只用 text */
export type MessageBlockKind =
  | 'text'
  | 'html'
  | 'image'
  | 'audio'
  | 'file'
  | 'tool-result'
  | 'widget'
  | 'tab-group'

export interface MessageBlock {
  kind: MessageBlockKind
  payload: unknown
  order: number
}

/** 消息版本 / 多候选（§6.3 提前量：Phase 1 建表即预留，一次建表同时满足编辑与重roll） */
export interface MessageCandidate {
  content: string
  origin: 'edit' | 'reroll'
  selected: boolean
}

/** 聊天消息（本地 Dexie） */
export interface ChatMessage extends BaseObject {
  type: 'chat-message'
  sessionId: string
  role: MessageRole
  status: MessageStatus
  replyToId: string | null
  blocks: MessageBlock[]
  versionOf: string | null
  candidates: MessageCandidate[]
  recalledAt: number | null
  editedAt: number | null
}

/* ---------- LLM 方案（§6.2 ApiProfile / §7.1 多方案管理） ---------- */

/** 适配器类型。§7.1：以 OpenAI Chat Completions 兼容协议为最小公分母，后续可加原生适配器 */
export type LlmProviderKind = 'openai-compat'

/** 同一方案下不同服务各用哪个模型（§6.2 modelMap） */
export interface ApiProfileModelMap {
  chat?: string
  tts?: string
  vision?: string
  embedding?: string
}

/**
 * LLM 方案（§6.2）：一份「baseUrl + 鉴权 + 模型映射」的组合。
 * 换模型 / 换服务商只改这里，业务代码不动（§7.1）。
 *
 * ⚠️ 本结构**不存任何密钥**：`keyRef` 只是「持有该密钥的环境变量名」，
 * 真值只活在服务端进程环境里（铁律 3：API Key 不出服务端）。
 */
export interface ApiProfile {
  id: string
  name: string
  provider: LlmProviderKind
  /** 不带结尾斜杠；兼容层自动拼 `/chat/completions`、`/models` */
  baseUrl: string
  /** 环境变量名，如 `'DEEPSEEK_API_KEY'`；留空串表示该上游不需要鉴权 */
  keyRef: string
  modelMap: ApiProfileModelMap
  /** 附加请求头（部分中转需要）。值可能含密钥，故**不下发前端** */
  headers?: Record<string, string>
  isActive: boolean
}

/** 下发给前端的方案视图（脱敏）：只暴露 header 的**名字**，不暴露值 */
export interface ApiProfilePublic {
  id: string
  name: string
  provider: LlmProviderKind
  baseUrl: string
  keyRef: string
  /** `keyRef` 指向的环境变量在服务端是否已就绪 */
  hasKey: boolean
  modelMap: ApiProfileModelMap
  headerNames: string[]
  isActive: boolean
}

/** 方案连通性探测结果（`POST /api/providers/:id/test`；探测失败也是「结果」，不抛错） */
export interface LlmProbeResult {
  profileId: string
  ok: boolean
  latencyMs: number
  modelCount: number
  /** 只带前几个模型名，够 UI 展示即可 */
  sampleModels: string[]
  /** ok=false 时的可读原因 */
  error: string | null
}

/* ---------- 服务端实体（SQLite，Phase 0 仅诊断/健康相关） ---------- */

export type McpServerState = 'disconnected' | 'connecting' | 'handshake' | 'ready' | 'error'

/** MCP Gateway 每个 server 的聚合健康状态（§7.2② → GET /api/health/mcp） */
export interface McpServerHealth {
  serverId: string
  state: McpServerState
  toolCount: number
  lastError: string | null
  lastCheckedAt: number | null
}

export interface ServerHealth {
  ok: boolean
  service: string
  time: string
}

export interface McpHealth {
  ok: boolean
  servers: McpServerHealth[]
}
