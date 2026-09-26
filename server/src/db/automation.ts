/** Phase 3B 主动行为策略、运行态与 BudgetGuard 预约仓储。 */
import type {
  AutomationActionRecord,
  AutomationActionType,
  AutomationKind,
  AutomationPolicy,
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationRuntimeState,
} from '@shared/types.js'
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from './index.js'
import { automationAction, automationPolicy, automationRun, automationState } from './schema.js'

const PRIMARY_ID = 'primary'

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  enabled: false,
  wakeEnabled: false,
  solitudeEnabled: false,
  dreamEnabled: false,
  timeZone: 'Asia/Shanghai',
  quietStart: '23:00',
  quietEnd: '08:00',
  minSilenceMinutes: 120,
  wakeCooldownMinutes: 360,
  maxUnansweredWakes: 1,
  maxDailyProactiveRuns: 3,
  maxDailyApiCalls: 100,
  maxDailyTokens: 100_000,
  maxDailyCostCents: null,
  solitudeStart: '23:00',
  solitudeEnd: '08:00',
  triggerWords: [],
  dreamSeed: null,
  surfEnabled: false,
}

function ensureRuntimeState(now = Date.now()): void {
  db.insert(automationState)
    .values({ id: PRIMARY_ID, unansweredWakes: 0, updatedAt: now })
    .onConflictDoNothing()
    .run()
}

export function getAutomationPolicy(): AutomationPolicy {
  const row = db.select().from(automationPolicy).where(eq(automationPolicy.id, PRIMARY_ID)).get()
  return row?.policyJson ?? { ...DEFAULT_AUTOMATION_POLICY }
}

export function saveAutomationPolicy(policy: AutomationPolicy, now = Date.now()): AutomationPolicy {
  db.insert(automationPolicy)
    .values({ id: PRIMARY_ID, policyJson: policy, updatedAt: now })
    .onConflictDoUpdate({
      target: automationPolicy.id,
      set: { policyJson: policy, updatedAt: now },
    })
    .run()
  return policy
}

export function getAutomationRuntimeState(): AutomationRuntimeState {
  ensureRuntimeState()
  const row = db.select().from(automationState).where(eq(automationState.id, PRIMARY_ID)).get()
  if (row === undefined) throw new Error('automation_state 初始化失败')
  return {
    lastCounterpartAt: row.lastCounterpartAt,
    lastWakeAt: row.lastWakeAt,
    unansweredWakes: row.unansweredWakes,
    lastSolitudeDayKey: row.lastSolitudeDayKey,
    lastDreamDayKey: row.lastDreamDayKey,
    updatedAt: row.updatedAt,
  }
}

export function noteCounterpartActivity(at = Date.now()): void {
  ensureRuntimeState(at)
  db.update(automationState)
    .set({ lastCounterpartAt: at, unansweredWakes: 0, updatedAt: at })
    .where(eq(automationState.id, PRIMARY_ID))
    .run()
}

/**
 * 记一次唤醒决策完成（Phase 7B）。
 *
 * `disturbed` = 本轮是否真的打扰了用户（存在 message 行动）：
 * - `lastWakeAt` **总是**推进 —— no-op 也是一次决策，冷却必须走，
 *   否则调度器每分钟都会重新 reserve，把每日主动次数烧在空转上；
 * - `unansweredWakes` 只在真的打扰时 +1 —— 「连续主动但未回复」数的是打扰，
 *   小栖安静地写篇日记不该被记成「打扰未获回应」。
 */
export function markWakeDecision(at: number, disturbed: boolean): void {
  ensureRuntimeState(at)
  const current = getAutomationRuntimeState()
  db.update(automationState)
    .set({
      lastWakeAt: at,
      unansweredWakes: disturbed ? current.unansweredWakes + 1 : current.unansweredWakes,
      updatedAt: at,
    })
    .where(eq(automationState.id, PRIMARY_ID))
    .run()
}

export function markSolitudeCompleted(dayKey: string, at = Date.now()): void {
  ensureRuntimeState(at)
  db.update(automationState)
    .set({ lastSolitudeDayKey: dayKey, updatedAt: at })
    .where(eq(automationState.id, PRIMARY_ID))
    .run()
}

export function markDreamCompleted(dayKey: string, at = Date.now()): void {
  ensureRuntimeState(at)
  db.update(automationState)
    .set({ lastDreamDayKey: dayKey, updatedAt: at })
    .where(eq(automationState.id, PRIMARY_ID))
    .run()
}

export interface NewAutomationRun {
  id: string
  kind: AutomationKind
  status: AutomationRunStatus
  reason?: string | null
  reservedTokens?: number
  dayKey: string
  at: number
}

export function insertAutomationRun(input: NewAutomationRun): void {
  db.insert(automationRun).values({
    id: input.id,
    kind: input.kind,
    status: input.status,
    reason: input.reason ?? null,
    reservedTokens: input.reservedTokens ?? 0,
    dayKey: input.dayKey,
    at: input.at,
  }).run()
}

export function finishAutomationRun(
  id: string,
  status: Exclude<AutomationRunStatus, 'reserved'>,
  reason: string | null,
  usageRecordId: number | null,
  finishedAt = Date.now(),
): void {
  db.update(automationRun)
    .set({ status, reason, usageRecordId, finishedAt })
    .where(eq(automationRun.id, id))
    .run()
}

export function listAutomationRuns(limit = 50): AutomationRunRecord[] {
  return db.select().from(automationRun).orderBy(desc(automationRun.at)).limit(limit).all().map((row) => ({
    id: row.id,
    kind: row.kind as AutomationKind,
    status: row.status as AutomationRunStatus,
    reason: row.reason,
    usageRecordId: row.usageRecordId,
    dayKey: row.dayKey,
    at: row.at,
    finishedAt: row.finishedAt,
  }))
}

export { automationRun }

/* ------------------------------------------------------------------ 行动审计（Phase 7B） */

export interface NewAutomationAction {
  runId: string
  idx: number
  type: AutomationActionType
  status: 'completed' | 'failed' | 'skipped'
  reason?: string | null
  refId?: string | null
  at: number
}

/**
 * 落一条行动审计。**幂等**：`(runId, idx)` 已存在时返回 `false` 且不写 ——
 * 决策输出重放（上游重试、调度器重入）不会把同一条留言写两遍。
 */
export function insertAutomationAction(input: NewAutomationAction): boolean {
  const result = db
    .insert(automationAction)
    .values({
      runId: input.runId,
      idx: input.idx,
      type: input.type,
      status: input.status,
      reason: input.reason ?? null,
      refId: input.refId ?? null,
      at: input.at,
    })
    .onConflictDoNothing({ target: [automationAction.runId, automationAction.idx] })
    .run()
  return result.changes > 0
}

export function listAutomationActionsByRun(runId: string): AutomationActionRecord[] {
  return db
    .select()
    .from(automationAction)
    .where(eq(automationAction.runId, runId))
    .orderBy(asc(automationAction.idx))
    .all()
    .map((row) => ({
      id: row.id,
      runId: row.runId,
      idx: row.idx,
      type: row.type as AutomationActionType,
      status: row.status as 'completed' | 'failed' | 'skipped',
      reason: row.reason,
      refId: row.refId,
      at: row.at,
    }))
}

/** 给 `listAutomationRuns` 用：把最近的行动按 run 聚起来（一次查询，别 N+1） */
export function listRecentAutomationActions(limit: number): Map<string, AutomationActionRecord[]> {
  const rows = db
    .select()
    .from(automationAction)
    .orderBy(desc(automationAction.at), asc(automationAction.idx))
    .limit(limit)
    .all()
  const grouped = new Map<string, AutomationActionRecord[]>()
  for (const row of rows) {
    const record: AutomationActionRecord = {
      id: row.id,
      runId: row.runId,
      idx: row.idx,
      type: row.type as AutomationActionType,
      status: row.status as 'completed' | 'failed' | 'skipped',
      reason: row.reason,
      refId: row.refId,
      at: row.at,
    }
    const bucket = grouped.get(row.runId)
    if (bucket === undefined) grouped.set(row.runId, [record])
    else bucket.push(record)
  }
  return grouped
}

/** 行动执行器的幂等查重：这个 run 的第 idx 个行动是否已经处理过 */
export function hasAutomationAction(runId: string, idx: number): boolean {
  return db
    .select({ id: automationAction.id })
    .from(automationAction)
    .where(and(eq(automationAction.runId, runId), eq(automationAction.idx, idx)))
    .get() !== undefined
}
