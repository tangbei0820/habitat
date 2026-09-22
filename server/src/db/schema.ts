/**
 * Drizzle schema —— 服务端 SQLite（技术方案 §6.2）
 * Phase 0 只有 MCP 诊断表；Phase 1 补 UsageRecord。账本其余表随 Phase 4 增补。
 */
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
  /** 本地时区 YYYY-MM-DD —— 账本按天聚合必须与用户看到的「今天」一致，不能用 UTC */
  dayKey: text('day_key').notNull(),
  at: integer('at').notNull(),
})

export type UsageRecordRow = typeof usageRecord.$inferSelect
export type NewUsageRecord = typeof usageRecord.$inferInsert
