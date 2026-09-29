/** Core-5 结构化 Eventide 结算 outbox。只保存结算结果，不保存聊天正文或 prompt。 */
import { and, asc, eq, lte } from 'drizzle-orm'
import type { CoreSettlementRow } from './schema.js'
import { coreSettlement } from './schema.js'
import { db } from './index.js'
import { sql } from 'drizzle-orm'

const MAX_ERROR_LENGTH = 1_000

export interface CoreSettlementRecord {
  interactionId: string
  result: Record<string, unknown>
  status: 'pending' | 'applied'
  attemptCount: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  appliedAt: number | null
}

function toRecord(row: CoreSettlementRow): CoreSettlementRecord {
  return {
    interactionId: row.interactionId,
    result: row.resultJson,
    status: row.status,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedAt: row.appliedAt,
  }
}

export function getCoreSettlement(interactionId: string): CoreSettlementRecord | null {
  const row = db.select().from(coreSettlement).where(eq(coreSettlement.interactionId, interactionId)).get()
  return row === undefined ? null : toRecord(row)
}

/**
 * 首次把已由模型解析出的结构化结算结果放入 outbox。
 * 已存在的交互永远不覆盖，保证重复请求不会重新生成或改写结果。
 */
export function enqueueCoreSettlement(
  interactionId: string,
  result: Record<string, unknown>,
  at = Date.now(),
): CoreSettlementRecord {
  db.insert(coreSettlement).values({
    interactionId,
    resultJson: result,
    status: 'pending',
    attemptCount: 0,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    appliedAt: null,
  }).onConflictDoNothing().run()
  const stored = getCoreSettlement(interactionId)
  if (stored === null) throw new Error('Core-5 结算 outbox 写入后无法读取')
  return stored
}

export function listPendingCoreSettlements(limit = 20, now = Date.now()): CoreSettlementRecord[] {
  return db.select().from(coreSettlement)
    .where(and(eq(coreSettlement.status, 'pending'), lte(coreSettlement.updatedAt, now - 5_000)))
    .orderBy(asc(coreSettlement.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100))
    .all()
    .map(toRecord)
}

export function markCoreSettlementAttempt(interactionId: string, error: string, at = Date.now()): void {
  db.update(coreSettlement)
    .set({
      attemptCount: sql<number>`${coreSettlement.attemptCount} + 1`,
      lastError: error.slice(0, MAX_ERROR_LENGTH),
      updatedAt: at,
    })
    .where(and(eq(coreSettlement.interactionId, interactionId), eq(coreSettlement.status, 'pending')))
    .run()
}

export function markCoreSettlementApplied(interactionId: string, at = Date.now()): boolean {
  return db.update(coreSettlement)
    .set({ status: 'applied', lastError: null, updatedAt: at, appliedAt: at })
    .where(and(eq(coreSettlement.interactionId, interactionId), eq(coreSettlement.status, 'pending')))
    .run().changes > 0
}

