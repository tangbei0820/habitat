import type { CountdownDay } from '@shared/types'

/**
 * 倒数日的日期换算（模块页与主屏 Widget 共用一份 —— 同一个日子在两个地方
 * 算出不同的天数，是用户一定会发现、而且一定会先怀疑「哪个才是对的」的那种问题）。
 */

/**
 * 距离目标日还有多少天：正数=未来，0=今天，负数=已过去。
 *
 * ⚠️ 逐段拆开构造本地日期，**不要**写 `new Date('2026-09-23')` ——
 * 那会把纯日期解析成 UTC 零点，在东八区就凭空少算一天（差 8 小时，换算成天数是 0.33，
 * 四舍五入后有时对有时错，是最难查的那类偏差）。
 */
export function dayDistance(targetDate: string): number {
  const [year, month, day] = targetDate.split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function distanceLabel(days: number): string {
  if (days === 0) return '就是今天'
  if (days > 0) return `还有 ${String(days)} 天`
  return `已过 ${String(Math.abs(days))} 天`
}

function dateParts(value: string): [number, number, number] {
  return value.split('-').map(Number) as [number, number, number]
}

function dateValue(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function localDateValue(date = new Date()): string {
  return dateValue(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** 取倒数日下一次发生的日期。纯日期始终按本地日历计算，不经过 UTC。 */
export function nextOccurrenceDate(item: Pick<CountdownDay, 'targetDate' | 'repeat'>, today = localDateValue()): string {
  if (item.repeat === 'none') return item.targetDate
  const [, month, day] = dateParts(item.targetDate)
  const [year] = dateParts(today)
  const candidate = isValidDate(year, month, day) ? dateValue(year, month, day) : dateValue(year, 2, 28)
  return candidate < today
    ? (isValidDate(year + 1, month, day) ? dateValue(year + 1, month, day) : dateValue(year + 1, 2, 28))
    : candidate
}

/** 若今天需要提醒，返回本次提醒对应的发生日；否则返回 null。 */
export function reminderOccurrenceDate(item: Pick<CountdownDay, 'targetDate' | 'repeat' | 'reminder'>, today = localDateValue()): string | null {
  if (item.reminder === 'none') return null
  const occurrence = nextOccurrenceDate(item, today)
  if (item.reminder === 'on-day') return occurrence === today ? occurrence : null
  const [year, month, day] = dateParts(occurrence)
  const previous = new Date(year, month - 1, day)
  previous.setDate(previous.getDate() - 1)
  return localDateValue(previous) === today ? occurrence : null
}

export function countdownCategoryLabel(category: CountdownDay['category']): string {
  return ({ anniversary: '纪念日', event: '事件', deadline: '截止日', other: '其它' } as const)[category]
}

export function countdownRepeatLabel(repeat: CountdownDay['repeat']): string {
  return repeat === 'yearly' ? '每年' : '不重复'
}

export function countdownReminderLabel(reminder: CountdownDay['reminder']): string {
  return ({ none: '不提醒', 'on-day': '当天提醒', 'one-day-before': '提前一天' } as const)[reminder]
}
