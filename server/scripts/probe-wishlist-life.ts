/** 愿望清单生命周期 → Life 时间线 / 月历探针。 */
const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3103').replace(/\/$/, '')
const headers = { 'content-type': 'application/json' }
let passed = 0
let failed = 0
function check(label: string, ok: boolean): void { if (ok) { passed += 1; console.log(`  ✓ ${label}`) } else { failed += 1; console.log(`  ✗ ${label}`) } }
async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, init); const text = await response.text(); let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {} }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const month = today.slice(0, 7); const id = `probe-wishlist-${process.pid}`
console.log(`\n=== Wishlist → Life probe (${base}) ===`)
const common = { wishlistId: id, title: '探针愿望', targetDate: today, author: 'user' }
const created = await request('/api/life/events/wishlist', { method: 'POST', headers, body: JSON.stringify({ eventType: 'wishlist.created', ...common }) })
check('愿望创建事实可写入', created.status === 201)
const updated = await request('/api/life/events/wishlist', { method: 'POST', headers, body: JSON.stringify({ eventType: 'wishlist.updated', ...common, title: '更新后的愿望' }) })
check('愿望编辑事实可写入', updated.status === 201)
const status = await request('/api/life/events/wishlist', { method: 'POST', headers, body: JSON.stringify({ eventType: 'wishlist.status.updated', ...common, status: 'paused', reason: '等待合适的时间' }) })
check('愿望状态变化事实可写入', status.status === 201)
const progress = await request('/api/life/events/wishlist', { method: 'POST', headers, body: JSON.stringify({ eventType: 'wishlist.progress.added', ...common, progressNote: '完成了第一步' }) })
check('愿望进展事实可写入', progress.status === 201)
const deleted = await request('/api/life/events/wishlist', { method: 'POST', headers, body: JSON.stringify({ eventType: 'wishlist.deleted', ...common }) })
check('愿望删除事实可写入', deleted.status === 201)
const day = await request(`/api/life/day/${today}`)
const timeline = record(day.body).timeline as Array<Record<string, unknown>> | undefined
check('日期时间线包含愿望操作且没有对象直出', day.status === 200 && timeline?.filter((item) => typeof item.eventType === 'string' && item.eventType.startsWith('wishlist.')).length === 5 && timeline?.every((item) => typeof item.title === 'string' && !item.title.includes('[object Object]')) === true)
const monthView = await request(`/api/life/month?month=${month}`)
const daySummary = (record(monthView.body).days as Array<Record<string, unknown>> | undefined)?.find((item) => item.dayKey === today)
check('月历汇总愿望活动次数', monthView.status === 200 && daySummary?.wishlistActivityCount === 5)
const bad = await request('/api/life/events/wishlist', { method: 'POST', headers, body: JSON.stringify({ eventType: 'wishlist.status.updated', ...common, status: 'unknown' }) })
check('拒绝非法愿望状态', bad.status === 400)
console.log(`\nWishlist → Life probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
export {}
