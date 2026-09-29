import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { MemoryWriteAuditRecord, MemoryWriteAuditStatus } from '@shared/types.js'
import type { MemoryWriteInput } from '@shared/providers.js'
import { db } from './index.js'
import { memoryWriteAudit, type MemoryWriteAuditRow } from './schema.js'

const PREVIEW_LIMIT = 180
const RESULT_LIMIT = 2_000

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sourceOf(input: MemoryWriteInput): Record<string, unknown> {
  return input.source === undefined ? { kind: 'manual' } : { ...input.source }
}

function normalized(input: MemoryWriteInput): { mode: 'new' | 'correction'; content: string; kind: string; name: string | null; tags: string | null; correctionOf: string | null; source: Record<string, unknown>; contentHash: string; dedupKey: string } {
  const content = input.content.trim()
  const mode = input.mode ?? 'new'
  const kind = input.kind ?? 'memory'
  const name = input.name?.trim() || null
  const tags = input.tags?.trim() || null
  const correctionOf = input.correctionOf?.trim() || null
  const contentHash = hash(content)
  // 来源不进 dedup key：同一条事实从同一会话重试时不能重复 hold。
  const dedupKey = hash(JSON.stringify({ mode, contentHash, kind, name, tags, correctionOf }))
  return { mode, content, kind, name, tags, correctionOf, source: sourceOf(input), contentHash, dedupKey }
}

function toRecord(row: MemoryWriteAuditRow): MemoryWriteAuditRecord {
  return {
    id: row.id,
    status: row.status as MemoryWriteAuditStatus,
    mode: row.mode as 'new' | 'correction',
    dedupKey: row.dedupKey,
    contentPreview: row.contentPreview,
    kind: row.kind,
    name: row.name,
    tags: row.tags,
    source: row.sourceJson,
    correctionOf: row.correctionOf,
    providerResult: row.providerResult,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }
}

export type MemoryWriteReservation =
  | { kind: 'reserved'; record: MemoryWriteAuditRecord }
  | { kind: 'duplicate'; record: MemoryWriteAuditRecord }

/** 为一次 hold 预留唯一去重键；失败记录允许原调用方重试，已写入记录绝不重复执行。 */
export function reserveMemoryWrite(input: MemoryWriteInput, now = Date.now()): MemoryWriteReservation {
  const value = normalized(input)
  const inserted = db.insert(memoryWriteAudit).values({
    id: `mwa-${randomUUID()}`,
    status: 'writing',
    mode: value.mode,
    dedupKey: value.dedupKey,
    contentHash: value.contentHash,
    contentPreview: clip(value.content, PREVIEW_LIMIT),
    kind: value.kind,
    name: value.name,
    tags: value.tags,
    sourceJson: value.source,
    correctionOf: value.correctionOf,
    providerResult: null,
    error: null,
    createdAt: now,
    completedAt: null,
  }).onConflictDoNothing({ target: memoryWriteAudit.dedupKey }).run()

  const row = db.select().from(memoryWriteAudit).where(eq(memoryWriteAudit.dedupKey, value.dedupKey)).get()
  if (row === undefined) throw new Error('记忆写入审计预留失败')
  if (inserted.changes > 0) return { kind: 'reserved', record: toRecord(row) }
  if (row.status === 'failed') {
    const changed = db.update(memoryWriteAudit)
      .set({ status: 'writing', error: null, providerResult: null, completedAt: null })
      .where(and(eq(memoryWriteAudit.id, row.id), eq(memoryWriteAudit.status, 'failed')))
      .run().changes
    if (changed > 0) return { kind: 'reserved', record: toRecord({ ...row, status: 'writing', error: null, providerResult: null, completedAt: null }) }
  }
  return { kind: 'duplicate', record: toRecord(row) }
}

export function markMemoryWriteWritten(id: string, providerResult: string, at = Date.now()): MemoryWriteAuditRecord | null {
  const changed = db.update(memoryWriteAudit)
    .set({ status: 'written', providerResult: clip(providerResult, RESULT_LIMIT), error: null, completedAt: at })
    .where(and(eq(memoryWriteAudit.id, id), eq(memoryWriteAudit.status, 'writing')))
    .run().changes
  if (changed === 0) return null
  const row = db.select().from(memoryWriteAudit).where(eq(memoryWriteAudit.id, id)).get()
  return row === undefined ? null : toRecord(row)
}

export function markMemoryWriteFailed(id: string, error: string, at = Date.now()): MemoryWriteAuditRecord | null {
  const changed = db.update(memoryWriteAudit)
    .set({ status: 'failed', error: clip(error, RESULT_LIMIT), completedAt: at })
    .where(and(eq(memoryWriteAudit.id, id), eq(memoryWriteAudit.status, 'writing')))
    .run().changes
  if (changed === 0) return null
  const row = db.select().from(memoryWriteAudit).where(eq(memoryWriteAudit.id, id)).get()
  return row === undefined ? null : toRecord(row)
}

export function listMemoryWriteAudits(limit = 20): MemoryWriteAuditRecord[] {
  return db.select().from(memoryWriteAudit)
    .orderBy(desc(memoryWriteAudit.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
    .all()
    .map(toRecord)
}
