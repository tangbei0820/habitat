/**
 * 世界书条目 CRUD（Phase 7A · SPEC §9.4.2）。
 *
 * 为什么放服务端而不是 Dexie：世界书的消费方是 Runtime 上下文装配（chat-context.ts），
 * 那件事只发生在服务端 —— 数据放哪，哪里就是权威。
 */
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { WorldbookEntry, WorldbookMode } from '@shared/types.js'
import { db } from './index.js'
import { worldbookEntry, type WorldbookEntryRow } from './schema.js'

function toView(row: WorldbookEntryRow): WorldbookEntry {
  let keys: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.keys)
    if (Array.isArray(parsed)) keys = parsed.filter((k): k is string => typeof k === 'string')
  } catch {
    // 写入端保证过 JSON 合法；这里兜底成空数组而不是让整张列表炸掉
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    keys,
    mode: row.mode,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listWorldbookEntries(): WorldbookEntry[] {
  return db
    .select()
    .from(worldbookEntry)
    .orderBy(asc(worldbookEntry.sortOrder), asc(worldbookEntry.createdAt))
    .all()
    .map(toView)
}

export function listEnabledWorldbookEntries(): WorldbookEntry[] {
  return listWorldbookEntries().filter((entry) => entry.enabled)
}

export function getWorldbookEntry(id: string): WorldbookEntry | null {
  const row = db.select().from(worldbookEntry).where(eq(worldbookEntry.id, id)).get()
  return row === undefined ? null : toView(row)
}

export interface WorldbookWrite {
  title: string
  content: string
  keys: string[]
  mode: WorldbookMode
  enabled: boolean
  sortOrder: number
}

export function createWorldbookEntry(input: WorldbookWrite): WorldbookEntry {
  const at = Date.now()
  const row = {
    id: randomUUID(),
    title: input.title,
    content: input.content,
    keys: JSON.stringify(input.keys),
    mode: input.mode,
    enabled: input.enabled,
    sortOrder: input.sortOrder,
    createdAt: at,
    updatedAt: at,
  }
  db.insert(worldbookEntry).values(row).run()
  return toView(db.select().from(worldbookEntry).where(eq(worldbookEntry.id, row.id)).get()!)
}

export function updateWorldbookEntry(id: string, patch: Partial<WorldbookWrite>): WorldbookEntry | null {
  const existing = db.select().from(worldbookEntry).where(eq(worldbookEntry.id, id)).get()
  if (existing === undefined) return null
  const next = {
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    keys: patch.keys === undefined ? existing.keys : JSON.stringify(patch.keys),
    mode: patch.mode ?? existing.mode,
    enabled: patch.enabled ?? existing.enabled,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    updatedAt: Date.now(),
  }
  db.update(worldbookEntry).set(next).where(eq(worldbookEntry.id, id)).run()
  return toView(db.select().from(worldbookEntry).where(eq(worldbookEntry.id, id)).get()!)
}

export function deleteWorldbookEntry(id: string): boolean {
  const result = db.delete(worldbookEntry).where(eq(worldbookEntry.id, id)).run()
  return result.changes > 0
}
