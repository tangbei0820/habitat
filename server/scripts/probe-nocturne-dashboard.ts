/**
 * V2-A · Nocturne 原生 Dashboard 入口探针。
 * 前置：启动 server 时设置 NOCTURNE_DASHBOARD_URL=http://127.0.0.1:3999/dashboard/，
 * 再设置 PROBE_SERVER 后运行。本探针只验证 Habitat 的入口契约，不抓取或修改 Nocturne 数据。
 */

const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3260').replace(/\/$/, '')
const dashboardUrl = process.env.PROBE_DASHBOARD_URL ?? 'http://127.0.0.1:3999/dashboard/'
let passed = 0
let failed = 0

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}`)
  }
}

async function fetchJson(path: string): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${base}${path}`)
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body, text }
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

console.log(`\n=== Nocturne Dashboard probe (${base}) ===`)
const state = await fetchJson('/api/nocturne/dashboard')
const stateBody = object(state.body)
check('Dashboard 配置状态可读', state.status === 200 && stateBody.configured === true)
check('状态接口不回传原始 URL', state.status === 200 && !state.text.includes(dashboardUrl))
check('状态接口不出现 token 字段', state.status === 200 && !state.text.toLowerCase().includes('token'))

const open = await fetch(`${base}/api/nocturne/dashboard/open`, { redirect: 'manual' })
const location = open.headers.get('location')
check('入口返回受保护页面 302', open.status === 302 && location === dashboardUrl)
check('302 不把 token 拼进目标地址', location !== null && !location.toLowerCase().includes('token='))
check('入口响应不携带 MCP 凭据', !(await open.text()).toLowerCase().includes('authorization'))

console.log(`\nNocturne Dashboard probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
