/** EventLog、通知收件箱与 AI 私有独处记录。 */
import { randomUUID } from 'node:crypto'
import type { EventLogRecord, NotificationKind, NotificationRecord, SolitudeEntry } from '@shared/types.js'
import { desc, eq } from 'drizzle-orm'
import { dayKeyOf } from './usage.js'
import { db } from './index.js'
import { eventLog, notification, solitudeEntry } from './schema.js'

function hourKeyOf(at: number): string {
  const date = new Date(at)
  return `${dayKeyOf(at)}T${String(date.getHours()).padStart(2, '0')}`
}

export function appendEventLog(
  eventType: string,
  metrics: Record<string, unknown> = {},
  refId: string | null = null,
  at = Date.now(),
): number {
  const result = db.insert(eventLog).values({
    eventType,
    dayKey: dayKeyOf(at),
    hourKey: hourKeyOf(at),
    metricsJson: metrics,
    refId,
    at,
  }).run()
  return Number(result.lastInsertRowid)
}

export function listEventLogs(limit = 100): EventLogRecord[] {
  return db.select().from(eventLog).orderBy(desc(eventLog.id)).limit(limit).all().map((row) => ({
    id: row.id,
    eventType: row.eventType,
    dayKey: row.dayKey,
    hourKey: row.hourKey,
    metrics: row.metricsJson,
    refId: row.refId,
    at: row.at,
  }))
}

export function createNotification(
  kind: NotificationKind,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {},
  createdAt = Date.now(),
): NotificationRecord {
  const record: NotificationRecord = {
    id: randomUUID(), kind, title, body, metadata, readAt: null, createdAt,
  }
  db.insert(notification).values({
    id: record.id,
    kind,
    title,
    body,
    metadataJson: metadata,
    createdAt,
  }).run()
  return record
}

export function listNotifications(limit = 50): NotificationRecord[] {
  return db.select().from(notification).orderBy(desc(notification.createdAt)).limit(limit).all().map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    metadata: row.metadataJson,
    readAt: row.readAt,
    createdAt: row.createdAt,
  }))
}

export function markNotificationRead(id: string, readAt = Date.now()): boolean {
  return db.update(notification).set({ readAt }).where(eq(notification.id, id)).run().changes > 0
}

export function createSolitudeEntry(
  body: string,
  metadata: Record<string, unknown> = {},
  createdAt = Date.now(),
): SolitudeEntry {
  const record: SolitudeEntry = { id: randomUUID(), body, metadata, createdAt }
  db.insert(solitudeEntry).values({
    id: record.id,
    body,
    metadataJson: metadata,
    createdAt,
  }).run()
  return record
}

export function listSolitudeEntries(limit = 50): SolitudeEntry[] {
  return db.select().from(solitudeEntry).orderBy(desc(solitudeEntry.createdAt)).limit(limit).all().map((row) => ({
    id: row.id,
    body: row.body,
    metadata: row.metadataJson,
    createdAt: row.createdAt,
  }))
}
