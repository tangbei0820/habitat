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
  /** 置顶是**时间戳而非布尔**（§6.2）：取消置顶后仍能回到原本的活跃顺序 */
  pinnedAt: number | null
  /** 所属分组；`null` = 未分组。指向已不存在的分组时按未分组处理（SPEC §2.1.3 兜底区） */
  groupId: string | null
  remark: string | null
  background: string | null
  bubbleMode: BubbleMode
  archivedAt: number | null
}

/**
 * 会话分组（SPEC §2.1.3，本地 Dexie）。
 *
 * 只是一个「分区」：**删分组不删会话** —— 组内会话的 `groupId` 会被置回 `null` 落进未分组区。
 * 折叠状态跟着数据走（不是 UI 局部状态），刷新与换设备后保持一致。
 */
export interface SessionGroup extends BaseObject {
  type: 'session-group'
  name: string
  collapsed: boolean
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

/* ---------- Home 共同生活（本地 Dexie） ---------- */

/** 留言板的一条生活痕迹；作者位预留给 Phase 3 后的小栖主动写入。 */
export interface Moment extends BaseObject {
  type: 'moment'
  content: string
  author: 'user' | 'companion'
}

export type WishlistStatus = 'open' | 'done'

export interface WishlistItem extends BaseObject {
  type: 'wishlist-item'
  title: string
  status: WishlistStatus
  completedAt: number | null
}

/** `targetDate` 固定为本地日期 `YYYY-MM-DD`，避免纯日期被时区偏移。 */
export interface CountdownDay extends BaseObject {
  type: 'countdown-day'
  title: string
  targetDate: string
}

/** 主屏 Widget 的形态（SPEC §5.2 首批两种） */
export type HomeWidgetKind = 'board' | 'countdown'

/**
 * 主屏 Widget（SPEC §1.4 / §5.2）：**只存引用，不复制被展示的数据** ——
 * 卡片内容始终从 `moments` / `countdowns` 实时读。
 *
 * 每种 `kind` 全表最多一条（由 Dexie `&kind` 唯一索引兜住）：
 * 「换一个倒数日上主屏」是**改 `refId`**，不是再加一条。
 *
 * 刻意不设 `order`：v0.1 至多两个 Widget，先后按 `createdAt` 定就够；
 * 等真做拖拽编排（§5.1）时再加，不留没有生产者的字段。
 */
export interface HomeWidget extends BaseObject {
  type: 'home-widget'
  kind: HomeWidgetKind
  /** 引用目标：留言板 Widget 不指向单条记录（恒为 `null`），倒数日 Widget 指向 `CountdownDay.id` */
  refId: string | null
}

/** 日记按本地日期归档；正文先存纯文本，避免在没有富文本沙箱前引入 HTML。 */
export interface Diary extends BaseObject {
  type: 'diary'
  title: string
  content: string
  entryDate: string
}

/**
 * 收藏用 `targetType + targetId` 统一指向一切（技术方案 §6.2）。
 * 当前 UI 只生产 external-link；其余取值给后续各模块的“收藏”按钮共用。
 */
export type BookmarkTargetType =
  | 'external-link'
  | 'chat-message'
  | 'diary'
  | 'moment'
  | 'artwork'
  | 'photo'
  | 'reading-note'
  | 'music-track'
  | 'study-record'

/**
 * 收藏分类（SPEC §3.5.4）：用户自建的**收纳**维度，**单归属**。
 *
 * ⚠️ 与 `ArtworkCategory` 不是一回事：那个是作品内建的四种类型（字面量联合，不可增删），
 * 这个是可以随时新建 / 改名 / 删除的独立实体。多维度标记交给后续的「标签」，不让分类兼任。
 */
export interface BookmarkCategory extends BaseObject {
  type: 'bookmark-category'
  name: string
}

export interface Bookmark extends BaseObject {
  type: 'bookmark'
  targetType: BookmarkTargetType
  targetId: string
  title: string
  note: string | null
  /** 所属分类；`null` = 未分类。指向已不存在的分类时按未分类处理（SPEC §3.5.4 兜底区） */
  categoryId: string | null
}

export type ArtworkCategory = 'writing' | 'visual' | 'audio' | 'other'

export interface Artwork extends BaseObject {
  type: 'artwork'
  title: string
  category: ArtworkCategory
  description: string
  externalUrl: string | null
}

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

/** 分类相册（SPEC §3.7.3）：与收藏分类同构，同样**单归属**；界面文案叫「相册」。 */
export interface PhotoCollection extends BaseObject {
  type: 'photo-collection'
  name: string
}

/** Phase 2 先以内联 data URL 保存，确保 IndexedDB 与 JSON 备份都能原样恢复。 */
export interface Photo extends BaseObject {
  type: 'photo'
  title: string
  caption: string | null
  imageDataUrl: string
  mimeType: PhotoMime
  sizeBytes: number
  takenAt: string
  /** 所属相册；`null` = 未分类。指向已不存在的相册时按未分类处理（SPEC §3.7.3 兜底区） */
  collectionId: string | null
}

export type ReadingStatus = 'want' | 'reading' | 'finished'

export interface ReadingNote extends BaseObject {
  type: 'reading-note'
  bookTitle: string
  author: string | null
  status: ReadingStatus
  note: string
}

export interface MusicTrack extends BaseObject {
  type: 'music-track'
  title: string
  artist: string | null
  note: string | null
  externalUrl: string | null
}

/** `studiedOn` 是本地日期；时长统一存分钟，避免展示层反复换算。 */
export interface StudyRecord extends BaseObject {
  type: 'study-record'
  subject: string
  note: string
  studiedOn: string
  durationMinutes: number
}

/* ---------- LLM 方案（§6.2 ApiProfile / §7.1 多方案管理） ---------- */

/** 适配器类型。§7.1：以 OpenAI Chat Completions 兼容协议为最小公分母，后续可加原生适配器 */
export type LlmProviderKind = 'openai-compat'

/** 同一方案下不同服务各用哪个模型（§6.2 modelMap） */
export interface ApiProfileModelMap {
  chat?: string
  tts?: string
  transcription?: string
  vision?: string
  image?: string
  embedding?: string
}

export interface MediaTranscriptionResult {
  text: string
  model: string
}

export interface MediaVisionResult {
  description: string
  model: string
}

export interface MediaImageResult {
  dataUrl: string
  model: string
}

export interface McpToolDescriptor {
  serverId: string
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
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
  /**
   * 是否带 `stream_options: { include_usage: true }`（缺省 = true）。
   * 绝大多数上游靠它在末包回 usage（记账用）；极少数老自建上游会因此 400，可关。
   */
  streamOptions?: boolean
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
  /** 与 ApiProfile.streamOptions 同义；不下发敏感信息，这个开关无所谓 */
  streamOptions: boolean
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
  /** 缺省 = 开；显式 false 才关（部分不支持 stream_options 的自建上游） */
  streamOptions?: boolean
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

/* ---------- Eventide 状态（服务端 SQLite + Python sidecar） ---------- */

/**
 * Eventide 的宿主持久化快照。`state` 是上游可往返的 JSON，habitat 不复制其内部字段定义；
 * `stateCard` 给模型上下文，`payload` 给未来 UI，两条消费路径互不解析对方格式。
 */
export interface BodyStateSnapshot {
  state: Record<string, unknown>
  stateCard: string | null
  payload: Record<string, unknown>
  settledAt: number
}

export interface StateProviderHealth {
  ok: boolean
  configured: boolean
  service: 'eventide'
  revision: string | null
  lastError: string | null
  lastCheckedAt: number
}

/* ---------- Phase 3B 主动行为 / 预算 / 钱包 ---------- */

export type AutomationKind = 'chat' | 'wake' | 'solitude' | 'dream' | 'settlement'

export interface AutomationPolicy {
  enabled: boolean
  wakeEnabled: boolean
  solitudeEnabled: boolean
  dreamEnabled: boolean
  timeZone: string
  quietStart: string
  quietEnd: string
  minSilenceMinutes: number
  wakeCooldownMinutes: number
  maxUnansweredWakes: number
  maxDailyProactiveRuns: number
  maxDailyApiCalls: number
  maxDailyTokens: number
  maxDailyCostCents: number | null
  solitudeStart: string
  solitudeEnd: string
  triggerWords: string[]
  dreamSeed: string | null
}

export interface AutomationRuntimeState {
  lastCounterpartAt: number | null
  lastWakeAt: number | null
  unansweredWakes: number
  lastSolitudeDayKey: string | null
  lastDreamDayKey: string | null
  updatedAt: number
}

export type AutomationRunStatus = 'reserved' | 'completed' | 'failed' | 'skipped'

export interface AutomationRunRecord {
  id: string
  kind: AutomationKind
  status: AutomationRunStatus
  reason: string | null
  usageRecordId: number | null
  dayKey: string
  at: number
  finishedAt: number | null
}

export interface BudgetDecision {
  allowed: boolean
  reason: string | null
  reservationId: string | null
}

export type NotificationKind = 'proactive' | 'system' | 'wake' | 'task' | 'api-error' | 'mcp-error'

export interface NotificationRecord {
  id: string
  kind: NotificationKind
  title: string
  body: string
  metadata: Record<string, unknown>
  readAt: number | null
  createdAt: number
}

export interface SolitudeEntry {
  id: string
  body: string
  metadata: Record<string, unknown>
  createdAt: number
}

export interface EventLogRecord {
  id: number
  eventType: string
  dayKey: string
  hourKey: string
  metrics: Record<string, unknown>
  refId: string | null
  at: number
}

export interface WalletSummary {
  balance: number
  updatedAt: number
}

export interface WalletTransactionRecord {
  id: string
  delta: number
  balanceAfter: number
  reason: string
  refType: string | null
  refId: string | null
  createdAt: number
}

/* ---------- Phase 4 Life：价格、统计、通知与运行可视化 ---------- */

export interface PriceSnapshotRecord {
  id: string
  provider: string
  model: string
  promptCentsPerMillion: number
  completionCentsPerMillion: number
  validFrom: number
  createdAt: number
}

export interface LifeDaySummary {
  dayKey: string
  eventCount: number
  failedEventCount: number
  apiCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  pricedCostCents: number
  unpricedCalls: number
}

export interface UsageBreakdown {
  key: string
  calls: number
  totalTokens: number
  pricedCostCents: number
  unpricedCalls: number
}

export interface LifeMonthSummary {
  month: string
  timeZone: string
  days: LifeDaySummary[]
  totals: Omit<LifeDaySummary, 'dayKey'>
}

export interface LifeLedgerView {
  summary: LifeMonthSummary
  byService: UsageBreakdown[]
  byModel: UsageBreakdown[]
  priceSnapshots: PriceSnapshotRecord[]
  wallet: WalletSummary
  walletTransactions: WalletTransactionRecord[]
}

export interface LifeRuntimeView {
  server: ServerHealth
  eventide: StateProviderHealth
  /** Life 只消费 UI payload，不下发 Eventide 往返 state 或隐藏状态卡。 */
  bodyState: { payload: Record<string, unknown>; settledAt: number } | null
  mcp: McpHealth
  automation: {
    policy: AutomationPolicy
    runtime: AutomationRuntimeState
    runs: AutomationRunRecord[]
  }
}

export interface PushStatus {
  supported: boolean
  configured: boolean
  publicKey: string | null
  subscriptionCount: number
  lastError: string | null
}

/* ---------- MCP 诊断日志（§7.2②「逐请求可回放」的查询侧） ---------- */

/** 'out' = Gateway→Server 请求；'in' = Server→Gateway 响应 / 通知 */
export type McpDiagnosticDirection = 'in' | 'out'

/**
 * 一条诊断记录（`mcp_diagnostic_log` 的下发视图）。
 * 表里的原始字段原样下发：这是**排障用的证据**，不该在这里做二次解释，
 * 否则「页面上看到的原因」和「库里存的原因」可能对不上。
 */
export interface McpDiagnosticEntry {
  id: number
  serverId: string
  direction: McpDiagnosticDirection
  /** 协议方法或阶段标记：initialize / tools/list / tools/call … */
  method: string
  httpStatus: number | null
  /** 是否属于握手阶段（initialize 及其响应） */
  handshake: boolean
  latencyMs: number | null
  error: string | null
  at: number
}

/**
 * 诊断查询条件 —— 全部可选，语义是「不提就不筛」。
 * `handshake` 用三态表达：`undefined` = 全部，`true` = 只看握手，`false` = 只看工具调用。
 */
export interface McpDiagnosticQuery {
  serverId?: string
  handshake?: boolean
  errorsOnly?: boolean
  /** 每页条数，默认 50，上限 200 */
  limit?: number
  /** 游标：只取 id 小于它的（即更早的记录） */
  before?: number
}

export interface McpDiagnosticPage {
  /** 按 id 倒序（最新在前） */
  entries: McpDiagnosticEntry[]
  /** 满足筛选条件的**总条数**（不含游标，所以翻页时不会越翻越小） */
  total: number
  /** 其中带 error 的条数 */
  errorCount: number
  /** 还有更早的记录：把最后一条的 `id` 当下一轮的 `before` */
  hasMore: boolean
}
