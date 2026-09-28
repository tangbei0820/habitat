import type {
  LifeLedgerView,
  LifeMonthSummary,
  LifeRuntimeView,
  LifeTimelineItem,
  NotificationRecord,
  NotificationPreferences,
  PriceSnapshotRecord,
  PushStatus,
} from '@shared/types'
import { fetchJson } from '../../lib/api'

const jsonHeaders = { 'content-type': 'application/json' }

export interface LifeDayDetail {
  timeline: LifeTimelineItem[]
  events: Array<{
    id: number
    eventType: string
    dayKey: string
    hourKey: string
    metricsJson: Record<string, unknown>
    refId: string | null
    at: number
  }>
  usage: Array<{
    id: number
    profileId: string
    service: string
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost: number | null
    priceSnapshotId: string | null
    dayKey: string
    at: number
  }>
}

export function loadLifeMonth(month: string): Promise<LifeMonthSummary> {
  return fetchJson(`/api/life/month?month=${encodeURIComponent(month)}`)
}

export function loadLifeDay(dayKey: string): Promise<LifeDayDetail> {
  return fetchJson(`/api/life/day/${encodeURIComponent(dayKey)}`)
}

export type ReadingLifeEvent = {
  eventType: 'reading.opened' | 'reading.progress' | 'reading.bookmark' | 'reading.annotation' | 'reading.vocabulary'
  bookId: string
  bookTitle: string
  paragraphIndex?: number
  progressPercent?: number
  readingSecondsDelta?: number
  readingSecondsTotal?: number
  enabled?: boolean
}

/** 共读只记录行为事实；服务端不可用时由阅读器保留本地阅读，不阻断正文。 */
export function appendReadingLifeEvent(event: ReadingLifeEvent): Promise<void> {
  return fetchJson('/api/life/events/reading', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(event),
  }).then(() => undefined)
}

export type StudyLifeEvent = {
  eventType: 'study.cards.generated' | 'study.card.reviewed' | 'study.record.created' | 'study.task.completed'
  subject?: string
  count?: number
  grade?: 'again' | 'good' | 'easy'
  repetitions?: number
  intervalDays?: number
  durationMinutes?: number
  studiedOn?: string
  label?: string
  dayKey?: string
  cardId?: string
  at?: number
}

/** 学习事实是 Life 的跨模块投影；网络失败不应阻断本地卡片 / 记录操作。 */
export function appendStudyLifeEvent(event: StudyLifeEvent): Promise<void> {
  return fetchJson('/api/life/events/study', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(event),
  }).then(() => undefined)
}

export type CountdownLifeEvent = {
  eventType: 'countdown.created' | 'countdown.deleted' | 'countdown.widget.updated'
  countdownId: string
  title: string
  targetDate: string
  action?: 'pinned' | 'unpinned'
  at?: number
}

/** 倒数日只投影操作事实；本地日期数据仍由 Dexie 保管。 */
export function appendCountdownLifeEvent(event: CountdownLifeEvent): Promise<void> {
  return fetchJson('/api/life/events/countdown', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(event),
  }).then(() => undefined)
}

export function loadLifeLedger(month: string): Promise<LifeLedgerView> {
  return fetchJson(`/api/life/ledger?month=${encodeURIComponent(month)}`)
}

export function loadNotifications(): Promise<NotificationRecord[]> {
  return fetchJson<{ notifications: NotificationRecord[] }>('/api/notifications?limit=200')
    .then((result) => result.notifications)
}

export function markNotificationRead(id: string): Promise<void> {
  return fetchJson(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }).then(() => undefined)
}

export function markAllNotificationsRead(): Promise<number> {
  return fetchJson<{ updated: number }>('/api/notifications/read-all', { method: 'PATCH' })
    .then((result) => result.updated)
}

export function loadNotificationPreferences(): Promise<NotificationPreferences> {
  return fetchJson<{ preferences: NotificationPreferences }>('/api/notifications/preferences')
    .then((result) => result.preferences)
}

export function saveNotificationPreferences(patch: {
  enabled?: boolean
  quietHoursEnabled?: boolean
  quietStart?: string
  quietEnd?: string
  categories?: Partial<NotificationPreferences['categories']>
}): Promise<NotificationPreferences> {
  return fetchJson<{ preferences: NotificationPreferences }>('/api/notifications/preferences', {
    method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(patch),
  }).then((result) => result.preferences)
}

export interface PushTestResult {
  sent: number
  skipped: boolean
  reason: string | null
  configured: boolean
  subscriptionCount: number
}

export function sendPushTest(): Promise<PushTestResult> {
  return fetchJson('/api/push/test', { method: 'POST', headers: jsonHeaders, body: '{}' })
}

export function loadLifeRuntime(): Promise<LifeRuntimeView> {
  return fetchJson('/api/life/runtime')
}

export function runAutomationCheck(): Promise<unknown> {
  return fetchJson('/api/automation/check', { method: 'POST', headers: jsonHeaders, body: '{}' })
}

/** Surf 订阅源（Phase 7C 收口）。`null` 入参 = 恢复默认源。 */
export function loadSurfFeeds(): Promise<string[]> {
  return fetchJson<{ feeds: string[] }>('/api/surf/feeds').then((result) => result.feeds)
}

export function saveSurfFeeds(feeds: string[] | null): Promise<string[]> {
  return fetchJson<{ feeds: string[] }>('/api/surf/feeds', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ feeds }),
  }).then((result) => result.feeds)
}

export function addWalletTransaction(delta: number, reason: string): Promise<void> {
  return fetchJson('/api/wallet/transactions', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ delta, reason }),
  }).then(() => undefined)
}

export function addPriceSnapshot(input: Omit<PriceSnapshotRecord, 'id' | 'createdAt'>): Promise<{ repriced: number }> {
  return fetchJson<{ snapshot: PriceSnapshotRecord; repriced: number }>('/api/prices', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(input),
  })
}

export function loadPushStatus(): Promise<PushStatus> {
  return fetchJson('/api/push/status')
}

export function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  return fetchJson('/api/push/subscription', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify(subscription),
  }).then(() => undefined)
}

export function deletePushSubscription(endpoint: string): Promise<void> {
  return fetchJson('/api/push/subscription', {
    method: 'DELETE', headers: jsonHeaders, body: JSON.stringify({ endpoint }),
  }).then(() => undefined)
}
