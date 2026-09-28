/** 通知偏好：只保存推送 / 主动打扰策略，不改变站内 notification 事实源。 */
import type {
  NotificationCategory,
  NotificationCategoryPreferences,
  NotificationPreferences,
  NotificationRecord,
} from '@shared/types.js'
import { getKv, setKv } from './kv.js'
import { getAutomationPolicy } from './automation.js'
import { inTimeWindow, localClock, parseClock } from '../lib/time-window.js'

const KV_KEY = 'notification.preferences'

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'proactive', 'messageboard', 'diary', 'moment', 'countdown', 'listening', 'wake', 'task', 'relationship', 'call',
]

const DEFAULT_CATEGORIES: NotificationCategoryPreferences = {
  proactive: true,
  messageboard: true,
  diary: true,
  moment: true,
  countdown: true,
  listening: true,
  wake: true,
  task: true,
  relationship: true,
  call: true,
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  quietHoursEnabled: true,
  quietStart: '23:00',
  quietEnd: '08:00',
  categories: DEFAULT_CATEGORIES,
  updatedAt: 0,
}

function isCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
}

function validClock(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  try { parseClock(value); return value } catch { return fallback }
}

function normalize(raw: unknown): NotificationPreferences {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PREFERENCES, categories: { ...DEFAULT_CATEGORIES } }
  const value = raw as Record<string, unknown>
  const rawCategories = value.categories
  const categories: NotificationCategoryPreferences = { ...DEFAULT_CATEGORIES }
  if (rawCategories !== null && typeof rawCategories === 'object' && !Array.isArray(rawCategories)) {
    for (const category of NOTIFICATION_CATEGORIES) {
      const flag = (rawCategories as Record<string, unknown>)[category]
      if (typeof flag === 'boolean') categories[category] = flag
    }
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_PREFERENCES.enabled,
    quietHoursEnabled: typeof value.quietHoursEnabled === 'boolean' ? value.quietHoursEnabled : DEFAULT_PREFERENCES.quietHoursEnabled,
    quietStart: validClock(value.quietStart, DEFAULT_PREFERENCES.quietStart),
    quietEnd: validClock(value.quietEnd, DEFAULT_PREFERENCES.quietEnd),
    categories,
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  }
}

export function getNotificationPreferences(): NotificationPreferences {
  const encoded = getKv(KV_KEY)
  if (encoded === null) return { ...DEFAULT_PREFERENCES, categories: { ...DEFAULT_CATEGORIES } }
  try { return normalize(JSON.parse(encoded) as unknown) } catch { return { ...DEFAULT_PREFERENCES, categories: { ...DEFAULT_CATEGORIES } } }
}

export interface NotificationPreferencesPatch {
  enabled?: boolean
  quietHoursEnabled?: boolean
  quietStart?: string
  quietEnd?: string
  categories?: Partial<NotificationCategoryPreferences>
}

export function saveNotificationPreferences(patch: NotificationPreferencesPatch, now = Date.now()): NotificationPreferences {
  const current = getNotificationPreferences()
  const next = normalize({
    ...current,
    ...patch,
    categories: { ...current.categories, ...(patch.categories ?? {}) },
    updatedAt: now,
  })
  setKv(KV_KEY, JSON.stringify(next))
  return next
}

export function notificationCategoryOf(notification: Pick<NotificationRecord, 'kind' | 'metadata'>): NotificationCategory {
  const metadataCategory = notification.metadata.category
  if (isCategory(metadataCategory)) return metadataCategory
  if (notification.kind === 'wake') return 'wake'
  if (notification.kind === 'task') return 'task'
  if (notification.kind === 'proactive') return 'proactive'
  if (notification.kind === 'system' || notification.kind === 'api-error' || notification.kind === 'mcp-error') return 'task'
  return 'proactive'
}

/** 返回推送 / 实时主动打扰是否可送达；站内 notification 永远照常保留。 */
export function notificationDeliveryAllowed(category: NotificationCategory, at = Date.now()): { allowed: boolean; reason: string | null } {
  const preferences = getNotificationPreferences()
  if (!preferences.enabled) return { allowed: false, reason: '通知总开关已关闭' }
  if (!preferences.categories[category]) return { allowed: false, reason: `${category} 通知已关闭` }
  if (preferences.quietHoursEnabled) {
    const clock = localClock(new Date(at), getAutomationPolicy().timeZone)
    if (inTimeWindow(clock.minuteOfDay, preferences.quietStart, preferences.quietEnd)) {
      return { allowed: false, reason: '当前处于免打扰时段' }
    }
  }
  return { allowed: true, reason: null }
}
