/**
 * Drizzle schema —— 服务端 SQLite（技术方案 §6.2）
 * Phase 0 仅 MCP 诊断表；账本等表随 Phase 2 增补。
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
