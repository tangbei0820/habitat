/** Phase 4 价格快照：只追加版本，并只给尚未定价的历史调用补价。 */
import { randomUUID } from 'node:crypto'
import type { PriceSnapshotRecord } from '@shared/types.js'
import { desc, eq, isNull } from 'drizzle-orm'
import { db } from './index.js'
import { apiProfile, priceSnapshot, usageRecord } from './schema.js'

function rowToRecord(row: typeof priceSnapshot.$inferSelect): PriceSnapshotRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    promptCentsPerMillion: row.promptCentsPerMillion,
    completionCentsPerMillion: row.completionCentsPerMillion,
    validFrom: row.validFrom,
    createdAt: row.createdAt,
  }
}

export function listPriceSnapshots(): PriceSnapshotRecord[] {
  return db.select().from(priceSnapshot)
    .orderBy(desc(priceSnapshot.validFrom), desc(priceSnapshot.createdAt))
    .all()
    .map(rowToRecord)
}

export function createPriceSnapshot(input: Omit<PriceSnapshotRecord, 'id' | 'createdAt'>): {
  snapshot: PriceSnapshotRecord
  repriced: number
} {
  const now = Date.now()
  const snapshot: PriceSnapshotRecord = { ...input, id: randomUUID(), createdAt: now }
  db.insert(priceSnapshot).values(snapshot).run()
  return { snapshot, repriced: repriceUnpricedUsage() }
}

export function repriceUnpricedUsage(): number {
  const profiles = new Map(db.select({ id: apiProfile.id, provider: apiProfile.provider }).from(apiProfile).all()
    .map((row) => [row.id, row.provider]))
  const snapshots = db.select().from(priceSnapshot)
    .orderBy(desc(priceSnapshot.validFrom), desc(priceSnapshot.createdAt))
    .all()
  const rows = db.select().from(usageRecord).where(isNull(usageRecord.priceSnapshotId)).all()
  let repriced = 0
  db.transaction((tx) => {
    for (const row of rows) {
      const provider = profiles.get(row.profileId)
      if (provider === undefined) continue
      const snapshot = snapshots.find((candidate) => (
        candidate.provider === provider
        && candidate.model === row.model
        && candidate.validFrom <= row.at
      ))
      if (snapshot === undefined) continue
      const cost = Math.ceil((
        row.promptTokens * snapshot.promptCentsPerMillion
        + row.completionTokens * snapshot.completionCentsPerMillion
      ) / 1_000_000)
      tx.update(usageRecord).set({ cost, priceSnapshotId: snapshot.id }).where(eq(usageRecord.id, row.id)).run()
      repriced += 1
    }
  })
  return repriced
}
