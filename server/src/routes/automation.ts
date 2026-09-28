/** Phase 3B 主动行为、通知、独处、事件日志与钱包接口。 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { AutomationPolicy, NotificationCategory, NotificationRecord } from '@shared/types.js'
import {
  getAutomationPolicy,
  getAutomationRuntimeState,
  listAutomationRuns,
  listRecentAutomationActions,
  saveAutomationPolicy,
} from '../db/automation.js'
import { getSurfFeeds, setSurfFeeds } from '../db/surf.js'
import {
  listEventLogs,
  listNotifications,
  listSolitudeEntries,
  markAllNotificationsRead,
  markNotificationRead,
} from '../db/activity.js'
import { getWallet, listWalletTransactions, transactWallet } from '../db/wallet.js'
import { RequestError } from '../lib/errors.js'
import { parseClock } from '../lib/time-window.js'
import type { AutomationService } from '../services/automation.js'
import { getNotificationPreferences, NOTIFICATION_CATEGORIES, saveNotificationPreferences, type NotificationPreferencesPatch } from '../db/notification-preferences.js'
import { getPushStatus, sendWebPush } from '../services/push.js'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

function limitOf(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new RequestError(ErrorCodes.BadRequest, `limit 必须是 1..${max} 的整数`)
  }
  return parsed
}

function booleanField(body: Record<string, unknown>, key: keyof AutomationPolicy, current: boolean): boolean {
  const value = body[key]
  if (value === undefined) return current
  if (typeof value !== 'boolean') throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是布尔值`)
  return value
}

function integerField(
  body: Record<string, unknown>,
  key: keyof AutomationPolicy,
  current: number,
  min: number,
  max: number,
): number {
  const value = body[key]
  if (value === undefined) return current
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 ${min}..${max} 的整数`)
  }
  return value as number
}

function clockField(body: Record<string, unknown>, key: keyof AutomationPolicy, current: string): string {
  const value = body[key]
  if (value === undefined) return current
  if (typeof value !== 'string') throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 HH:mm`)
  try { parseClock(value) } catch { throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是合法 HH:mm`) }
  return value
}

function parsePolicyPatch(raw: unknown): AutomationPolicy {
  const body = record(raw)
  const current = getAutomationPolicy()
  const timeZone = body.timeZone === undefined ? current.timeZone : body.timeZone
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw new RequestError(ErrorCodes.BadRequest, 'timeZone 必须是 IANA 时区')
  }
  try { new Intl.DateTimeFormat('en', { timeZone }).format() } catch {
    throw new RequestError(ErrorCodes.BadRequest, 'timeZone 必须是合法 IANA 时区')
  }
  const rawWords = body.triggerWords === undefined ? current.triggerWords : body.triggerWords
  if (!Array.isArray(rawWords) || rawWords.length > 30 || rawWords.some((word) => typeof word !== 'string' || word.trim() === '' || word.length > 50)) {
    throw new RequestError(ErrorCodes.BadRequest, 'triggerWords 必须是最多 30 个非空短字符串')
  }
  const triggerWords = [...new Set(rawWords.map((word) => String(word).trim()))]
  let dreamSeed = current.dreamSeed
  if (body.dreamSeed !== undefined) {
    if (body.dreamSeed !== null && (typeof body.dreamSeed !== 'string' || body.dreamSeed.trim() === '' || body.dreamSeed.length > 500)) {
      throw new RequestError(ErrorCodes.BadRequest, 'dreamSeed 必须为 null 或 1..500 字符')
    }
    dreamSeed = body.dreamSeed === null ? null : body.dreamSeed.trim()
  }
  let maxDailyCostCents = current.maxDailyCostCents
  if (body.maxDailyCostCents !== undefined) {
    if (body.maxDailyCostCents !== null && (!Number.isInteger(body.maxDailyCostCents) || (body.maxDailyCostCents as number) < 1)) {
      throw new RequestError(ErrorCodes.BadRequest, 'maxDailyCostCents 必须为 null 或正整数')
    }
    maxDailyCostCents = body.maxDailyCostCents as number | null
  }
  return {
    enabled: booleanField(body, 'enabled', current.enabled),
    wakeEnabled: booleanField(body, 'wakeEnabled', current.wakeEnabled),
    solitudeEnabled: booleanField(body, 'solitudeEnabled', current.solitudeEnabled),
    dreamEnabled: booleanField(body, 'dreamEnabled', current.dreamEnabled),
    surfEnabled: booleanField(body, 'surfEnabled', current.surfEnabled),
    timeZone,
    quietStart: clockField(body, 'quietStart', current.quietStart),
    quietEnd: clockField(body, 'quietEnd', current.quietEnd),
    minSilenceMinutes: integerField(body, 'minSilenceMinutes', current.minSilenceMinutes, 0, 43_200),
    wakeCooldownMinutes: integerField(body, 'wakeCooldownMinutes', current.wakeCooldownMinutes, 0, 43_200),
    maxUnansweredWakes: integerField(body, 'maxUnansweredWakes', current.maxUnansweredWakes, 1, 100),
    maxDailyProactiveRuns: integerField(body, 'maxDailyProactiveRuns', current.maxDailyProactiveRuns, 1, 100),
    maxDailyApiCalls: integerField(body, 'maxDailyApiCalls', current.maxDailyApiCalls, 1, 10_000),
    maxDailyTokens: integerField(body, 'maxDailyTokens', current.maxDailyTokens, 100, 100_000_000),
    maxDailyCostCents,
    solitudeStart: clockField(body, 'solitudeStart', current.solitudeStart),
    solitudeEnd: clockField(body, 'solitudeEnd', current.solitudeEnd),
    triggerWords,
    dreamSeed,
  }
}

function parseNotificationPreferencesPatch(raw: unknown): NotificationPreferencesPatch {
  const body = record(raw)
  const patch: NotificationPreferencesPatch = {}
  for (const key of ['enabled', 'quietHoursEnabled'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是布尔值`)
      patch[key] = body[key] as boolean
    }
  }
  for (const key of ['quietStart', 'quietEnd'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string') throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 HH:mm`)
      try { parseClock(body[key]) } catch { throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是合法 HH:mm`) }
      patch[key] = body[key]
    }
  }
  if (body.categories !== undefined) {
    const rawCategories = record(body.categories)
    const categories: Partial<Record<NotificationCategory, boolean>> = {}
    for (const key of NOTIFICATION_CATEGORIES) {
      if (rawCategories[key] !== undefined) {
        if (typeof rawCategories[key] !== 'boolean') throw new RequestError(ErrorCodes.BadRequest, `categories.${key} 必须是布尔值`)
        categories[key] = rawCategories[key] as boolean
      }
    }
    patch.categories = categories
  }
  return patch
}

export function registerAutomationRoutes(app: FastifyInstance, service: AutomationService): void {
  app.get('/api/automation', async () => ({
    policy: getAutomationPolicy(),
    runtime: getAutomationRuntimeState(),
  }))
  app.patch('/api/automation', async (request) => ({ policy: saveAutomationPolicy(parsePolicyPatch(request.body)) }))
  app.post('/api/automation/check', async () => ({ results: await service.checkNow() }))
  app.get('/api/automation/runs', async (request) => {
    const limit = limitOf((request.query as Record<string, unknown>).limit, 50, 200)
    const runs = listAutomationRuns(limit)
    // 行动审计按 run 聚合返回（一次查询，避免 N+1）；取的行数与 runs 数量同量级
    const actions = listRecentAutomationActions(limit * 4)
    return {
      runs: runs.map((run) => ({ ...run, ...(actions.get(run.id) === undefined ? {} : { actions: actions.get(run.id) }) })),
    }
  })

  app.get('/api/surf/feeds', async () => ({ feeds: getSurfFeeds() }))
  app.put('/api/surf/feeds', async (request) => {
    const body = record(request.body)
    if (body.feeds !== null && !Array.isArray(body.feeds)) {
      throw new RequestError(ErrorCodes.BadRequest, 'feeds 必须是 URL 数组或 null（恢复默认）')
    }
    try {
      return { feeds: setSurfFeeds(body.feeds as string[] | null) }
    } catch (error) {
      throw new RequestError(ErrorCodes.BadRequest, error instanceof Error ? error.message : String(error))
    }
  })

  app.get('/api/notifications', async (request) => ({
    notifications: listNotifications(limitOf((request.query as Record<string, unknown>).limit, 50, 200)),
  }))
  app.patch('/api/notifications/read-all', async () => ({ updated: markAllNotificationsRead() }))
  app.patch('/api/notifications/:id/read', async (request) => {
    const { id } = request.params as { id: string }
    if (!markNotificationRead(id)) throw new RequestError(ErrorCodes.NotFound, `通知 '${id}' 不存在`)
    return { ok: true }
  })
  app.get('/api/notifications/preferences', async () => ({ preferences: getNotificationPreferences() }))
  app.patch('/api/notifications/preferences', async (request) => ({
    preferences: saveNotificationPreferences(parseNotificationPreferencesPatch(request.body)),
  }))
  app.post('/api/push/test', async () => {
    const status = getPushStatus()
    const test: NotificationRecord = {
      id: `push-test-${randomUUID()}`,
      kind: 'system',
      title: '栖息地测试通知',
      body: '推送通道工作正常。这条测试不会写入通知收件箱。',
      metadata: { category: 'task', test: true },
      readAt: null,
      createdAt: Date.now(),
    }
    const result = await sendWebPush(test, { force: true })
    return { ...result, configured: status.configured, subscriptionCount: status.subscriptionCount }
  })
  app.get('/api/solitude', async (request) => ({
    entries: listSolitudeEntries(limitOf((request.query as Record<string, unknown>).limit, 50, 200)),
  }))
  app.get('/api/events', async (request) => ({
    events: listEventLogs(limitOf((request.query as Record<string, unknown>).limit, 100, 500)),
  }))

  app.get('/api/wallet', async () => ({ wallet: getWallet() }))
  app.get('/api/wallet/transactions', async (request) => ({
    transactions: listWalletTransactions(limitOf((request.query as Record<string, unknown>).limit, 100, 500)),
  }))
  app.post('/api/wallet/transactions', async (request) => {
    const body = record(request.body)
    if (!Number.isInteger(body.delta) || body.delta === 0) throw new RequestError(ErrorCodes.BadRequest, 'delta 必须是非零整数')
    if (typeof body.reason !== 'string' || body.reason.trim() === '' || body.reason.length > 200) {
      throw new RequestError(ErrorCodes.BadRequest, 'reason 必须是 1..200 字符')
    }
    const refType = typeof body.refType === 'string' && body.refType !== '' ? body.refType : null
    const refId = typeof body.refId === 'string' && body.refId !== '' ? body.refId : null
    return { transaction: transactWallet(body.delta as number, body.reason.trim(), refType, refId), wallet: getWallet() }
  })
}
