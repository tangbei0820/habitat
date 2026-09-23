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

/**
 * 可扩展消息块（§6.2）：渲染器**按 kind 分发**。
 *
 * v1 里 `payload` 是 `unknown`、`kind` 是枚举串，渲染器只能靠 `as` 断言取字段。
 * 现在补上每种块的载荷契约并改成**可辨识联合**：switch 一下 payload 就自动收窄，
 * 少写一层运行时校验；日后新增块类型时先在这里加一条，渲染器会因穷尽检查报错提醒补分支。
 *
 * 载荷设计原则：**只放「怎么显示」，不放「这是什么」** —— url / 文案 / 尺寸足矣；
 * 语义（这是相册里的哪张、这是哪次工具调用）留在 `ChatMessage.metadata` 或对应实体上。
 */

export interface TextBlock {
  kind: 'text'
  payload: { text: string }
  order: number
}

/**
 * 富文本 / 小部件。
 * ⚠️ 内容可能来自 LLM，**不可直接 `dangerouslySetInnerHTML`**（详见 `docs/TASKS.md`：
 * 渲染前需经沙箱化，Phase 5 接入时再落地）。
 */
export interface HtmlBlock {
  kind: 'html'
  payload: { html: string }
  order: number
}

export interface ImageBlock {
  kind: 'image'
  payload: { url: string; alt?: string; width?: number; height?: number }
  order: number
}

export interface AudioBlock {
  kind: 'audio'
  payload: { url: string; durationMs?: number; transcript?: string }
  order: number
}

export interface FileBlock {
  kind: 'file'
  payload: { url: string; name: string; mime?: string; size?: number }
  order: number
}

/** 工具调用结果（Phase 3 起由 MCP Gateway 产出） */
export interface ToolResultBlock {
  kind: 'tool-result'
  payload: { toolName: string; ok: boolean; summary?: string; result?: unknown }
  order: number
}

export interface WidgetBlock {
  kind: 'widget'
  payload: { title?: string; source?: string }
  order: number
}

/**
 * 能塞进 tab 里的**叶子块**集合。
 * ⚠️ 刻意排除 `tab-group` 自身：块里再套块组会形成递归类型，而 Dexie 的键路径推导
 * （`KeyPaths`，见 `web/src/db/db.ts` 的 `Table<ChatMessage>`）展开递归类型会直接报 TS2615。
 * 真要支持任意嵌套，得连同存储层一起重新设计（Phase 5 再评估）。
 */
export type LeafMessageBlock =
  | TextBlock
  | HtmlBlock
  | ImageBlock
  | AudioBlock
  | FileBlock
  | ToolResultBlock
  | WidgetBlock

export interface TabGroupBlock {
  kind: 'tab-group'
  payload: { tabs: Array<{ label: string; blocks: LeafMessageBlock[] }> }
  order: number
}

export type MessageBlock =
  | TextBlock
  | HtmlBlock
  | ImageBlock
  | AudioBlock
  | FileBlock
  | ToolResultBlock
  | WidgetBlock
  | TabGroupBlock

export type MessageBlockKind = MessageBlock['kind']

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

/**
 * 凭据就绪情况（脱敏视图用）。
 *
 * 为什么单列它而不只看 `hasKey`：`keyRef` 为空串表示「该上游不需要鉴权」（本地 vLLM / Ollama），
 * 这种方案 `hasKey` 也恒为 true，于是「不需要密钥」与「密钥已配好」在 UI 上无法区分，文案容易写错。
 */
export type ApiKeySource =
  /** 密钥存在服务端（用户在此页填的），可直接用 */
  | 'stored'
  /** 密钥来自 `keyRef` 指向的环境变量，可直接用 */
  | 'env'
  /** 声明了 keyRef 但环境变量没设 —— 不可用，要提示用户去填 */
  | 'missing'
  /** `keyRef` 为空串：该上游不需要鉴权，直接可用 */
  | 'not-required'

/** 下发给前端的方案视图（脱敏）：只暴露 header 的**名字**，不暴露值 */
export interface ApiProfilePublic {
  id: string
  name: string
  provider: LlmProviderKind
  baseUrl: string
  keyRef: string
  /** 凭据是否已就绪、可直接发起调用（`keySource !== 'missing'`） */
  hasKey: boolean
  /** 凭据来自哪里 —— UI 文案据此区分「已保存」/「来自环境变量」/「缺密钥」/「无需密钥」 */
  keySource: ApiKeySource
  modelMap: ApiProfileModelMap
  headerNames: string[]
  isActive: boolean
}

/**
 * 新建方案的入参。
 * ⚠️ **密钥不在这里** —— 配置与凭据分两个端点（`PUT /api/providers/:id/secret`）。
 * 好处：改 baseUrl 不会误清密钥，密钥也永远不会被任何 GET 回读。
 */
export interface ApiProfileCreateInput {
  name: string
  baseUrl: string
  modelMap: ApiProfileModelMap
  /** 留空表示该上游不需要鉴权 */
  keyRef?: string
  /** 附加请求头。其值可能含凭证，故只在写入时单向传递，不回读 */
  headers?: Record<string, string>
  isActive?: boolean
}

/** 更新方案的入参：全字段可选，只改送来的那些 */
export type ApiProfileUpdateInput = Partial<ApiProfileCreateInput>

/** 写入密钥的请求体（只进不出，任何接口都不会把它读回来） */
export interface ApiProfileSecretInput {
  secret: string
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
