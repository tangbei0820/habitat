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

export async function sendWebPush(notification: NotificationRecord): Promise<void> {
  if (!getPushStatus().configured) return
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    tag: notification.id,
    url: '/life?tab=notifications',
  })
  await Promise.all(listPushSubscriptions().map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 60 * 60 })
      markPushSuccess(subscription.id)
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0
      if (statusCode === 404 || statusCode === 410) removePushSubscription(subscription.endpoint)
      else markPushFailure(subscription.id, error instanceof Error ? error.message : String(error))
    }
  }))
}
