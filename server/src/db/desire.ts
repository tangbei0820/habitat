/** Core-4 Desire 影子层仓储：只保存结构化倾向、候选与审计，不保存聊天原文。 */
import type {
  DesireAuditRecord,
  DesireCandidate,
  DesireDimension,
  DesireImpulse,
  DesireSnapshot,
  DesireSource,
} from '@shared/types.js'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from './index.js'
import { desireAudit, desireState } from './schema.js'

const PRIMARY_ID = 'primary'
const AUDIT_KEEP = 5_000

export const DESIRE_DIMENSIONS: DesireDimension[] = [
  'attachment', 'curiosity', 'reflection', 'duty', 'social', 'fatigue', 'libido', 'stress',
]

export const DEFAULT_DESIRE_VALUES: Record<DesireDimension, number> = {
  attachment: 0.5,
  curiosity: 0.5,
  reflection: 0.5,
  duty: 0.5,
  social: 0.5,
  fatigue: 0.5,
  libido: 0.5,
  stress: 0.5,
}

function cloneValues(values: Record<DesireDimension, number>): Record<DesireDimension, number> {
  return { ...values }
}

function toSnapshot(row: typeof desireState.$inferSelect): DesireSnapshot {
  return {
    mode: 'shadow',
    values: { ...DEFAULT_DESIRE_VALUES, ...(row.valuesJson as Record<string, number>) } as Record<DesireDimension, number>,
    impulses: row.impulsesJson as DesireImpulse[],
    candidates: row.candidatesJson as DesireCandidate[],
    lastObservedAt: row.lastObservedAt,
    updatedAt: row.updatedAt,
  }
}

export function getDesireSnapshot(): DesireSnapshot | null {
  const row = db.select().from(desireState).where(eq(desireState.id, PRIMARY_ID)).get()
  return row === undefined ? null : toSnapshot(row)
}

export function saveDesireSnapshot(snapshot: DesireSnapshot): void {
  db.insert(desireState).values({
    id: PRIMARY_ID,
    valuesJson: cloneValues(snapshot.values),
    impulsesJson: snapshot.impulses,
    candidatesJson: snapshot.candidates,
    lastObservedAt: snapshot.lastObservedAt,
    updatedAt: snapshot.updatedAt,
  }).onConflictDoUpdate({
    target: desireState.id,
    set: {
      valuesJson: cloneValues(snapshot.values),
      impulsesJson: snapshot.impulses,
      candidatesJson: snapshot.candidates,
      lastObservedAt: snapshot.lastObservedAt,
      updatedAt: snapshot.updatedAt,
    },
  }).run()
}

export function appendDesireAudit(input: {
  source: DesireSource
  signal: string
  delta: Partial<Record<DesireDimension, number>>
  values: Record<DesireDimension, number>
  refId?: string | null
  at?: number
}): DesireAuditRecord {
  const at = input.at ?? Date.now()
  const result = db.insert(desireAudit).values({
    source: input.source,
    signal: input.signal,
    deltaJson: input.delta,
    valuesJson: cloneValues(input.values),
    refId: input.refId ?? null,
    at,
  }).run()
  db.run(sql`DELETE FROM desire_audit WHERE id <= (SELECT COALESCE(MAX(id), 0) - ${AUDIT_KEEP} FROM desire_audit)`)
  return {
    id: Number(result.lastInsertRowid),
    source: input.source,
    signal: input.signal,
    delta: input.delta,
    values: cloneValues(input.values),
    refId: input.refId ?? null,
    at,
  }
}

export function listDesireAudits(limit = 50): DesireAuditRecord[] {
  return db.select().from(desireAudit)
    .orderBy(desc(desireAudit.at), desc(desireAudit.id))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all()
    .map((row) => ({
      id: row.id,
      source: row.source as DesireSource,
      signal: row.signal,
      delta: row.deltaJson as Partial<Record<DesireDimension, number>>,
      values: row.valuesJson as Record<DesireDimension, number>,
      refId: row.refId,
      at: row.at,
    }))
}
