/** V2-D 学习事实 → Life 时间线 / 月历探针。 */
const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3102').replace(/\/$/, '')
const headers = { 'content-type': 'application/json' }
let passed = 0
let failed = 0

function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const month = today.slice(0, 7)
console.log(`\n=== Study → Life probe (${base}) ===`)

const generated = await request('/api/life/events/study', { method: 'POST', headers, body: JSON.stringify({ eventType: 'study.cards.generated', subject: '英语', count: 3 }) })
check('卡片生成事实可写入', generated.status === 201)
const reviewed = await request('/api/life/events/study', { method: 'POST', headers, body: JSON.stringify({ eventType: 'study.card.reviewed', cardId: 'probe-card', subject: '英语', grade: 'good', repetitions: 2, intervalDays: 4 }) })
check('卡片复习事实可写入', reviewed.status === 201)
const recordEvent = await request('/api/life/events/study', { method: 'POST', headers, body: JSON.stringify({ eventType: 'study.record.created', subject: '英语', durationMinutes: 25, studiedOn: today }) })
check('学习记录事实可写入', recordEvent.status === 201)
const task = await request('/api/life/events/study', { method: 'POST', headers, body: JSON.stringify({ eventType: 'study.task.completed', label: '背十个词', dayKey: today }) })
check('今日任务完成事实可写入', task.status === 201)

const day = await request(`/api/life/day/${today}`)
const timeline = record(day.body).timeline as Array<Record<string, unknown>> | undefined
check('日期时间线包含四类学习事件且为可读文本', day.status === 200 && timeline?.filter((item) => typeof item.eventType === 'string' && item.eventType.startsWith('study.')).length === 4 && timeline?.every((item) => typeof item.title === 'string' && !item.title.includes('[object Object]')) === true)
const monthView = await request(`/api/life/month?month=${month}`)
const daySummary = (record(monthView.body).days as Array<Record<string, unknown>> | undefined)?.find((item) => item.dayKey === today)
check('月历汇总学习活动次数', monthView.status === 200 && daySummary?.studyActivityCount === 4)
const bad = await request('/api/life/events/study', { method: 'POST', headers, body: JSON.stringify({ eventType: 'study.card.reviewed', subject: '英语', grade: 'unknown' }) })
check('拒绝非法复习评分', bad.status === 400)

console.log(`\nStudy → Life probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
