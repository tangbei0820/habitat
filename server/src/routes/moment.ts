/**
 * 留言板端点（SPEC §3.3）。
 *
 * 比日记简单：留言没有「私密」一说，所以不做可见性过滤，只区分作者权限——
 * 用户只能改 / 删自己的；AI 的修改走 Runtime 工具，用户不代替 AI 改它的留言。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { ContentAuthor } from '@shared/types'
import {
  createUserMoment,
  deleteUserMoment,
  importMomentIfAbsent,
  listMoments,
  updateUserMoment,
} from '../db/moment.js'
import { RequestError } from '../lib/errors.js'

const CONTENT_MAX = 500
const IMPORT_MAX = 5_000

function content(raw: unknown): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, 'content 必须是字符串')
  const value = raw.trim()
  if (value === '') throw new RequestError(ErrorCodes.BadRequest, '留言不能为空')
  if (value.length > CONTENT_MAX) throw new RequestError(ErrorCodes.BadRequest, `留言最长 ${CONTENT_MAX} 字`)
  return value
}

interface ImportItem {
  id: string
  content: string
  author: ContentAuthor
  createdAt: number
  updatedAt: number
}

/** 宽松解析，理由同 `routes/diary.ts` 的 `importItem`：旧数据里没有这些字段。 */
function importItem(raw: unknown): ImportItem {
  const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const at = Date.now()
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  if (id === '') throw new RequestError(ErrorCodes.BadRequest, 'id 不能为空')
  return {
    id,
    content: content(item.content),
    author: item.author === 'companion' ? 'companion' : 'user',
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : at,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : at,
  }
}

export function registerMomentRoutes(app: FastifyInstance): void {
  /**
   * `limit` 是给**主屏 Widget** 用的：它只要最近 3 条（`HOME_WIDGET_BOARD_LIMIT`）。
   * 让它把整表拉回来再切片，等于每次渲染主屏都把全部留言过一遍网络 —— 量小的时候看不出来，
   * 但那是「现在数据少」碰巧掩盖的，不是设计。
   */
  app.get<{ Querystring: { limit?: unknown } }>('/api/moments', async (request) => {
    const items = listMoments()
    const raw = request.query.limit
    if (raw === undefined) return { items }
    const limit = Number(Array.isArray(raw) ? raw[0] : raw)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RequestError(ErrorCodes.BadRequest, 'limit 必须是正整数')
    }
    return { items: items.slice(0, limit) }
  })

  app.post('/api/moments', async (request, reply) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    reply.code(201)
    return createUserMoment(content(body.content))
  })

  app.patch<{ Params: { id: string } }>('/api/moments/:id', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const updated = updateUserMoment(request.params.id, content(body.content))
    if (updated === null) throw new RequestError(ErrorCodes.NotFound, '这条留言不存在，或不是你写的')
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/moments/:id', async (request, reply) => {
    if (!deleteUserMoment(request.params.id)) throw new RequestError(ErrorCodes.NotFound, '这条留言不存在')
    // 同 `routes/diary.ts`：204 必须走 `send()`，不能 `return null`
    return reply.code(204).send()
  })

  /** 一次性搬迁入口，幂等。 */
  app.post('/api/moments/import', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const raw = body.items
    if (!Array.isArray(raw)) throw new RequestError(ErrorCodes.BadRequest, 'items 必须是数组')
    if (raw.length > IMPORT_MAX) throw new RequestError(ErrorCodes.BadRequest, `一次最多导入 ${IMPORT_MAX} 条`)
    let imported = 0
    for (const entry of raw) {
      if (importMomentIfAbsent(importItem(entry))) imported += 1
    }
    return { imported, skipped: raw.length - imported }
  })
}
