/**
 * 留言板端点（SPEC §3.3）。
 *
 * 比日记简单：留言没有「私密」一说，所以不做可见性过滤，只区分作者权限——
 * 用户只能改 / 删自己的；AI 的修改走 Runtime 工具，用户不代替 AI 改它的留言。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { ContentAuthor, MomentChannel } from '@shared/types'
import {
  createUserMoment,
  createMomentGroup,
  deleteMomentGroup,
  deleteUserMoment,
  getMomentGroup,
  getMoment,
  importMomentIfAbsent,
  listMomentGroups,
  listMoments,
  setMomentGroup,
  updateMomentGroup,
  updateUserMoment,
} from '../db/moment.js'
import { RequestError } from '../lib/errors.js'

const CONTENT_MAX = 500
const IMPORT_MAX = 5_000
const GROUP_NAME_MAX = 30

function content(raw: unknown): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, 'content 必须是字符串')
  const value = raw.trim()
  if (value === '') throw new RequestError(ErrorCodes.BadRequest, '留言不能为空')
  if (value.length > CONTENT_MAX) throw new RequestError(ErrorCodes.BadRequest, `留言最长 ${CONTENT_MAX} 字`)
  return value
}

function groupName(raw: unknown): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, '分组名称必须是字符串')
  const value = raw.trim()
  if (value === '' || value.length > GROUP_NAME_MAX) throw new RequestError(ErrorCodes.BadRequest, `分组名称为 1-${GROUP_NAME_MAX} 字`)
  return value
}

interface ImportItem {
  id: string
  content: string
  author: ContentAuthor
  groupId: string | null
  channel: MomentChannel
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
    groupId: null,
    channel: item.channel === 'feed' ? 'feed' : 'board',
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
    const query = request.query as Record<string, unknown>
    const rawQuery = query.q
    const rawAuthor = query.author
    const rawGroup = query.groupId
    const rawChannel = query.channel
    if (rawQuery !== undefined && typeof rawQuery !== 'string') throw new RequestError(ErrorCodes.BadRequest, 'q 必须是字符串')
    if (typeof rawQuery === 'string' && rawQuery.length > 120) throw new RequestError(ErrorCodes.BadRequest, 'q 最长 120 字')
    if (rawAuthor !== undefined && rawAuthor !== 'user' && rawAuthor !== 'companion') throw new RequestError(ErrorCodes.BadRequest, 'author 只能是 user 或 companion')
    if (rawChannel !== undefined && rawChannel !== 'board' && rawChannel !== 'feed') throw new RequestError(ErrorCodes.BadRequest, 'channel 只能是 board 或 feed')
    if (rawGroup !== undefined && typeof rawGroup !== 'string') throw new RequestError(ErrorCodes.BadRequest, 'groupId 必须是字符串')
    let groupId: string | null | undefined
    if (typeof rawGroup === 'string') {
      if (rawGroup === 'none') groupId = null
      else if (rawGroup.trim() !== '') groupId = rawGroup.trim()
      else throw new RequestError(ErrorCodes.BadRequest, 'groupId 不能为空')
    }
    const items = listMoments({
      channel: rawChannel === 'feed' ? 'feed' : 'board',
      ...(typeof rawQuery === 'string' && rawQuery.trim() !== '' ? { query: rawQuery } : {}),
      ...(rawAuthor === 'user' || rawAuthor === 'companion' ? { author: rawAuthor } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
    })
    const raw = request.query.limit
    if (raw === undefined) return { items }
    const limit = Number(Array.isArray(raw) ? raw[0] : raw)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RequestError(ErrorCodes.BadRequest, 'limit 必须是正整数')
    }
    return { items: items.slice(0, limit) }
  })

  app.get('/api/moment-groups', async () => ({ groups: listMomentGroups() }))

  app.post('/api/moment-groups', async (request, reply) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const created = createMomentGroup(groupName(body.name))
    if (created === null) throw new RequestError(ErrorCodes.BadRequest, '已经有同名留言分组')
    reply.code(201)
    return created
  })

  app.patch<{ Params: { id: string } }>('/api/moment-groups/:id', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const updated = updateMomentGroup(request.params.id, groupName(body.name))
    if (updated === null) {
      if (getMomentGroup(request.params.id) === null) throw new RequestError(ErrorCodes.NotFound, '留言分组不存在')
      throw new RequestError(ErrorCodes.BadRequest, '已经有同名留言分组')
    }
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/moment-groups/:id', async (request) => {
    const moved = deleteMomentGroup(request.params.id)
    if (moved === null) throw new RequestError(ErrorCodes.NotFound, '留言分组不存在')
    return { moved }
  })

  app.post('/api/moments', async (request, reply) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const rawGroupId = body.groupId
    const channel = body.channel === 'feed' ? 'feed' : 'board'
    if (body.channel !== undefined && body.channel !== 'board' && body.channel !== 'feed') throw new RequestError(ErrorCodes.BadRequest, 'channel 只能是 board 或 feed')
    if (rawGroupId !== undefined && rawGroupId !== null && (typeof rawGroupId !== 'string' || rawGroupId.trim() === '')) {
      throw new RequestError(ErrorCodes.BadRequest, 'groupId 必须是有效字符串或 null')
    }
    const groupId = channel === 'feed' ? null : rawGroupId === null || rawGroupId === undefined ? null : rawGroupId.trim()
    if (groupId !== null && getMomentGroup(groupId) === null) throw new RequestError(ErrorCodes.NotFound, '留言分组不存在')
    reply.code(201)
    return createUserMoment(content(body.content), groupId, channel)
  })

  app.get<{ Params: { id: string } }>('/api/moments/:id', async (request) => {
    const item = getMoment(request.params.id)
    if (item === null) throw new RequestError(ErrorCodes.NotFound, '这条留言不存在')
    return item
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

  app.put<{ Params: { id: string } }>('/api/moments/:id/group', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const raw = body.groupId
    if (raw !== null && (typeof raw !== 'string' || raw.trim() === '')) throw new RequestError(ErrorCodes.BadRequest, 'groupId 必须是分组 id 或 null')
    const groupId = raw === null ? null : raw.trim()
    if (groupId !== null && getMomentGroup(groupId) === null) throw new RequestError(ErrorCodes.NotFound, '留言分组不存在')
    const updated = setMomentGroup(request.params.id, groupId)
    if (updated === null) throw new RequestError(ErrorCodes.NotFound, '这条留言不存在')
    return updated
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
