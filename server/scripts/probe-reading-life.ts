/** V2-D 共读第三切片：阅读行为进入 Life 的服务端契约探针。 */
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db/index.js'
import { eventLog } from '../src/db/schema.js'

const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3101').replace(/\/$/, '')
const headers = { 'content-type': 'application/json' }
let passed = 0
let failed = 0

function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

const bookId = `probe-reading-life-${process.pid}`
const bookTitle = '探针之书'
const events = [
  { eventType: 'reading.opened', bookId, bookTitle, paragraphIndex: 0, readingSecondsTotal: 0 },
  { eventType: 'reading.progress', bookId, bookTitle, paragraphIndex: 2, progressPercent: 75, readingSecondsDelta: 60, readingSecondsTotal: 60 },
  { eventType: 'reading.bookmark', bookId, bookTitle, paragraphIndex: 2, enabled: true },
  { eventType: 'reading.annotation', bookId, bookTitle, paragraphIndex: 2 },
  { eventType: 'reading.vocabulary', bookId, bookTitle, paragraphIndex: 2 },
  { eventType: 'reading.daily.swapped', bookId, bookTitle, paragraphIndex: 1, mode: 'daily' },
  { eventType: 'reading.daily.annotation', bookId, bookTitle, paragraphIndex: 1, mode: 'daily' },
  { eventType: 'reading.daily.comment', bookId, bookTitle, paragraphIndex: 1, mode: 'daily', annotationAuthor: 'companion' },
]

console.log(`\n=== Reading → Life probe (${base}) ===`)
try {
  const created = [] as Array<Record<string, unknown>>
  for (const event of events) {
    const result = await request('/api/life/events/reading', { method: 'POST', headers, body: JSON.stringify(event) })
    created.push(record(result.body))
    check(`${event.eventType} 可写入`, result.status === 201 && record(result.body).ok === true)
  }
  const dayKey = typeof created[0].dayKey === 'string' ? created[0].dayKey : ''
  const detail = await request(`/api/life/day/${dayKey}`)
  const projected = Array.isArray(record(detail.body).events)
    ? (record(detail.body).events as unknown[]).filter((item) => record(item).refId === bookId)
    : []
  check('共读与每日品读事件可从 Life 日期下钻读回', detail.status === 200 && projected.length === events.length)
  check('事件保留书名与稳定段落索引', record(record(projected.find((item) => record(item).eventType === 'reading.progress')).metricsJson).bookTitle === bookTitle && record(record(projected.find((item) => record(item).eventType === 'reading.progress')).metricsJson).paragraphIndex === 2)
  check('每日品读事件保留 daily 模式', record(record(projected.find((item) => record(item).eventType === 'reading.daily.swapped')).metricsJson).mode === 'daily')
  check('小栖回应事件保留 companion 批注身份', record(record(projected.find((item) => record(item).eventType === 'reading.daily.comment')).metricsJson).annotationAuthor === 'companion')

  const badType = await request('/api/life/events/reading', { method: 'POST', headers, body: JSON.stringify({ eventType: 'reading.nope', bookId, bookTitle }) })
  check('拒绝未知共读事件类型', badType.status === 400)
  const badProgress = await request('/api/life/events/reading', { method: 'POST', headers, body: JSON.stringify({ eventType: 'reading.progress', bookId, bookTitle, progressPercent: 101 }) })
  check('拒绝越界阅读进度', badProgress.status === 400)
} finally {
  db.delete(eventLog).where(and(eq(eventLog.refId, bookId))).run()
}

console.log(`\nReading → Life probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
