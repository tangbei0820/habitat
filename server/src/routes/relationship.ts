/** Chat 关系互动：拍一拍、暂停聊天与恢复申请。 */
import type { FastifyInstance } from 'fastify'
import {
  decideRelationshipRecovery,
  getRelationshipSnapshot,
  pauseRelationship,
  pokeRelationship,
  requestRelationshipRecovery,
} from '../db/relationship.js'
import { RequestError } from '../lib/errors.js'

function bodyObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function optionalReason(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.trim().length > 200) throw new RequestError('BAD_REQUEST', '原因不能超过 200 个字符')
  return value.trim() || null
}

export function registerRelationshipRoutes(app: FastifyInstance): void {
  app.get('/api/relationship', async () => getRelationshipSnapshot())

  app.post('/api/relationship/poke', async (_request, reply) => {
    try {
      const at = Date.now()
      return reply.status(201).send({ event: { type: 'poke', by: 'user', at }, snapshot: pokeRelationship('user', at) })
    } catch (error) {
      throw new RequestError('BAD_REQUEST', error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/relationship/pause', async (request) => {
    const body = bodyObject(request.body)
    const rawMinutes = body.durationMinutes
    const durationMinutes = rawMinutes === undefined ? 60 : Number(rawMinutes)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new RequestError('BAD_REQUEST', '暂停时长必须是正数分钟')
    try {
      return pauseRelationship('user', optionalReason(body.reason), durationMinutes)
    } catch (error) {
      throw new RequestError('BAD_REQUEST', error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/relationship/recovery', async () => {
    try {
      return { request: requestRelationshipRecovery('user'), snapshot: getRelationshipSnapshot() }
    } catch (error) {
      throw new RequestError('BAD_REQUEST', error instanceof Error ? error.message : String(error))
    }
  })

  app.post<{ Params: { id: string }; Body: unknown }>('/api/relationship/recovery/:id/decide', async (request) => {
    const body = bodyObject(request.body)
    if (body.decision !== 'approve' && body.decision !== 'deny') throw new RequestError('BAD_REQUEST', 'decision 必须是 approve 或 deny')
    try {
      return decideRelationshipRecovery(request.params.id, 'user', body.decision === 'approve')
    } catch (error) {
      throw new RequestError('BAD_REQUEST', error instanceof Error ? error.message : String(error))
    }
  })
}
