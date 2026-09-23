/**
 * 诊断日志路由（技术方案 §7.2② / §8）—— 设置页「诊断日志」时间线的数据源。
 *
 * 只读，且**原样下发**库里的字段：诊断日志是排障用的证据，
 * 在服务端做二次解释只会让「页面看到的」和「库里存的」对不上。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type { McpDiagnosticPage, McpDiagnosticQuery } from '@shared/types'
import { listMcpDiagnostics } from '../db/diagnostics.js'
import { RequestError } from '../lib/errors.js'

/** 每页条数上限：一次拉太多既拖慢设置页，也没人真的往下翻两百条 */
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/** `?errorsOnly` / `=1` / `=true` 都算开；`0` / `false` 算关 */
function parseBool(raw: string, name: string): boolean {
  const value = raw.trim().toLowerCase()
  if (value === '' || value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  throw new RequestError(ErrorCodes.BadRequest, `${name} 只接受 true / false（收到 '${raw}'）`)
}

function parsePositiveInt(raw: string, name: string, max?: number): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new RequestError(ErrorCodes.BadRequest, `${name} 必须是正整数（收到 '${raw}'）`)
  }
  const value = Number(raw)
  if (value < 1) throw new RequestError(ErrorCodes.BadRequest, `${name} 必须 ≥ 1（收到 ${value}）`)
  if (max !== undefined && value > max) {
    throw new RequestError(ErrorCodes.BadRequest, `${name} 最大 ${max}（收到 ${value}）`)
  }
  return value
}

/** 同名参数被重复传会解析成数组，这里直接拒绝，避免下面做出意外行为 */
function readParam(raw: Record<string, unknown>, name: string): string | undefined {
  const value = raw[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new RequestError(ErrorCodes.BadRequest, `${name} 只接受单个值`)
  }
  return value
}

function parseQuery(raw: Record<string, unknown>): McpDiagnosticQuery {
  const query: McpDiagnosticQuery = { limit: DEFAULT_LIMIT }

  const serverId = readParam(raw, 'serverId')?.trim()
  if (serverId !== undefined && serverId !== '') query.serverId = serverId

  const errorsOnly = readParam(raw, 'errorsOnly')
  if (errorsOnly !== undefined) query.errorsOnly = parseBool(errorsOnly, 'errorsOnly')

  // handshake 是三态：不传 = 全部，true = 只看握手，false = 只看工具调用
  const handshake = readParam(raw, 'handshake')
  if (handshake !== undefined) query.handshake = parseBool(handshake, 'handshake')

  const limit = readParam(raw, 'limit')
  if (limit !== undefined) query.limit = parsePositiveInt(limit, 'limit', MAX_LIMIT)

  const before = readParam(raw, 'before')
  if (before !== undefined) query.before = parsePositiveInt(before, 'before')

  return query
}

export function registerDiagnosticRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/diagnostics/mcp',
    async (request): Promise<McpDiagnosticPage> => listMcpDiagnostics(parseQuery(request.query)),
  )
}
