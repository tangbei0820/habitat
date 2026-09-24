/** Web Push 订阅仓储。失效 endpoint 可删除，其余失败保留最后原因供 Life 运行页诊断。 */
import { randomUUID } from 'node:crypto'
import { count, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from './index.js'
import { pushSubscription } from './schema.js'

export interface StoredPushSubscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export function savePushSubscription(endpoint: string, p256dh: string, auth: string): void {
  const now = Date.now()
  db.insert(pushSubscription).values({
    id: randomUUID(), endpoint, p256dh, auth, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: pushSubscription.endpoint,
    set: { p256dh, auth, updatedAt: now, lastError: null },
  }).run()
}

export function removePushSubscription(endpoint: string): boolean {
  return db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint)).run().changes > 0
}

export function listPushSubscriptions(): StoredPushSubscription[] {
  return db.select({
    id: pushSubscription.id,
    endpoint: pushSubscription.endpoint,
    p256dh: pushSubscription.p256dh,
    auth: pushSubscription.auth,
  }).from(pushSubscription).all()
}

export function markPushSuccess(id: string, at = Date.now()): void {
  db.update(pushSubscription).set({ lastSuccessAt: at, lastError: null, updatedAt: at })
    .where(eq(pushSubscription.id, id)).run()
}

export function markPushFailure(id: string, error: string, at = Date.now()): void {
  db.update(pushSubscription).set({ lastError: error.slice(0, 1_000), updatedAt: at })
    .where(eq(pushSubscription.id, id)).run()
}

export function pushSubscriptionSummary(): { count: number; lastError: string | null } {
  const total = db.select({ count: count() }).from(pushSubscription).get()?.count ?? 0
  const latestError = db.select({ error: pushSubscription.lastError }).from(pushSubscription)
    .where(isNotNull(pushSubscription.lastError))
    .orderBy(desc(pushSubscription.updatedAt)).limit(1).get()?.error ?? null
  return { count: total, lastError: latestError }
}
