/** Web Push 是站内通知的尽力而为出口；失败永远不能回滚 notification。 */
import type { NotificationRecord, PushStatus } from '@shared/types.js'
import webpush from 'web-push'
import {
  listPushSubscriptions,
  markPushFailure,
  markPushSuccess,
  pushSubscriptionSummary,
  removePushSubscription,
} from '../db/push.js'
import { notificationCategoryOf, notificationDeliveryAllowed } from '../db/notification-preferences.js'

const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim() ?? ''
const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim() ?? ''
const subject = process.env.WEB_PUSH_SUBJECT?.trim() || 'mailto:habitat@localhost'
let configurationError: string | null = null

if (publicKey !== '' && privateKey !== '') {
  try { webpush.setVapidDetails(subject, publicKey, privateKey) }
  catch (error) { configurationError = error instanceof Error ? error.message : String(error) }
}

export function getPushStatus(): PushStatus {
  const summary = pushSubscriptionSummary()
  const configured = publicKey !== '' && privateKey !== '' && configurationError === null
  return {
    supported: true,
    configured,
    publicKey: configured ? publicKey : null,
    subscriptionCount: summary.count,
    lastError: configurationError ?? summary.lastError,
  }
}

export interface PushSendResult {
  sent: number
  skipped: boolean
  reason: string | null
}

export async function sendWebPush(notification: NotificationRecord, options: { force?: boolean } = {}): Promise<PushSendResult> {
  if (!getPushStatus().configured) return { sent: 0, skipped: true, reason: '服务端尚未配置 Web Push VAPID' }
  if (options.force !== true) {
    const decision = notificationDeliveryAllowed(notificationCategoryOf(notification))
    if (!decision.allowed) return { sent: 0, skipped: true, reason: decision.reason }
  }
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    tag: notification.id,
    // 需要行动的通知可以把用户直接送到对应入口；旧通知没有 route 时仍回到通知中心。
    url: typeof notification.metadata.route === 'string' && notification.metadata.route.startsWith('/')
      ? notification.metadata.route
      : '/life?view=records&tab=notifications',
  })
  let sent = 0
  const subscriptions = listPushSubscriptions()
  if (subscriptions.length === 0) return { sent: 0, skipped: true, reason: '当前没有已启用的浏览器订阅' }
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 60 * 60 })
      markPushSuccess(subscription.id)
      sent += 1
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0
      if (statusCode === 404 || statusCode === 410) removePushSubscription(subscription.endpoint)
      else markPushFailure(subscription.id, error instanceof Error ? error.message : String(error))
    }
  }))
  return { sent, skipped: false, reason: null }
}
