/** 应用内电话的 SQLite 事实源；聊天正文仍由浏览器会话库保存。 */
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { CallDirection, CallSessionRecord, CallSpeaker, CallStatus, CallTurnRecord } from '@shared/types.js'
import { db } from './index.js'
import { callSession, callTurn } from './schema.js'

function toSession(row: typeof callSession.$inferSelect): CallSessionRecord {
  return {
    id: row.id,
    chatSessionId: row.chatSessionId,
    direction: row.direction,
    status: row.status,
    createdAt: row.createdAt,
    answeredAt: row.answeredAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    updatedAt: row.updatedAt,
  }
}

function toTurn(row: typeof callTurn.$inferSelect): CallTurnRecord {
  return {
    id: row.id,
    callId: row.callId,
    sequence: row.sequence,
    speaker: row.speaker,
    text: row.text,
    at: row.at,
  }
}

export function createCall(chatSessionId: string, direction: CallDirection, at = Date.now()): CallSessionRecord {
  const record: CallSessionRecord = {
    id: randomUUID(),
    chatSessionId,
    direction,
    status: 'ringing',
    createdAt: at,
    answeredAt: null,
    endedAt: null,
    durationMs: 0,
    updatedAt: at,
  }
  db.insert(callSession).values(record).run()
  return record
}

export function getCall(id: string): CallSessionRecord | null {
  const row = db.select().from(callSession).where(eq(callSession.id, id)).get()
  return row === undefined ? null : toSession(row)
}

export function listCalls(chatSessionId: string, limit = 50): CallSessionRecord[] {
  return db.select().from(callSession)
    .where(eq(callSession.chatSessionId, chatSessionId))
    .orderBy(desc(callSession.createdAt))
    .limit(limit)
    .all()
    .map(toSession)
}

export function listIncomingCalls(limit = 20): CallSessionRecord[] {
  return db.select().from(callSession)
    .where(and(eq(callSession.direction, 'companion'), eq(callSession.status, 'ringing')))
    .orderBy(desc(callSession.createdAt))
    .limit(limit)
    .all()
    .map(toSession)
}

export function answerCall(id: string, at = Date.now()): CallSessionRecord | null {
  const current = getCall(id)
  // A retry after the browser reconnects must not turn an already answered
  // call into a client-visible error.  Terminal states remain non-answerable.
  if (current === null) return null
  if (current.status === 'active') return current
  if (current.status !== 'ringing') return null
  db.update(callSession).set({ status: 'active', answeredAt: at, updatedAt: at }).where(eq(callSession.id, id)).run()
  return getCall(id)
}

export function finishCall(id: string, status: Extract<CallStatus, 'ended' | 'rejected' | 'missed' | 'cancelled'>, at = Date.now()): CallSessionRecord | null {
  const current = getCall(id)
  if (current === null || current.status === 'ended' || current.status === 'rejected' || current.status === 'missed' || current.status === 'cancelled') return current
  const durationMs = current.answeredAt === null ? 0 : Math.max(0, at - current.answeredAt)
  db.update(callSession).set({ status, endedAt: at, durationMs, updatedAt: at }).where(eq(callSession.id, id)).run()
  return getCall(id)
}

export function listCallTurns(callId: string): CallTurnRecord[] {
  return db.select().from(callTurn).where(eq(callTurn.callId, callId)).orderBy(asc(callTurn.sequence)).all().map(toTurn)
}

export function appendCallTurn(callId: string, speaker: CallSpeaker, text: string, at = Date.now()): CallTurnRecord | null {
  const call = getCall(callId)
  if (call === null || call.status !== 'active') return null
  const latest = db.select().from(callTurn).where(eq(callTurn.callId, callId)).orderBy(desc(callTurn.sequence)).limit(1).get()
  const record: CallTurnRecord = {
    id: randomUUID(),
    callId,
    sequence: (latest?.sequence ?? -1) + 1,
    speaker,
    text,
    at,
  }
  db.insert(callTurn).values(record).run()
  return record
}
