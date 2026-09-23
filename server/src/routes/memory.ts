/** Phase 3A 记忆端点：前端只到这里；内部统一走 MemoryProvider → ToolGateway → Nocturne MCP。 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { MemoryCreateInput, MemoryProvider, MemoryUpdateInput } from '@shared/providers.js'
import { RequestError } from '../lib/errors.js'

const URI_RE = /^[A-Za-z_][A-Za-z0-9_]*:\/\/[^\0]*$/
const DOMAIN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RequestError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  return raw as Record<string, unknown>
}

function text(raw: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof raw !== 'string') throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是字符串`)
  const value = raw.trim()
  if (!allowEmpty && value === '') throw new RequestError(ErrorCodes.BadRequest, `${field} 不能为空`)
  if (value.length > max) throw new RequestError(ErrorCodes.BadRequest, `${field} 最长 ${max} 字`)
  return allowEmpty ? raw : value
}

function uri(raw: unknown, field = 'uri', mutable = false): string {
  const value = text(raw, field, 500)
  if (!URI_RE.test(value)) throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是 domain://path 形式`)
  if (mutable && value.toLowerCase().startsWith('system://')) throw new RequestError(ErrorCodes.BadRequest, 'system:// 是只读视图，不能修改')
  return value
}

function integer(raw: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(raw) || (raw as number) < min || (raw as number) > max) {
    throw new RequestError(ErrorCodes.BadRequest, `${field} 必须是 ${min}–${max} 的整数`)
  }
  return raw as number
}

function optionalText(raw: unknown, field: string, max: number, allowEmpty = false): string | undefined {
  return raw === undefined ? undefined : text(raw, field, max, allowEmpty)
}

function singleQuery(raw: unknown, field: string, required = true): string | undefined {
  if (Array.isArray(raw)) throw new RequestError(ErrorCodes.BadRequest, `${field} 不能重复传入`)
  if (raw === undefined && !required) return undefined
  return text(raw, field, 500)
}

export function registerMemoryRoutes(app: FastifyInstance, memory: MemoryProvider): void {
  app.get('/api/memory/boot', async () => memory.recall())

  app.get<{ Querystring: { q?: unknown; domain?: unknown; limit?: unknown } }>('/api/memory/search', async (request) => {
    const query = singleQuery(request.query.q, 'q') as string
    const domainRaw = singleQuery(request.query.domain, 'domain', false)
    if (domainRaw !== undefined && !DOMAIN_RE.test(domainRaw)) throw new RequestError(ErrorCodes.BadRequest, 'domain 格式无效')
    let limit: number | undefined
    if (request.query.limit !== undefined) {
      if (Array.isArray(request.query.limit)) throw new RequestError(ErrorCodes.BadRequest, 'limit 不能重复传入')
      const parsed = Number(request.query.limit)
      limit = integer(parsed, 'limit', 1, 100)
    }
    return memory.search(query, { domain: domainRaw, limit })
  })

  app.get<{ Querystring: { uri?: unknown } }>('/api/memory/read', async (request) => {
    return memory.read(uri(singleQuery(request.query.uri, 'uri')))
  })

  app.post('/api/memory', async (request, reply) => {
    const body = record(request.body)
    const input: MemoryCreateInput = {
      parentUri: uri(body.parentUri, 'parentUri', true),
      content: text(body.content, 'content', 100_000),
      priority: integer(body.priority, 'priority', 0, 1_000_000),
      disclosure: text(body.disclosure, 'disclosure', 2_000),
    }
    const title = optionalText(body.title, 'title', 120)
    if (title !== undefined) {
      if (!/^[A-Za-z0-9_-]+$/.test(title)) throw new RequestError(ErrorCodes.BadRequest, 'title 只允许英文字母、数字、下划线和连字符')
      input.title = title
    }
    return reply.status(201).send(await memory.create(input))
  })

  app.patch('/api/memory', async (request) => {
    const body = record(request.body)
    const input: MemoryUpdateInput = { uri: uri(body.uri, 'uri', true) }
    const oldString = optionalText(body.oldString, 'oldString', 100_000)
    const newString = optionalText(body.newString, 'newString', 100_000, true)
    const append = optionalText(body.append, 'append', 100_000)
    if ((oldString === undefined) !== (newString === undefined)) throw new RequestError(ErrorCodes.BadRequest, 'oldString 与 newString 必须同时提供')
    if (oldString !== undefined && append !== undefined) throw new RequestError(ErrorCodes.BadRequest, '替换模式与追加模式不能同时使用')
    if (oldString !== undefined) { input.oldString = oldString; input.newString = newString }
    if (append !== undefined) input.append = append
    if (body.priority !== undefined) input.priority = integer(body.priority, 'priority', 0, 1_000_000)
    if (body.disclosure !== undefined) input.disclosure = text(body.disclosure, 'disclosure', 2_000)
    if (Object.keys(input).length === 1) throw new RequestError(ErrorCodes.BadRequest, '至少提供一项修改')
    return memory.update(input)
  })

  app.delete<{ Querystring: { uri?: unknown } }>('/api/memory', async (request) => {
    return memory.delete(uri(singleQuery(request.query.uri, 'uri'), 'uri', true))
  })
}
