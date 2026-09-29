import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CallEvent, CallSessionRecord } from '@shared/types.js'
import { appendCallTurn, answerCall, createCall, finishCall, getCall, listCallTurns, listCalls, listIncomingCalls } from '../db/calls.js'
import { appendEventLog, createNotification } from '../db/activity.js'
import { RequestError } from '../lib/errors.js'
import { publishCallEvent, subscribeAllCalls, subscribeCall } from '../services/call-events.js'
import { sendWebPush } from '../services/push.js'
import { notificationDeliveryAllowed } from '../db/notification-preferences.js'
import { getRelationshipSnapshot } from '../db/relationship.js'

type IdParams = { id: string }
type ChatQuery = { chatSessionId?: string }
type TurnBody = { speaker?: unknown; text?: unknown }
type HangupBody = { status?: unknown }

function bodyObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 160) throw new RequestError('BAD_REQUEST', `${name} 无效`)
  return value.trim()
}

function callOrThrow(id: string): CallSessionRecord {
  const call = getCall(id)
  if (call === null) throw new RequestError('NOT_FOUND', '通话不存在')
  return call
}

function writeSse(reply: FastifyReply, event: CallEvent): void {
  if (!reply.raw.destroyed) {
    if (event.eventId !== undefined) reply.raw.write(`id: ${event.eventId}\n`)
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
  }
}

function openSse(reply: FastifyReply, request: FastifyRequest, subscribe: (listener: (event: CallEvent) => void) => () => void): void {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  reply.raw.write('retry: 3000\n\n')
  const unsubscribe = subscribe((event) => writeSse(reply, event))
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n')
  }, 20_000)
  heartbeat.unref()
  const cleanup = () => {
    clearInterval(heartbeat)
    unsubscribe()
  }
  request.raw.once('close', cleanup)
}

function publishState(call: CallSessionRecord): CallSessionRecord {
  publishCallEvent({ type: 'state', call })
  return call
}

function recordCallEnd(call: CallSessionRecord): void {
  appendEventLog('call.ended', { callId: call.id, chatSessionId: call.chatSessionId, direction: call.direction, status: call.status, durationMs: call.durationMs }, call.id, call.endedAt ?? Date.now())
}

export function registerCallRoutes(app: FastifyInstance): void {
  app.post('/api/calls', async (request, reply) => {
    if (getRelationshipSnapshot().state.status === 'paused') throw new RequestError('BAD_REQUEST', '关系暂停期间不能发起通话')
    const body = bodyObject(request.body)
    const chatSessionId = requiredId(body.chatSessionId, 'chatSessionId')
    const call = publishState(createCall(chatSessionId, 'user'))
    return reply.status(201).send({ call })
  })

  /** Runtime / wake 使用这个入口向用户发起应用内来电。 */
  app.post('/api/calls/ring', async (request, reply) => {
    if (getRelationshipSnapshot().state.status === 'paused') throw new RequestError('BAD_REQUEST', '关系暂停期间不能发起通话邀请')
    const body = bodyObject(request.body)
    const chatSessionId = requiredId(body.chatSessionId, 'chatSessionId')
    const call = createCall(chatSessionId, 'companion')
    if (notificationDeliveryAllowed('call').allowed) publishState(call)
    const notice = createNotification('proactive', '小栖来电', '小栖正在邀请你接听通话', { callId: call.id, chatSessionId, category: 'call' })
    void sendWebPush(notice).catch((error: unknown) => app.log.warn({ err: error }, '来电 Web Push 发送失败，站内通知已保留'))
    return reply.status(201).send({ call })
  })

  app.get('/api/calls/inbox', async (_request, reply) => reply.send({ calls: notificationDeliveryAllowed('call').allowed ? listIncomingCalls() : [] }))

  app.get<{ Querystring: ChatQuery }>('/api/calls', async (request, reply) => {
    const chatSessionId = requiredId(request.query.chatSessionId, 'chatSessionId')
    return reply.send({ calls: listCalls(chatSessionId) })
  })

  app.get('/api/calls/events', async (request, reply) => {
    openSse(reply, request, subscribeAllCalls)
  })

  app.get<{ Params: IdParams }>('/api/calls/:id/events', async (request, reply) => {
    const id = requiredId(request.params.id, 'callId')
    callOrThrow(id)
    openSse(reply, request, (listener) => subscribeCall(id, listener))
  })

  app.get<{ Params: IdParams }>('/api/calls/:id', async (request, reply) => {
    const call = callOrThrow(requiredId(request.params.id, 'callId'))
    return reply.send({ call, turns: listCallTurns(call.id) })
  })

  app.post<{ Params: IdParams }>('/api/calls/:id/answer', async (request, reply) => {
    const id = requiredId(request.params.id, 'callId')
    callOrThrow(id)
    const call = answerCall(id)
    if (call === null) throw new RequestError('BAD_REQUEST', '通话已经结束或不在响铃状态')
    return reply.send({ call: publishState(call) })
  })

  app.post<{ Params: IdParams }>('/api/calls/:id/reject', async (request, reply) => {
    const id = requiredId(request.params.id, 'callId')
    const before = callOrThrow(id)
    const call = finishCall(id, 'rejected')
    if (call === null) throw new RequestError('BAD_REQUEST', '通话状态不允许拒绝')
    if (before.status === 'ringing') recordCallEnd(call)
    return reply.send({ call: publishState(call) })
  })

  app.post<{ Params: IdParams; Body: HangupBody }>('/api/calls/:id/hangup', async (request, reply) => {
    const id = requiredId(request.params.id, 'callId')
    const before = callOrThrow(id)
    const raw = request.body?.status
    const status = raw === undefined ? 'ended' : raw
    if (status !== 'ended' && status !== 'cancelled' && status !== 'missed') throw new RequestError('BAD_REQUEST', '结束状态无效')
    const call = finishCall(id, status)
    if (call === null) throw new RequestError('BAD_REQUEST', '通话状态不允许结束')
    if (before.status === 'ringing' || before.status === 'active') recordCallEnd(call)
    return reply.send({ call: publishState(call) })
  })

  app.post<{ Params: IdParams; Body: TurnBody }>('/api/calls/:id/turns', async (request, reply) => {
    const id = requiredId(request.params.id, 'callId')
    callOrThrow(id)
    const speaker = request.body?.speaker
    const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
    if (speaker !== 'user' && speaker !== 'companion') throw new RequestError('BAD_REQUEST', '说话方无效')
    if (text === '' || text.length > 8_000) throw new RequestError('BAD_REQUEST', '通话内容不能为空且不能超过 8000 字')
    const turn = appendCallTurn(id, speaker, text)
    if (turn === null) throw new RequestError('BAD_REQUEST', '通话已经结束，无法追加内容')
    publishCallEvent({ type: 'turn', callId: id, turn })
    return reply.status(201).send({ turn })
  })
}
