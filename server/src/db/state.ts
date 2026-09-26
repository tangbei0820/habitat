/** Eventide 状态快照仓储：Node 持久化，Python sidecar 只做纯计算。 */
import type { BodyStateSnapshot } from '@shared/types.js'
import { eq, sql } from 'drizzle-orm'
import { db } from './index.js'
import { bodyStateSnapshot, eventideHistory } from './schema.js'

const PRIMARY_STATE_ID = 'primary'
/** 历史快照保留上限：按 3B 的调用频率，2000 行足够覆盖数月，超出裁最旧的。 */
const HISTORY_KEEP = 2_000

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
  appendEventideHistory(snapshot)
}

/**
 * 历史快照追加（Phase 7A 状态页）。与主快照同写：同一时刻重复推进时
 * `settled_at` 唯一约束落成「覆盖」，不会在趋势里堆出同刻多点。
 * 写入顺手裁剪超限旧行 —— 频率是「每轮对话 / 每次调度 tick」级，不值得定时器。
 */
function appendEventideHistory(snapshot: BodyStateSnapshot): void {
  db.insert(eventideHistory)
    .values({
      stateJson: snapshot.state,
      payload: snapshot.payload,
      settledAt: snapshot.settledAt,
    })
    .onConflictDoUpdate({
      target: eventideHistory.settledAt,
      set: { stateJson: snapshot.state, payload: snapshot.payload },
    })
    .run()
  db.run(
    sql`DELETE FROM eventide_history WHERE id <= (SELECT COALESCE(MAX(id), 0) - ${HISTORY_KEEP} FROM eventide_history)`,
  )
}
