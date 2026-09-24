/**
 * Phase 3A 记忆链路验收（**只读**）。要求 mock MCP + habitat-server 已启动。
 *
 * 覆盖：Gateway 握手、启动期工具面自检、`breath`（boot）与 `trace`（search）两条只读路径、
 *       参数边界、**已移除的写端点应 404**、诊断留痕。
 *
 * ⚠️ 2026-09-24 重写。原脚本验的是「六个端点全量（含 create / update / delete）」——
 * 但那套接口是按**官方只读 Demo（v1.26）**的工具面设计的，自部署实例上一个都没有
 * （实测 0/5 命中）。也就是说旧脚本的全绿只能证明「mock 自己和自己一致」，
 * 完全不能证明链路可用。现在按实例真实工具面重写为只读验收，并补一条反向断言
 * （写端点确实拿掉了），防止哪天被顺手加回来。
 *
 * 跑法：
 *   1) cd server && MOCK_MCP_PORT=3333 npm run dev:mock-mcp
 *   2) cd server && MCP_NOCTURNE_URL=http://127.0.0.1:3333/mcp PORT=3100 npm run dev
 *   3) cd server && PROBE_SERVER=http://127.0.0.1:3100 npx tsx scripts/probe-memory.ts
 */
import type { ApiError } from '@shared/errors.js'
import type { McpHealth, McpDiagnosticPage } from '@shared/types.js'
import type { MemoryTextResult } from '@shared/providers.js'

const BASE = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3100'
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  const suffix = detail === '' ? '' : `  ${detail}`
  if (ok) { passed += 1; console.log(`  ✓ ${label}${suffix}`) }
  else { failed += 1; console.log(`  ✗ ${label}${suffix}`) }
}

interface ResponseData { status: number; body: unknown }
async function request(path: string, init?: RequestInit): Promise<ResponseData> {
  const response = await fetch(`${BASE}${path}`, init)
  const raw = await response.text()
  let body: unknown = raw
  try { body = raw === '' ? null : JSON.parse(raw) } catch { /* 保留原文供失败信息 */ }
  return { status: response.status, body }
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const text = (response: ResponseData): string => (response.body as MemoryTextResult).text
const errorCode = (response: ResponseData): string => (response.body as ApiError).error.code
/** mock 的 trace 每条命中一行，以 `- [` 开头；用它数命中条数比数字符可靠。 */
const hitLines = (value: string): number => value.split('\n').filter((line) => line.startsWith('- [')).length
const brief = (response: ResponseData): string => JSON.stringify(response.body).slice(0, 120)

console.log('\n[1] 握手与工具面')
const health = await request('/api/health/mcp')
const nocturne = (health.body as McpHealth).servers.find((item) => item.serverId === 'nocturne')
check('mock Nocturne 握手 ready', health.status === 200 && nocturne?.state === 'ready')
check('工具面为 echo + breath + trace（对齐实例形状）', nocturne?.toolCount === 3, `toolCount=${String(nocturne?.toolCount)}`)

console.log('\n[2] 只读路径 · breath（读全部，无参数）')
const boot = await request('/api/memory/boot')
check('boot 经 MCP 取回记忆', boot.status === 200 && text(boot).includes('BREATH'), brief(boot))
check('正文含 mock 记忆内容', text(boot).includes('mock 记忆'))

console.log('\n[3] 只读路径 · trace（关键词搜）')
const hit = await request(`/api/memory/search?q=${encodeURIComponent('散步')}`)
check('搜索命中所查关键词', hit.status === 200 && text(hit).includes('散步'), brief(hit))
check('命中两条', hitLines(text(hit)) === 2, `lines=${hitLines(text(hit))}`)
const limited = await request(`/api/memory/search?q=${encodeURIComponent('散步')}&limit=1`)
check('limit=1 只返回一条', limited.status === 200 && hitLines(text(limited)) === 1, `lines=${hitLines(text(limited))}`)
const miss = await request(`/api/memory/search?q=${encodeURIComponent('绝不可能匹配的词')}`)
check('无命中是正常返回，不是错误', miss.status === 200 && text(miss).includes('没有匹配'), brief(miss))

console.log('\n[4] 参数边界')
const badCases: Array<[string, Promise<ResponseData>]> = [
  ['搜索词缺失', request('/api/memory/search')],
  ['搜索词为空', request('/api/memory/search?q=')],
  ['搜索词重复传入', request('/api/memory/search?q=a&q=b')],
  ['limit 低于下界', request('/api/memory/search?q=a&limit=0')],
  ['limit 超过上界', request('/api/memory/search?q=a&limit=101')],
  ['limit 不是数字', request('/api/memory/search?q=a&limit=abc')],
  ['limit 重复传入', request('/api/memory/search?q=a&limit=1&limit=2')],
]
for (const [label, pending] of badCases) {
  const response = await pending
  check(`${label} → 400`, response.status === 400 && errorCode(response) === 'BAD_REQUEST', brief(response))
}

console.log('\n[5] 写端点确实已移除（实例没有这些语义，接口也不该留着）')
const removedCases: Array<[string, Promise<ResponseData>]> = [
  ['按 URI 读取', request('/api/memory/read?uri=core%3A%2F%2Fagent')],
  ['创建记忆', request('/api/memory', json('POST', { content: 'x' }))],
  ['更新记忆', request('/api/memory', json('PATCH', { content: 'x' }))],
  ['删除记忆', request('/api/memory?uri=core%3A%2F%2Fagent', { method: 'DELETE' })],
]
for (const [label, pending] of removedCases) {
  const response = await pending
  check(`${label} → 404`, response.status === 404, `status=${response.status}`)
}

console.log('\n[6] 诊断留痕')
const diagnostics = await request('/api/diagnostics/mcp?serverId=nocturne&handshake=0&limit=100')
const page = diagnostics.body as McpDiagnosticPage
const calls = Array.isArray(page?.entries) ? page.entries.filter((entry) => entry.method === 'tools/call') : []
check('每次记忆工具调用都进诊断链', diagnostics.status === 200 && calls.length >= 4, `tools/call=${calls.length}`)
check(
  '启动期工具面自检留下了 tools/list 记录',
  Array.isArray(page?.entries) && page.entries.some((entry) => entry.method === 'tools/list'),
  `methods=${[...new Set((page?.entries ?? []).map((entry) => entry.method))].join(',')}`,
)

console.log(`\n=== Memory probe（只读）：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
