/**
 * 记忆 HTTP 端点（**前端只读**）：前端只到这里；内部统一走 MemoryProvider → ToolGateway → Nocturne MCP。
 *
 * ⚠️ 2026-09-24 收敛：原先暴露了六个端点（boot / search / read / POST / PATCH / DELETE）。
 * 但自部署实例没有 URI 概念、也没有更新与删除语义（见 `shared/providers.ts` 的 MemoryProvider），
 * 那四个写端点从来不可能工作，且**前端一个都没调用过** —— 已一并移除，
 * 而不是留着返回 500 让人以为"配好就能用"。
 *
 * 剩下两个端点对应实例真实工具：`breath`（读全部）与 `trace`（关键词搜）。
 * 写入不从 HTTP 暴露，只能由 Runtime 的 `memory_write` 调用 `hold`；审计端点只读 Habitat 本地状态。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { MemoryProvider } from '@shared/providers.js'
import { RequestError } from '../lib/errors.js'
import { listMemoryWriteAudits } from '../db/memory-audit.js'

function text(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是字符串`)
  const value = raw.trim()
  if (value === '') throw new RequestError(ErrorCodes.BadRequest, `${field} 不能为空`)
  if (value.length > max) throw new RequestError(ErrorCodes.BadRequest, `${field} 最长 ${max} 字`)
  return value
}

function integer(raw: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(raw) || (raw as number) < min || (raw as number) > max) {
    throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是 ${min}–${max} 的整数`)
  }
  return raw as number
}

function singleQuery(raw: unknown, field: string): string {
  if (Array.isArray(raw)) throw new RequestError(ErrorCodes.BadRequest, `${field} 不能重复传入`)
  return text(raw, field, 500)
}

export function registerMemoryRoutes(app: FastifyInstance, memory: MemoryProvider): void {
  /** 新窗 / 会话开头读取长期记忆全文（实例工具 `breath`）。 */
  app.get('/api/memory/boot', async () => memory.recall())

  /** 按关键词搜索记忆（实例工具 `trace`）。 */
  app.get<{ Querystring: { q?: unknown; limit?: unknown } }>('/api/memory/search', async (request) => {
    const query = singleQuery(request.query.q, 'q')
    let limit: number | undefined
    if (request.query.limit !== undefined) {
      if (Array.isArray(request.query.limit)) throw new RequestError(ErrorCodes.BadRequest, 'limit 不能重复传入')
      limit = integer(Number(request.query.limit), 'limit', 1, 100)
    }
    return memory.search(query, { limit })
  })

  /** Habitat 侧写入审计：只返回来源、状态与摘要，不复制 Nocturne 正文。 */
  app.get<{ Querystring: { limit?: unknown } }>('/api/memory/audit', async (request) => {
    if (request.query.limit !== undefined && Array.isArray(request.query.limit)) {
      throw new RequestError(ErrorCodes.BadRequest, 'limit 不能重复传入')
    }
    const limit = request.query.limit === undefined ? 20 : integer(Number(request.query.limit), 'limit', 1, 100)
    return { items: listMemoryWriteAudits(limit) }
  })
}
