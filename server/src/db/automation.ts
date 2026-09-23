/** Phase 3B 主动行为策略、运行态与 BudgetGuard 预约仓储。 */
import type {
  AutomationKind,
  AutomationPolicy,
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationRuntimeState,
} from '@shared/types.js'
import { desc, eq } from 'drizzle-orm'
import { db } from './index.js'
import { automationPolicy, automationRun, automationState } from './schema.js'

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

export function markWakeSent(at = Date.now()): void {
  ensureRuntimeState(at)
  const current = getAutomationRuntimeState()
  db.update(automationState)
    .set({ lastWakeAt: at, unansweredWakes: current.unansweredWakes + 1, updatedAt: at })
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
