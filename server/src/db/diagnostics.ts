/**
 * MCP 诊断日志仓储（§7.2②）。
 *
 * 写侧：诊断中间件的**唯一**入口 —— 握手与每次工具调用全量留痕。
 * 读侧：设置页「诊断日志」时间线的数据源，支持按 server / 阶段 / 是否有错筛选 + 游标翻页。
 * 读写都在本文件内收口，路由层只做参数校验与映射。
 */
import { and, desc, eq, isNotNull, lt, sql, type SQL } from 'drizzle-orm'
import type { McpDiagnosticEntry, McpDiagnosticPage, McpDiagnosticQuery } from '@shared/types.js'
import { db } from './index.js'
import { mcpDiagnosticLog, type NewMcpDiagnosticLog } from './schema.js'

/** 默认页大小（与路由层的上限 200 一致由路由把关） */
const DEFAULT_LIMIT = 50

/** 诊断中间件的唯一写入口：同步落一条 MCP 请求/响应记录（§7.2② 全量留痕） */
export function insertMcpDiagnostic(entry: NewMcpDiagnosticLog): void {
  db.insert(mcpDiagnosticLog).values(entry).run()
}

function buildFilters(query: McpDiagnosticQuery): SQL[] {
  const filters: SQL[] = []
  if (query.serverId !== undefined) filters.push(eq(mcpDiagnosticLog.serverId, query.serverId))
  if (query.handshake !== undefined) filters.push(eq(mcpDiagnosticLog.handshake, query.handshake))
  if (query.errorsOnly === true) filters.push(isNotNull(mcpDiagnosticLog.error))
  return filters
}

/**
 * 按条件取一页诊断记录（最新在前）。
 *
 * 两个刻意的设计：
 * - **游标（`before`）不参与计数** —— 「共 N 条」说的是「符合筛选的记录有多少」，
 *   若把游标算进去，用户每翻一页这个数字就变小，看起来像日志在被删。
 * - **多取一条判断 hasMore** —— 换来的是不必再发一次 `count(*)` 只为知道「还有没有」。
 */
export function listMcpDiagnostics(query: McpDiagnosticQuery = {}): McpDiagnosticPage {
  const filters = buildFilters(query)
  const scope = filters.length > 0 ? and(...filters) : undefined
  const paged =
    query.before === undefined ? scope : and(...filters, lt(mcpDiagnosticLog.id, query.before))

  const limit = query.limit ?? DEFAULT_LIMIT
  const rows = db
    .select()
    .from(mcpDiagnosticLog)
    .where(paged)
    .orderBy(desc(mcpDiagnosticLog.id))
    .limit(limit + 1)
    .all()

  const hasMore = rows.length > limit
  const entries: McpDiagnosticEntry[] = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
    id: row.id,
    serverId: row.serverId,
    direction: row.direction,
    method: row.method,
    httpStatus: row.httpStatus,
    handshake: row.handshake,
    latencyMs: row.latencyMs,
    error: row.error,
    at: row.at,
  }))

  const [totals] = db
    .select({
      total: sql<number>`count(*)`,
      // sum() 在没有匹配行时返回 null，交给下面 ?? 0 兜底
      errorCount: sql<number | null>`sum(case when ${mcpDiagnosticLog.error} is null then 0 else 1 end)`,
    })
    .from(mcpDiagnosticLog)
    .where(scope)
    .all()

  return {
    entries,
    total: totals?.total ?? 0,
    errorCount: totals?.errorCount ?? 0,
    hasMore,
  }
}
