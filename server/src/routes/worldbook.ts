/**
 * 世界书端点（Phase 7A · SPEC §9.4.2）。只做输入校验与 CRUD；
 * 注入筛选在 chat-context.ts（Runtime 的活），这层不碰。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { WorldbookMode } from '@shared/types.js'
import {
  createWorldbookEntry,
  deleteWorldbookEntry,
  getWorldbookEntry,
  listWorldbookEntries,
  updateWorldbookEntry,
  type WorldbookWrite,
} from '../db/worldbook.js'
import { RequestError } from '../lib/errors.js'

const TITLE_MAX = 100
const CONTENT_MAX = 4_000
const KEY_MAX = 50
const KEYS_MAX = 20

function text(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是字符串`)
  const value = raw.trim()
  if (value === '') throw new RequestError(ErrorCodes.BadRequest, `${field} 不能为空`)
  if (value.length > max) throw new RequestError(ErrorCodes.BadRequest, `${field} 最长 ${max} 字`)
  return value
}

function mode(raw: unknown): WorldbookMode {
  if (raw !== 'always' && raw !== 'keyword') {
    throw new RequestError(ErrorCodes.BadRequest, "mode 必须是 'always' 或 'keyword'")
  }
  return raw
}

function keys(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new RequestError(ErrorCodes.BadRequest, 'keys 必须是字符串数组')
  if (raw.length > KEYS_MAX) throw new RequestError(ErrorCodes.BadRequest, `keys 最多 ${KEYS_MAX} 个`)
  const seen = new Set<string>()
  for (const item of raw) {
    const key = text(item, 'keys 里的关键词', KEY_MAX).toLowerCase()
    seen.add(key)
  }
  return [...seen]
}

function sortOrder(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || Math.abs(raw) > 1_000_000) {
    throw new RequestError(ErrorCodes.BadRequest, 'sortOrder 必须是整数')
  }
  return raw
}

function parseWrite(raw: unknown, partial: boolean): Partial<WorldbookWrite> {
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const patch: Partial<WorldbookWrite> = {}
  if (!partial || body.title !== undefined) patch.title = text(body.title, 'title', TITLE_MAX)
  if (!partial || body.content !== undefined) patch.content = text(body.content, 'content', CONTENT_MAX)
  if (!partial || body.keys !== undefined) patch.keys = keys(body.keys)
  if (!partial || body.mode !== undefined) patch.mode = mode(body.mode)
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new RequestError(ErrorCodes.BadRequest, 'enabled 必须是布尔值')
    patch.enabled = body.enabled
  }
  if (body.sortOrder !== undefined) patch.sortOrder = sortOrder(body.sortOrder)
  // keyword 条目一个 key 都没有的话永远命中不了 —— 与其让用户存一条死数据，不如当场拒收
  if (patch.mode === 'keyword' && (patch.keys ?? []).length === 0) {
    throw new RequestError(ErrorCodes.BadRequest, 'keyword 模式至少要有一个触发关键词')
  }
  return patch
}

export function registerWorldbookRoutes(app: FastifyInstance): void {
  app.get('/api/worldbook', async () => ({ entries: listWorldbookEntries() }))

  app.post<{ Body: unknown }>('/api/worldbook', async (request, reply) => {
    const patch = parseWrite(request.body, false)
    const entry = createWorldbookEntry(patch as WorldbookWrite)
    return reply.status(201).send(entry)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/api/worldbook/:id', async (request) => {
    const patch = parseWrite(request.body, true)
    const updated = updateWorldbookEntry(request.params.id, patch)
    if (updated === null) throw new RequestError(ErrorCodes.NotFound, '条目不存在')
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/worldbook/:id', async (request) => {
    if (!deleteWorldbookEntry(request.params.id)) throw new RequestError(ErrorCodes.NotFound, '条目不存在')
    return { ok: true }
  })

  app.get<{ Params: { id: string } }>('/api/worldbook/:id', async (request) => {
    const entry = getWorldbookEntry(request.params.id)
    if (entry === null) throw new RequestError(ErrorCodes.NotFound, '条目不存在')
    return entry
  })
}
