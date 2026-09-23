/** 不依赖系统时区的 IANA 时区日键与跨零点时间窗计算。 */
export interface LocalClock {
  dayKey: string
  minuteOfDay: number
}

export function localClock(at: Date, timeZone: string): LocalClock {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]))
  const year = parts.get('year') ?? '1970'
  const month = parts.get('month') ?? '01'
  const day = parts.get('day') ?? '01'
  const hour = Number(parts.get('hour') ?? 0)
  const minute = Number(parts.get('minute') ?? 0)
  return { dayKey: `${year}-${month}-${day}`, minuteOfDay: hour * 60 + minute }
}

export function parseClock(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) throw new Error(`时间必须是 HH:mm：${value}`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error(`时间必须是 HH:mm：${value}`)
  return hour * 60 + minute
}

export function inTimeWindow(minuteOfDay: number, start: string, end: string): boolean {
  const startMinute = parseClock(start)
  const endMinute = parseClock(end)
  if (startMinute === endMinute) return true
  return startMinute < endMinute
    ? minuteOfDay >= startMinute && minuteOfDay < endMinute
    : minuteOfDay >= startMinute || minuteOfDay < endMinute
}
