/** Life 页面查询模型：只聚合服务端事实表，不反查前端聊天库。 */
import type { LifeDaySummary, LifeLedgerView, LifeMonthSummary, UsageBreakdown } from '@shared/types.js'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from './index.js'
import { eventLog, usageRecord } from './schema.js'
import { getAutomationPolicy } from './automation.js'
import { listPriceSnapshots } from './pricing.js'
import { getWallet, listWalletTransactions } from './wallet.js'

function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number)
  if (number === 12) return `${year + 1}-01`
  return `${year}-${String(number + 1).padStart(2, '0')}`
}

function emptyDay(dayKey: string): LifeDaySummary {
  return {
    dayKey,
    eventCount: 0,
    failedEventCount: 0,
    apiCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    pricedCostCents: 0,
    unpricedCalls: 0,
  }
}

function addUsage(target: LifeDaySummary, row: typeof usageRecord.$inferSelect): void {
  target.apiCalls += 1
  target.promptTokens += row.promptTokens
  target.completionTokens += row.completionTokens
  target.totalTokens += row.totalTokens
  if (row.cost === null) target.unpricedCalls += 1
  else target.pricedCostCents += row.cost
}

export function getLifeMonthSummary(month: string): LifeMonthSummary {
  const end = nextMonth(month)
  const days = new Map<string, LifeDaySummary>()
  for (const row of db.select().from(eventLog).where(and(gte(eventLog.dayKey, `${month}-01`), lt(eventLog.dayKey, `${end}-01`))).all()) {
    const day = days.get(row.dayKey) ?? emptyDay(row.dayKey)
    day.eventCount += 1
    if (row.eventType.endsWith('.failed')) day.failedEventCount += 1
    days.set(row.dayKey, day)
  }
  for (const row of db.select().from(usageRecord).where(and(gte(usageRecord.dayKey, `${month}-01`), lt(usageRecord.dayKey, `${end}-01`))).all()) {
    const day = days.get(row.dayKey) ?? emptyDay(row.dayKey)
    addUsage(day, row)
    days.set(row.dayKey, day)
  }
  const ordered = [...days.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  const totals = emptyDay('')
  for (const day of ordered) {
    totals.eventCount += day.eventCount
    totals.failedEventCount += day.failedEventCount
    totals.apiCalls += day.apiCalls
    totals.promptTokens += day.promptTokens
    totals.completionTokens += day.completionTokens
    totals.totalTokens += day.totalTokens
    totals.pricedCostCents += day.pricedCostCents
    totals.unpricedCalls += day.unpricedCalls
  }
  const { dayKey: _dayKey, ...totalValues } = totals
  return { month, timeZone: getAutomationPolicy().timeZone, days: ordered, totals: totalValues }
}

function breakdown(rows: Array<typeof usageRecord.$inferSelect>, keyOf: (row: typeof usageRecord.$inferSelect) => string): UsageBreakdown[] {
  const groups = new Map<string, UsageBreakdown>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key) ?? { key, calls: 0, totalTokens: 0, pricedCostCents: 0, unpricedCalls: 0 }
    group.calls += 1
    group.totalTokens += row.totalTokens
    if (row.cost === null) group.unpricedCalls += 1
    else group.pricedCostCents += row.cost
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key))
}

export function getLifeLedger(month: string): LifeLedgerView {
  const end = nextMonth(month)
  const rows = db.select().from(usageRecord).where(and(
    gte(usageRecord.dayKey, `${month}-01`),
    lt(usageRecord.dayKey, `${end}-01`),
  )).orderBy(desc(usageRecord.at)).all()
  return {
    summary: getLifeMonthSummary(month),
    byService: breakdown(rows, (row) => row.service),
    byModel: breakdown(rows, (row) => `${row.profileId} · ${row.model}`),
    priceSnapshots: listPriceSnapshots(),
    wallet: getWallet(),
    walletTransactions: listWalletTransactions(100),
  }
}

export function getLifeDay(dayKey: string): {
  events: Array<typeof eventLog.$inferSelect>
  usage: Array<typeof usageRecord.$inferSelect>
} {
  return {
    events: db.select().from(eventLog).where(eq(eventLog.dayKey, dayKey)).orderBy(desc(eventLog.at)).all(),
    usage: db.select().from(usageRecord).where(eq(usageRecord.dayKey, dayKey)).orderBy(desc(usageRecord.at)).all(),
  }
}
