import type { CountdownDay } from '@shared/types'
import { emitCountdownReminder } from '../life/api'
import { reminderOccurrenceDate } from './countdownDays'

/**
 * 倒数日仍是本地事实；Home 或倒数日模块打开时各自调用这条幂等检查，
 * 这样用户不必特意进入倒数日页面才能收到站内提醒。
 */
export async function checkCountdownReminders(items: CountdownDay[]): Promise<void> {
  if (typeof window === 'undefined') return
  await Promise.all(items.map(async (item) => {
    if (item.reminder === 'none') return
    const occurrenceDate = reminderOccurrenceDate(item)
    if (occurrenceDate === null) return
    const reminderKey = `${item.id}:${occurrenceDate}:${item.reminder}`
    const storageKey = `habitat:countdown-reminder:${reminderKey}`
    if (window.localStorage.getItem(storageKey) === 'sent') return
    try {
      await emitCountdownReminder({ countdownId: item.id, title: item.title, occurrenceDate, reminder: item.reminder, reminderKey })
      window.localStorage.setItem(storageKey, 'sent')
    } catch {
      // 服务端 / 网络暂不可用时下次打开继续尝试，不打断 Home。
    }
  }))
}
