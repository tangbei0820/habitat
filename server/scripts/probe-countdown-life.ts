/** V2-D 倒数日事实 → Life 时间线 / 月历探针。 */
const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3103').replace(/\/$/, '')
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
console.log(`\n=== Countdown → Life probe (${base}) ===`)

const common = { countdownId: `probe-countdown-${process.pid}`, title: '探针纪念日', targetDate: '2026-10-01' }
const created = await request('/api/life/events/countdown', { method: 'POST', headers, body: JSON.stringify({ eventType: 'countdown.created', ...common }) })
check('倒数日创建事实可写入', created.status === 201)
const pinned = await request('/api/life/events/countdown', { method: 'POST', headers, body: JSON.stringify({ eventType: 'countdown.widget.updated', ...common, action: 'pinned' }) })
check('倒数日上主屏事实可写入', pinned.status === 201)
const deleted = await request('/api/life/events/countdown', { method: 'POST', headers, body: JSON.stringify({ eventType: 'countdown.deleted', ...common }) })
check('倒数日删除事实可写入', deleted.status === 201)

const day = await request(`/api/life/day/${today}`)
const timeline = record(day.body).timeline as Array<Record<string, unknown>> | undefined
check('日期时间线包含倒数日操作且没有对象直出', day.status === 200 && timeline?.filter((item) => typeof item.eventType === 'string' && item.eventType.startsWith('countdown.')).length === 3 && timeline?.every((item) => typeof item.title === 'string' && !item.title.includes('[object Object]')) === true)
const monthView = await request(`/api/life/month?month=${month}`)
const daySummary = (record(monthView.body).days as Array<Record<string, unknown>> | undefined)?.find((item) => item.dayKey === today)
check('月历汇总倒数日活动次数', monthView.status === 200 && daySummary?.countdownActivityCount === 3)
const bad = await request('/api/life/events/countdown', { method: 'POST', headers, body: JSON.stringify({ eventType: 'countdown.widget.updated', ...common, action: 'unknown' }) })
check('拒绝非法 Widget 动作', bad.status === 400)

console.log(`\nCountdown → Life probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
