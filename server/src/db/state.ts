/** Eventide 状态快照仓储：Node 持久化，Python sidecar 只做纯计算。 */
import type { BodyStateSnapshot } from '@shared/types.js'
import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { bodyStateSnapshot } from './schema.js'

const PRIMARY_STATE_ID = 'primary'

export function getBodyStateSnapshot(): BodyStateSnapshot | null {
  const row = db
    .select()
    .from(bodyStateSnapshot)
    .where(eq(bodyStateSnapshot.id, PRIMARY_STATE_ID))
    .get()
  if (row === undefined) return null
  return {
    state: row.stateJson,
    stateCard: row.stateCard,
    payload: row.payload,
    settledAt: row.settledAt,
  }
}

export function saveBodyStateSnapshot(snapshot: BodyStateSnapshot): void {
  db.insert(bodyStateSnapshot)
    .values({
      id: PRIMARY_STATE_ID,
      stateJson: snapshot.state,
      stateCard: snapshot.stateCard,
      payload: snapshot.payload,
      settledAt: snapshot.settledAt,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: bodyStateSnapshot.id,
      set: {
        stateJson: snapshot.state,
        stateCard: snapshot.stateCard,
        payload: snapshot.payload,
        settledAt: snapshot.settledAt,
        updatedAt: Date.now(),
      },
    })
    .run()
}
