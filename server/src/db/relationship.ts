/**
 * 关系型互动事实源（PRODUCT_SPEC §2.6）。
 *
 * 暂停只改变“还能不能发起普通聊天 / 主动打扰”，不删除历史消息。
 * 当前状态与恢复申请都在 SQLite，EventLog 只负责留痕，不承担状态读取。
 */
import { randomUUID } from 'node:crypto'
import { and, desc, eq, ne } from 'drizzle-orm'
import type {
  RelationshipParty,
  RelationshipRecoveryRequest,
  RelationshipSnapshot,
  RelationshipState,
} from '@shared/types.js'
import { db } from './index.js'
import { appendEventLog, createNotification } from './activity.js'
import { relationshipRequest, relationshipState } from './schema.js'

const STATE_ID = 'relationship-main'
const MAX_PAUSE_MINUTES = 60

function toState(row: typeof relationshipState.$inferSelect): RelationshipState {
  return {
    status: row.status,
    pausedBy: row.pausedBy ?? null,
    reason: row.reason ?? null,
    startedAt: row.startedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    updatedAt: row.updatedAt,
  }
}

function toRequest(row: typeof relationshipRequest.$inferSelect): RelationshipRecoveryRequest {
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    decider: row.decider,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? null,
  }
}

function currentRow(): typeof relationshipState.$inferSelect {
  const row = db.select().from(relationshipState).where(eq(relationshipState.id, STATE_ID)).get()
  if (row === undefined) throw new Error('关系状态尚未初始化')
  return row
}

/** 读取时顺手处理到期，保证没有后台调度器时也不会继续阻断聊天。 */
export function expireRelationshipIfNeeded(now = Date.now()): boolean {
  const row = currentRow()
  if (row.status !== 'paused' || row.expiresAt === null || row.expiresAt > now) return false
  db.transaction((tx) => {
    tx.update(relationshipState).set({
      status: 'active',
      pausedBy: null,
      reason: null,
      startedAt: null,
      expiresAt: null,
      updatedAt: now,
    }).where(eq(relationshipState.id, STATE_ID)).run()
    tx.update(relationshipRequest).set({ status: 'expired', decidedAt: now }).where(eq(relationshipRequest.status, 'pending')).run()
  })
  appendEventLog('relationship.auto_resumed', { previousPausedBy: row.pausedBy, previousExpiresAt: row.expiresAt }, STATE_ID, now)
  createNotification('system', '聊天已自动恢复', '暂停时间已到，普通聊天和主动消息已恢复。', { category: 'relationship', reason: 'expired', expiresAt: row.expiresAt })
  return true
}

export function getRelationshipSnapshot(now = Date.now()): RelationshipSnapshot {
  expireRelationshipIfNeeded(now)
  const state = toState(currentRow())
  const requests = db.select().from(relationshipRequest)
    .orderBy(desc(relationshipRequest.createdAt))
    .limit(30)
    .all()
    .map(toRequest)
  return { state, requests, now }
}

export function pauseRelationship(
  requestedBy: RelationshipParty,
  reason: string | null,
  durationMinutes = MAX_PAUSE_MINUTES,
  now = Date.now(),
): RelationshipSnapshot {
  expireRelationshipIfNeeded(now)
  const before = currentRow()
  if (before.status === 'paused') throw new Error('聊天已经处于暂停状态')
  const minutes = Math.max(1, Math.min(MAX_PAUSE_MINUTES, Math.floor(durationMinutes)))
  const expiresAt = now + minutes * 60_000
  db.transaction((tx) => {
    tx.update(relationshipState).set({
      status: 'paused',
      pausedBy: requestedBy,
      reason: reason === null || reason.trim() === '' ? null : reason.trim().slice(0, 200),
      startedAt: now,
      expiresAt,
      updatedAt: now,
    }).where(eq(relationshipState.id, STATE_ID)).run()
    tx.update(relationshipRequest).set({ status: 'expired', decidedAt: now }).where(eq(relationshipRequest.status, 'pending')).run()
  })
  appendEventLog('relationship.paused', { by: requestedBy, reason, expiresAt }, STATE_ID, now)
  if (requestedBy === 'companion') {
    createNotification('proactive', '小栖暂时想安静一下', `聊天暂时暂停，预计 ${minutes} 分钟后自动恢复。`, { category: 'relationship', expiresAt })
  }
  return getRelationshipSnapshot(now)
}

/** 记录一次轻量的拍一拍关系事件；它不创建普通聊天消息，也不触发模型回复。 */
export function pokeRelationship(requestedBy: RelationshipParty, now = Date.now()): RelationshipSnapshot {
  const snapshot = getRelationshipSnapshot(now)
  if (snapshot.state.status === 'paused') throw new Error('聊天暂停期间不能拍一拍')
  appendEventLog('relationship.poked', { by: requestedBy }, null, now)
  if (requestedBy === 'companion') {
    createNotification('proactive', '小栖拍了拍你', '这是一条轻量的关系互动，不需要回复。', { category: 'relationship', event: 'poke' }, now)
  }
  return getRelationshipSnapshot(now)
}

export function requestRelationshipRecovery(
  requestedBy: RelationshipParty,
  now = Date.now(),
): RelationshipRecoveryRequest {
  expireRelationshipIfNeeded(now)
  const state = currentRow()
  if (state.status !== 'paused') throw new Error('当前没有需要恢复的暂停')
  const existing = db.select().from(relationshipRequest)
    .where(and(eq(relationshipRequest.requestedBy, requestedBy), eq(relationshipRequest.status, 'pending')))
    .orderBy(desc(relationshipRequest.createdAt))
    .limit(1)
    .get()
  if (existing !== undefined) return toRequest(existing)
  const request: RelationshipRecoveryRequest = {
    id: randomUUID(),
    requestedBy,
    decider: requestedBy === 'user' ? 'companion' : 'user',
    status: 'pending',
    createdAt: now,
    decidedAt: null,
  }
  db.insert(relationshipRequest).values({ ...request }).run()
  appendEventLog('relationship.recovery.requested', { requestedBy, decider: request.decider }, request.id, now)
  if (request.decider === 'user') {
    createNotification('system', '收到聊天恢复申请', '小栖想恢复聊天，打开聊天设置即可决定。', { category: 'relationship', requestId: request.id })
  }
  return request
}

export function decideRelationshipRecovery(
  requestId: string,
  decider: RelationshipParty,
  approved: boolean,
  now = Date.now(),
): RelationshipSnapshot {
  expireRelationshipIfNeeded(now)
  const request = db.select().from(relationshipRequest).where(eq(relationshipRequest.id, requestId)).get()
  if (request === undefined || request.status !== 'pending') throw new Error('恢复申请不存在或已经处理')
  if (request.decider !== decider) throw new Error('当前身份不能决定这条恢复申请')
  const state = currentRow()
  if (state.status !== 'paused') throw new Error('暂停已经自动解除')
  db.transaction((tx) => {
    tx.update(relationshipRequest).set({ status: approved ? 'approved' : 'denied', decidedAt: now }).where(eq(relationshipRequest.id, requestId)).run()
    if (approved) {
      tx.update(relationshipState).set({
        status: 'active',
        pausedBy: null,
        reason: null,
        startedAt: null,
        expiresAt: null,
        updatedAt: now,
      }).where(eq(relationshipState.id, STATE_ID)).run()
      tx.update(relationshipRequest).set({ status: 'expired', decidedAt: now }).where(and(eq(relationshipRequest.status, 'pending'), ne(relationshipRequest.id, requestId))).run()
    }
  })
  appendEventLog(`relationship.recovery.${approved ? 'approved' : 'denied'}`, { requestId, decidedBy: decider }, STATE_ID, now)
  if (approved) createNotification('system', '聊天已恢复', '恢复申请已同意，现在可以继续聊天。', { category: 'relationship', requestId })
  return getRelationshipSnapshot(now)
}

export function isRelationshipPaused(now = Date.now()): boolean {
  return getRelationshipSnapshot(now).state.status === 'paused'
}
