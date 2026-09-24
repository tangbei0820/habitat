/**
 * 日记端点（SPEC §3.4）。
 *
 * 权限判定**不在这一层**，而在 `db/diary.ts`（唯一关口）—— 本层只管输入校验，
 * 以及把「拿不到 / 不该动」翻译成 404。
 * 为什么用 404 而不是 403：单用户场景下「这篇存在但你不能碰」与「这篇不存在」
 * 对调用方是同一件事，而 404 少泄漏一层信息 —— AI 私密日记的**存在与否**本身也算信息。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { ContentAuthor, DiaryVisibility } from '@shared/types'
import {
  createUserDiary,
  deleteUserDiary,
  getDiaryView,
  importDiaryIfAbsent,
  listDiaryViews,
  updateUserDiary,
} from '../db/diary.js'
import { RequestError } from '../lib/errors.js'

const TITLE_MAX = 120
const CONTENT_MAX = 10_000
const IMPORT_MAX = 2_000

function text(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是字符串`)
  const value = raw.trim()
  if (value === '') throw new RequestError(ErrorCodes.BadRequest, `${field} 不能为空`)
  if (value.length > max) throw new RequestError(ErrorCodes.BadRequest, `${field} 最长 ${max} 字`)
  return value
}

/** 纯日期一律 `YYYY-MM-DD`（本地日），不接受 ISO 时间戳 —— 后者会因时区推一天。 */
function dayKey(raw: unknown, field: string): string {
  const value = text(raw, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是 YYYY-MM-DD`)
  }
  return value
}

function bodyOf(raw: unknown): { title: string; content: string; entryDate: string } {
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    title: text(body.title, 'title', TITLE_MAX),
    content: text(body.content, 'content', CONTENT_MAX),
    entryDate: dayKey(body.entryDate, 'entryDate'),
  }
}

interface ImportItem {
  id: string
  title: string
  content: string
  entryDate: string
  author: ContentAuthor
  visibility: DiaryVisibility
  createdAt: number
  updatedAt: number
}

/**
 * 搬迁条目的宽松解析：`author` / `visibility` / 时间戳都可缺省。
 *
 * 与其它端点的严格风格不同是**刻意的** —— 这个端点唯一的调用方是「把浏览器里的旧数据搬上来」
 * 那段一次性代码，而旧数据里这些字段压根不存在（Dexie 时代没有它们）。
 * 要求它先补齐再发，只会让搬迁多一步无意义的加工。
 */
function importItem(raw: unknown): ImportItem {
  const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const at = Date.now()
  const author: ContentAuthor = item.author === 'companion' ? 'companion' : 'user'
  const visibility: DiaryVisibility =
    item.visibility === 'private' || item.visibility === 'locked' ? item.visibility : 'open'
  return {
    id: text(item.id, 'id', 128),
    title: text(item.title, 'title', TITLE_MAX),
    content: text(item.content, 'content', CONTENT_MAX),
    entryDate: dayKey(item.entryDate, 'entryDate'),
    author,
    visibility,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : at,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : at,
  }
}

export function registerDiaryRoutes(app: FastifyInstance): void {
  app.get('/api/diary', async () => ({ items: listDiaryViews() }))

  app.get<{ Params: { id: string } }>('/api/diary/:id', async (request) => {
    const view = getDiaryView(request.params.id)
    if (view === null) throw new RequestError(ErrorCodes.NotFound, '这篇日记不存在')
    return view
  })

  app.post('/api/diary', async (request, reply) => {
    const view = createUserDiary(bodyOf(request.body))
    reply.code(201)
    return view
  })

  app.patch<{ Params: { id: string } }>('/api/diary/:id', async (request) => {
    const view = updateUserDiary(request.params.id, bodyOf(request.body))
    // 不存在、或存在但不该由用户改（AI 的日记），对外一律「不存在」
    if (view === null) throw new RequestError(ErrorCodes.NotFound, '这篇日记不存在')
    return view
  })

  app.delete<{ Params: { id: string } }>('/api/diary/:id', async (request, reply) => {
    if (!deleteUserDiary(request.params.id)) throw new RequestError(ErrorCodes.NotFound, '这篇日记不存在')
    // `send()` 不带参数 = 空响应体。**不能写 `return null`** —— 那会让 Fastify 去序列化一个
    // JSON `null`，与 204「无响应体」冲突，最后以一个语焉不详的 500 收场（验收时真踩到了）。
    return reply.code(204).send()
  })

  /** 一次性搬迁入口：把浏览器残留的旧日记搬上来。幂等 —— 重复调不会产生副本。 */
  app.post('/api/diary/import', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const raw = body.items
    if (!Array.isArray(raw)) throw new RequestError(ErrorCodes.BadRequest, 'items 必须是数组')
    if (raw.length > IMPORT_MAX) throw new RequestError(ErrorCodes.BadRequest, `一次最多导入 ${IMPORT_MAX} 条`)
    let imported = 0
    for (const entry of raw) {
      if (importDiaryIfAbsent(importItem(entry))) imported += 1
    }
    return { imported, skipped: raw.length - imported }
  })
}
