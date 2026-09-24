/**
 * Drizzle schema —— 服务端 SQLite（技术方案 §6.2）
 * 覆盖基础诊断、API/用量、Phase 3B 主动行为与钱包账本表。
 */
import type { ApiProfileModelMap, AutomationPolicy } from '@shared/types'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** McpDiagnosticLog（§6.2 / §7.2②）：MCP 握手与每次请求响应全量落此表，逐请求可回放 */
export const mcpDiagnosticLog = sqliteTable('mcp_diagnostic_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serverId: text('server_id').notNull(),
  /** 'out' = Gateway→Server 请求；'in' = Server→Gateway 响应/通知 */
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  /** 协议方法或阶段标记，如 initialize / tools/list / tools/call */
  method: text('method').notNull(),
  httpStatus: integer('http_status'),
  /** 是否属于握手阶段（initialize 及其响应） */
  handshake: integer('handshake', { mode: 'boolean' }).notNull().default(false),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  at: integer('at').notNull(),
})

export type McpDiagnosticLogRow = typeof mcpDiagnosticLog.$inferSelect
export type NewMcpDiagnosticLog = typeof mcpDiagnosticLog.$inferInsert

/**
 * UsageRecord（§6.2 / §7.2①）：每次 LLM / TTS 调用**强制**落一条。
 *
 * 它是账本与统计的唯一事实源（§10.2），所以宁可记 0 也不能不记 ——
 * 上游不回 usage 时照样落一条 0 值记录，避免「这次调用是否存在」都无从判断。
 * `cost` 需配合 PriceSnapshot（价格版本化）才能算，Phase 4 账本落地时回填。
 */
export const usageRecord = sqliteTable('usage_record', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: text('profile_id').notNull(),
  /** 调用的服务类别：chat / tts / vision / embedding */
  service: text('service').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  /** 费用（分）。Phase 4 按当时的 PriceSnapshot 回填 */
  cost: integer('cost'),
  /** 计算本条费用时使用的不可变价格快照；null 表示尚未定价。 */
  priceSnapshotId: text('price_snapshot_id'),
  /** 本地时区 YYYY-MM-DD —— 账本按天聚合必须与用户看到的「今天」一致，不能用 UTC */
  dayKey: text('day_key').notNull(),
  at: integer('at').notNull(),
})

export type UsageRecordRow = typeof usageRecord.$inferSelect
export type NewUsageRecord = typeof usageRecord.$inferInsert

/** provider + model 的不可变价格版本；改价只追加，不更新历史。 */
export const priceSnapshot = sqliteTable('price_snapshot', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptCentsPerMillion: integer('prompt_cents_per_million').notNull(),
  completionCentsPerMillion: integer('completion_cents_per_million').notNull(),
  validFrom: integer('valid_from').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** 浏览器 Web Push 订阅；endpoint 唯一，密钥只用于推送协议。 */
export const pushSubscription = sqliteTable('push_subscription', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastSuccessAt: integer('last_success_at'),
  lastError: text('last_error'),
})

/**
 * ApiProfile（§6.2 / §7.1）：LLM 方案。**服务端 SQLite 是权威源**。
 *
 * §6.2 原写「本地（前端 Dexie）+ 服务端同步副本」；实现时选服务端为唯一权威，
 * 理由见 `docs/TASKS.md` 的待优化清单（只有服务端能真正发起调用，双写只会带来一致性问题）。
 * 环境变量 `HABITAT_LLM_PROFILES` 降级为**首次种子**：仅在表为空时导入一次。
 *
 * 本表**不存密钥**（拆到 apiSecret），这样「列出方案」这类读操作天然不可能泄密。
 */
export const apiProfile = sqliteTable('api_profile', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  baseUrl: text('base_url').notNull(),
  /** 环境变量名；留空串表示该上游不需要鉴权 */
  keyRef: text('key_ref').notNull().default(''),
  modelMap: text('model_map', { mode: 'json' }).$type<ApiProfileModelMap>().notNull(),
  /** 附加请求头（值可能含凭证，故不下发前端；脱敏视图只给名字） */
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  /**
   * 是否在流式请求里带 `stream_options: { include_usage: true }`（默认开）。
   * 绝大多数上游需要它才能在末包拿到 usage（账本记账用）；极少数老自建上游会因此 400，可按方案关掉。
   */
  streamOptions: integer('stream_options', { mode: 'boolean' }).notNull().default(true),
  /** 列表展示顺序；删除中间项不重排（留空隙无所谓，避免每次都全表 UPDATE） */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * ApiSecret：方案的凭据，与 apiProfile 一对一但**独立成表**。
 *
 * 拆表的两个理由：① 任何「读方案」的代码路径都不可能顺带读出密钥；
 * ② 备份 / 导出方案时可以只导出配置、不导出凭据。
 * ⚠️ 明文存储（个人自用单机），缓解措施与残留风险见 `docs/TASKS.md`。
 */
export const apiSecret = sqliteTable('api_secret', {
  profileId: text('profile_id').primaryKey(),
  secret: text('secret').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type ApiProfileRow = typeof apiProfile.$inferSelect
export type NewApiProfile = typeof apiProfile.$inferInsert
export type ApiSecretRow = typeof apiSecret.$inferSelect

/**
 * AppKv：进程级的少量键值状态（当前只有「方案种子是否已导入过」）。
 *
 * 不能用「表为空」当判据：用户删光所有方案后重启，env 种子会借「表为空」复活，
 * 违背他清空方案的意图。持久标记「导入过」一次，之后的重启都不再碰 env 种子。
 */
export const appKv = sqliteTable('app_kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export type AppKvRow = typeof appKv.$inferSelect

/**
 * Eventide 当前状态的宿主快照（技术方案 §6.2）。单人格阶段固定只有 `primary` 一行。
 * stateJson 由 Eventide 自己序列化/反序列化；habitat 只负责原样保存，避免绑定上游内部 schema。
 */
export const bodyStateSnapshot = sqliteTable('body_state_snapshot', {
  id: text('id').primaryKey(),
  stateJson: text('state_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  stateCard: text('state_card'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  settledAt: integer('settled_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type BodyStateSnapshotRow = typeof bodyStateSnapshot.$inferSelect

/** 主动行为策略。单用户阶段固定 `id='primary'`，JSON 便于策略字段继续演进。 */
export const automationPolicy = sqliteTable('automation_policy', {
  id: text('id').primaryKey(),
  policyJson: text('policy_json', { mode: 'json' }).$type<AutomationPolicy>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** 只保存调度必需的时间戳与计数，不复制聊天正文。 */
export const automationState = sqliteTable('automation_state', {
  id: text('id').primaryKey(),
  lastCounterpartAt: integer('last_counterpart_at'),
  lastWakeAt: integer('last_wake_at'),
  unansweredWakes: integer('unanswered_wakes').notNull().default(0),
  lastSolitudeDayKey: text('last_solitude_day_key'),
  lastDreamDayKey: text('last_dream_day_key'),
  updatedAt: integer('updated_at').notNull(),
})

/** BudgetGuard 的预约 / 完成记录；预约先落库，防止并发检查同时放行。 */
export const automationRun = sqliteTable('automation_run', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  reason: text('reason'),
  usageRecordId: integer('usage_record_id'),
  reservedTokens: integer('reserved_tokens').notNull().default(0),
  dayKey: text('day_key').notNull(),
  at: integer('at').notNull(),
  finishedAt: integer('finished_at'),
})

/** Phase 4 统计的唯一事实源；Phase 3B 起先记录状态与主动行为。 */
export const eventLog = sqliteTable('event_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),
  dayKey: text('day_key').notNull(),
  hourKey: text('hour_key').notNull(),
  metricsJson: text('metrics_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  refId: text('ref_id'),
  at: integer('at').notNull(),
})

/** 主动消息先落服务端收件箱；Phase 4 再负责 UI 与 Web Push。 */
export const notification = sqliteTable('notification', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadataJson: text('metadata_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  readAt: integer('read_at'),
  createdAt: integer('created_at').notNull(),
})

/** 独处内容是 AI 私有产出，不混进用户聊天或通知。 */
export const solitudeEntry = sqliteTable('solitude_entry', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  metadataJson: text('metadata_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at').notNull(),
})

/** 钱包余额是缓存值；每次变更必须与不可变流水同事务写入。 */
export const wallet = sqliteTable('wallet', {
  id: text('id').primaryKey(),
  balance: integer('balance').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

export const walletTransaction = sqliteTable('wallet_transaction', {
  id: text('id').primaryKey(),
  delta: integer('delta').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  reason: text('reason').notNull(),
  refType: text('ref_type'),
  refId: text('ref_id'),
  createdAt: integer('created_at').notNull(),
})
