/** Phase 3B BudgetGuard：所有后台 LLM 出口先预约，完成后再核销。 */
import { randomUUID } from 'node:crypto'
import type { AutomationKind, BudgetDecision } from '@shared/types.js'
import { and, count, eq, inArray, isNotNull, sum } from 'drizzle-orm'
import {
  automationRun,
  getAutomationPolicy,
  getAutomationRuntimeState,
} from '../db/automation.js'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'
import { inTimeWindow, localClock } from './time-window.js'

const PROACTIVE_KINDS: AutomationKind[] = ['wake', 'solitude', 'dream']

function denied(reason: string): BudgetDecision {
  return { allowed: false, reason, reservationId: null }
}

export class BudgetGuard {
  reserve(kind: AutomationKind, estimatedTokens: number, now = new Date()): BudgetDecision {
    const policy = getAutomationPolicy()
    const runtime = getAutomationRuntimeState()
    const clock = localClock(now, policy.timeZone)

    if (kind !== 'settlement' && kind !== 'chat') {
      if (!policy.enabled) return denied('主动行为总开关已关闭')
      if (kind === 'wake' && !policy.wakeEnabled) return denied('主动唤醒已关闭')
      if (kind === 'solitude' && !policy.solitudeEnabled) return denied('独处时光已关闭')
      if (kind === 'dream' && !policy.dreamEnabled) return denied('梦境已关闭')
    }
    if (kind === 'wake') {
      if (inTimeWindow(clock.minuteOfDay, policy.quietStart, policy.quietEnd)) return denied('当前处于免打扰时段')
      if (runtime.lastCounterpartAt === null) return denied('尚无用户互动时间')
      if (now.getTime() - runtime.lastCounterpartAt < policy.minSilenceMinutes * 60_000) return denied('用户静默时间不足')
      if (runtime.lastWakeAt !== null && now.getTime() - runtime.lastWakeAt < policy.wakeCooldownMinutes * 60_000) {
        return denied('主动唤醒仍在冷却')
      }
      if (runtime.unansweredWakes >= policy.maxUnansweredWakes) return denied('连续主动消息未获回复，已停止打扰')
    }
    if (kind === 'solitude') {
      if (!inTimeWindow(clock.minuteOfDay, policy.solitudeStart, policy.solitudeEnd)) return denied('不在独处时光窗口')
      if (runtime.lastSolitudeDayKey === clock.dayKey) return denied('今天已完成独处时光')
    }
    if (kind === 'dream') {
      if (policy.dreamSeed === null || policy.dreamSeed.trim() === '') return denied('尚未配置梦种')
      if (runtime.lastDreamDayKey === clock.dayKey) return denied('今天已完成梦境检查')
    }

    return db.transaction((tx) => {
      const usage = tx.select({
        calls: count(),
        tokens: sum(usageRecord.totalTokens),
        cost: sum(usageRecord.cost),
      }).from(usageRecord).where(eq(usageRecord.dayKey, clock.dayKey)).get()
      const pending = tx.select({
        calls: count(),
        tokens: sum(automationRun.reservedTokens),
      }).from(automationRun).where(and(
        eq(automationRun.dayKey, clock.dayKey),
        eq(automationRun.status, 'reserved'),
      )).get()
      const proactive = tx.select({ calls: count() }).from(automationRun).where(and(
        eq(automationRun.dayKey, clock.dayKey),
        inArray(automationRun.kind, PROACTIVE_KINDS),
        // 失败尝试也消耗了真实出口机会；否则上游持续故障时调度器会每分钟重试到无限。
        inArray(automationRun.status, ['reserved', 'completed', 'failed']),
      )).get()

      const usedCalls = usage?.calls ?? 0
      const pendingCalls = pending?.calls ?? 0
      if (usedCalls + pendingCalls >= policy.maxDailyApiCalls) return denied('今日 API 次数预算已用尽')
      const usedTokens = Number(usage?.tokens ?? 0)
      const pendingTokens = Number(pending?.tokens ?? 0)
      if (usedTokens + pendingTokens + estimatedTokens > policy.maxDailyTokens) return denied('今日 Token 预算不足')
      if (policy.maxDailyCostCents !== null) {
        const priced = tx.select({ calls: count() }).from(usageRecord).where(and(
          eq(usageRecord.dayKey, clock.dayKey),
          isNotNull(usageRecord.cost),
        )).get()?.calls ?? 0
        if (usedCalls > priced) return denied('今日存在未定价调用，费用预算不可计算')
        if (Number(usage?.cost ?? 0) >= policy.maxDailyCostCents) return denied('今日费用预算已用尽')
      }
      if (PROACTIVE_KINDS.includes(kind) && (proactive?.calls ?? 0) >= policy.maxDailyProactiveRuns) {
        return denied('今日主动行为次数已用尽')
      }

      const id = randomUUID()
      tx.insert(automationRun).values({
        id,
        kind,
        status: 'reserved',
        reservedTokens: estimatedTokens,
        dayKey: clock.dayKey,
        at: now.getTime(),
      }).run()
      return { allowed: true, reason: null, reservationId: id }
    })
  }
}
