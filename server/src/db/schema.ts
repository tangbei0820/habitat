/**
 * Drizzle schema —— 服务端 SQLite（技术方案 §6.2）
 * 覆盖基础诊断、API/用量、Phase 3B 主动行为、钱包账本，以及 Phase 6.5 起从 Dexie 迁入的共同生活数据。
 */
import type {
  ApiProfileModelMap,
  ProviderCapability,
  ProviderSchemeBindings,
  AutomationPolicy,
  ContentAuthor,
  MomentChannel,
  DiaryVisibility,
  RuntimeEventDecider,
  RuntimeEventKind,
  RuntimeEventStatus,
  CallDirection,
  CallStatus,
  CallSpeaker,
} from '@shared/types'
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

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

/** 四个能力当前各自使用哪份连接与模型。 */
export const providerCapabilityBinding = sqliteTable('provider_capability_binding', {
  capability: text('capability').$type<ProviderCapability>().primaryKey(),
  profileId: text('profile_id').notNull(),
  model: text('model').notNull(),
  secondaryModel: text('secondary_model'),
  lastTestedAt: integer('last_tested_at'),
  lastLatencyMs: integer('last_latency_ms'),
  lastError: text('last_error'),
  updatedAt: integer('updated_at').notNull(),
})

/** 四通道绑定的命名快照。密钥仍只存在 api_secret。 */
export const providerScheme = sqliteTable('provider_scheme', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  bindings: text('bindings_json', { mode: 'json' }).$type<ProviderSchemeBindings>().notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** MCP Manager 连接配置；token 单独放在 mcp_server_secret，列表接口天然不会带出凭据。 */
export const mcpServer = sqliteTable('mcp_server', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  allowAutonomous: integer('allow_autonomous', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const mcpServerSecret = sqliteTable('mcp_server_secret', {
  serverId: text('server_id').primaryKey(),
  token: text('token').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type ApiProfileRow = typeof apiProfile.$inferSelect
export type NewApiProfile = typeof apiProfile.$inferInsert
export type ApiSecretRow = typeof apiSecret.$inferSelect
export type ProviderCapabilityBindingRow = typeof providerCapabilityBinding.$inferSelect
export type ProviderSchemeRow = typeof providerScheme.$inferSelect
export type McpServerRow = typeof mcpServer.$inferSelect
export type McpServerSecretRow = typeof mcpServerSecret.$inferSelect

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

/** 应用内电话事实源：状态与逐句文字记录绑定原聊天会话，不另起 AI 上下文。 */
export const callSession = sqliteTable('call_session', {
  id: text('id').primaryKey(),
  chatSessionId: text('chat_session_id').notNull(),
  direction: text('direction', { enum: ['user', 'companion'] }).$type<CallDirection>().notNull(),
  status: text('status', { enum: ['ringing', 'active', 'ended', 'rejected', 'missed', 'cancelled'] }).$type<CallStatus>().notNull(),
  createdAt: integer('created_at').notNull(),
  answeredAt: integer('answered_at'),
  endedAt: integer('ended_at'),
  durationMs: integer('duration_ms').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})
export type CallSessionRow = typeof callSession.$inferSelect

export const callTurn = sqliteTable('call_turn', {
  id: text('id').primaryKey(),
  callId: text('call_id').notNull(),
  sequence: integer('sequence').notNull(),
  speaker: text('speaker', { enum: ['user', 'companion'] }).$type<CallSpeaker>().notNull(),
  text: text('text').notNull(),
  at: integer('at').notNull(),
}, (table) => ({
  callSequence: unique('call_turn_call_sequence').on(table.callId, table.sequence),
}))
export type CallTurnRow = typeof callTurn.$inferSelect

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

/**
 * Diary（SPEC §3.4 / §6.2）。**服务端是权威源** —— 2026-09-24 从 `web` 的 Dexie 迁入。
 *
 * 为什么必须搬：AI 跑在服务端，而「AI 写日记」「用户请求查看某篇日记」「AI 决定放不放」
 * 这三件事都发生在服务端。日记留在浏览器里，AI 就只能对着假数据演戏（SPEC §6.3 明确禁止）。
 *
 * `author` 同时是权限位（见 shared/types.ts 的 `ContentAuthor`）：
 * - `user`      —— 用户自己写的，可自由读写删
 * - `companion` —— AI 私有，用户只能看封面；正文仅在 `visibility='open'` 时才随接口下发
 *
 * ⚠️ 正文过滤**在数据访问层做**（`db/diary.ts`），不是在路由层拼参数 ——
 * 路由以后可能多几条，漏一处就是把 AI 的私密日记漏给用户。
 */
export const diary = sqliteTable('diary', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  /** 本地日期 `YYYY-MM-DD`（与 `CountdownDay.targetDate` 同惯例，避免纯日期被时区推一天） */
  entryDate: text('entry_date').notNull(),
  author: text('author', { enum: ['companion', 'user'] }).$type<ContentAuthor>().notNull(),
  visibility: text('visibility', { enum: ['private', 'open', 'locked'] }).$type<DiaryVisibility>().notNull(),
  /** `fragment-${index}` -> `open | locked`；缺省继承整篇 visibility。 */
  fragmentVisibilityJson: text('fragment_visibility_json', { mode: 'json' }).$type<Record<string, 'open' | 'locked'>>().notNull().default({}),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type DiaryRow = typeof diary.$inferSelect
export type NewDiary = typeof diary.$inferInsert

/**
 * Moment（SPEC §3.3 留言板）。服务端权威源，同 Diary 的理由。
 *
 * `author` 不是为迁移新加的字段 —— 前端 Dexie 时代就预留了 `companion`，
 * 只是一直没人写（`createMoment` 硬编码 `'user'`）。现在 AI 主动行为能真正写进来了。
 */
export const moment = sqliteTable('moment', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  author: text('author', { enum: ['user', 'companion'] }).$type<ContentAuthor>().notNull(),
  channel: text('channel', { enum: ['board', 'feed'] }).$type<MomentChannel>().notNull().default('board'),
  groupId: text('group_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const momentGroup = sqliteTable('moment_group', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type MomentRow = typeof moment.$inferSelect
export type NewMoment = typeof moment.$inferInsert

/** 朋友圈回应（P1）。评论本身也是可追溯的共同生活内容，不把回复拼进 moment.content。 */
export const momentComment = sqliteTable('moment_comment', {
  id: text('id').primaryKey(),
  momentId: text('moment_id').notNull(),
  parentId: text('parent_id'),
  content: text('content').notNull(),
  author: text('author', { enum: ['user', 'companion'] }).$type<ContentAuthor>().notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type MomentCommentRow = typeof momentComment.$inferSelect
export type NewMomentComment = typeof momentComment.$inferInsert

export type MomentGroupRow = typeof momentGroup.$inferSelect

/**
 * Event Inbox · 事件收件箱（Phase 6.5 P1）。
 *
 * 为什么需要它：**AI 与北北之间有两件必须异步决定的事** ——
 *   1. AI 想写日记 / 留言 → 需要北北点确认（`confirm` 级能力）
 *   2. 北北想看某篇私密日记 → 需要 AI 决定放不放
 *
 * 两件事都不能在「模型正在流式回复」的那一瞬间等答案：SSE 是单向的，
 * 挂住等用户点按钮会超时、刷新即丢。所以本层把**决定**与**执行**拆开：
 * 模型发起 → 挂成一条事件（不产生副作用）→ 决策方决定 → 执行 → 结果回灌模型。
 *
 * `decider` 是本表的关键：**它说清了这条事件究竟等着谁**。注入模型上下文时
 * 只取 `decider='companion'` 的待决事件；前端确认卡只认 `decider='user'` 的。
 *
 * ⚠️ 与 `notification` 表的分工：那张是**单向广播**（AI 主动唤醒你，只读、只能标已读）；
 * 这张是**双向待决**（有状态、有决策、有执行结果）。别把两者合并 ——
 * 合并后「已读」与「已决定」会变成同一个字段，而它们根本不是一回事。
 */
export const runtimeEvent = sqliteTable('runtime_event', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['tool_confirm', 'diary_access_request'] })
    .$type<RuntimeEventKind>()
    .notNull(),
  decider: text('decider', { enum: ['companion', 'user'] }).$type<RuntimeEventDecider>().notNull(),
  status: text('status', { enum: ['pending', 'approved', 'denied', 'failed', 'expired', 'revoked'] })
    .$type<RuntimeEventStatus>()
    .notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  /** 执行器要用的数据（工具名 + 参数 / 日记 id）。**不是给人看的。** */
  payloadJson: text('payload_json').notNull(),
  /** 已决事件的执行结果（给模型读的一段话）；未执行时为 null */
  result: text('result'),
  /** 结果是否已注入过模型上下文（只注入一次，见 shared/types.ts 的说明） */
  resultDeliveredAt: integer('result_delivered_at'),
  capabilityId: text('capability_id'),
  /** 事件指向的业务对象（日记 id 等）。前端靠它判断「这篇是否已请求过」—— 见 shared/types.ts */
  targetId: text('target_id'),
  /** 日记片段级请求的具体片段；整篇请求或其它事件为 null。 */
  targetFragmentId: text('target_fragment_id'),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
})

export type RuntimeEventRow = typeof runtimeEvent.$inferSelect
export type NewRuntimeEventRow = typeof runtimeEvent.$inferInsert

/**
 * 世界书条目（Phase 7A · SPEC §9.4.2）。服务端权威：Runtime 在这里拼上下文。
 * `keys` 存 JSON 字符串数组 —— SQLite 没有数组列，而条目数很小（个位数到几十），
 * 不值得为它上关联表。
 */
export const worldbookEntry = sqliteTable('worldbook_entry', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  keys: text('keys').notNull(),
  mode: text('mode', { enum: ['always', 'keyword'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type WorldbookEntryRow = typeof worldbookEntry.$inferSelect
export type NewWorldbookEntryRow = typeof worldbookEntry.$inferInsert

/**
 * Eventide 历史快照（Phase 7A · SPEC §9.4 之外 §9.2.4 扩展）：状态页趋势与最近变化的数据源。
 * 每次快照落库时顺带追加一行；`settled_at` 唯一 —— 同一时刻重复推进只留最新一份。
 * 保留上限 2000 行（写入时裁剪，见 db/state.ts）。
 */
export const eventideHistory = sqliteTable('eventide_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  stateJson: text('state_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  settledAt: integer('settled_at').notNull(),
})

export type EventideHistoryRow = typeof eventideHistory.$inferSelect
export type NewEventideHistoryRow = typeof eventideHistory.$inferInsert

/**
 * 自主行动审计（Phase 7B · 决策契约）：一次后台运行（wake/solitude）的 outcome 拆到行动级。
 * `(run_id, idx)` 唯一 —— 行动执行器靠它做幂等：同一运行重放时，已存在的行动直接跳过。
 */
export const automationAction = sqliteTable('automation_action', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  idx: integer('idx').notNull(),
  type: text('type', { enum: ['message', 'messageboard', 'diary', 'surf'] }).notNull(),
  status: text('status', { enum: ['completed', 'failed', 'skipped'] }).notNull(),
  reason: text('reason'),
  refId: text('ref_id'),
  at: integer('at').notNull(),
}, (table) => ({
  uniquePerRun: unique('uq_automation_action_run_idx').on(table.runId, table.idx),
}))

export type AutomationActionRow = typeof automationAction.$inferSelect
export type NewAutomationActionRow = typeof automationAction.$inferInsert
