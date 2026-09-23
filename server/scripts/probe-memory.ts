/**
 * Phase 3A 记忆链路验收（要求 mock MCP + habitat-server 已启动）。
 * 覆盖：Gateway 握手、boot/search/read/create/update/delete、read-before-write 语义、参数边界与诊断留痕。
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

console.log('\n[1] MCP / Nocturne 契约')
const health = await request('/api/health/mcp')
const nocturne = (health.body as McpHealth).servers.find((item) => item.serverId === 'nocturne')
check('mock Nocturne 握手 ready', health.status === 200 && nocturne?.state === 'ready')
check('七个记忆工具 + echo 均已发现', nocturne?.toolCount === 8, `toolCount=${String(nocturne?.toolCount)}`)

const boot = await request('/api/memory/boot')
check('system://boot 经 MCP 召回', boot.status === 200 && text(boot).includes('BOOT') && text(boot).includes('mock 记忆'))
const initialSearch = await request('/api/memory/search?q=mock&domain=core&limit=5')
check('词法搜索支持 domain / limit', initialSearch.status === 200 && text(initialSearch).includes('core://agent'))

console.log('\n[2] 写入与更新语义')
const created = await request('/api/memory', json('POST', {
  parentUri: 'core://agent', content: '北北喜欢在傍晚散步。', priority: 2,
  disclosure: '当用户提到散步或傍晚时', title: 'evening_walk',
}))
check('创建记忆', created.status === 201 && text(created).includes("core://agent/evening_walk"), JSON.stringify(created.body))
const read = await request('/api/memory/read?uri=core%3A%2F%2Fagent%2Fevening_walk')
check('按 URI 读取记忆', read.status === 200 && text(read).includes('傍晚散步'))
const searched = await request('/api/memory/search?q=%E5%82%8D%E6%99%9A')
check('新记忆立即可搜索', searched.status === 200 && text(searched).includes('evening_walk'))

const replaced = await request('/api/memory', json('PATCH', {
  uri: 'core://agent/evening_walk', oldString: '傍晚散步', newString: '晚饭后散步',
}))
check('精确替换更新成功', replaced.status === 200 && text(replaced).includes('updated'))
const appended = await request('/api/memory', json('PATCH', {
  uri: 'core://agent/evening_walk', append: '\n雨天则留在家里。', priority: 3,
}))
check('追加模式与元数据可同次更新', appended.status === 200 && text(appended).includes('updated'))
const reread = await request('/api/memory/read?uri=core%3A%2F%2Fagent%2Fevening_walk')
check('更新后的正文可读且旧片段消失', text(reread).includes('晚饭后散步') && text(reread).includes('雨天') && !text(reread).includes('傍晚散步'))

console.log('\n[3] 参数与危险边界')
const badCases: Array<[string, Promise<ResponseData>]> = [
  ['搜索词缺失', request('/api/memory/search')],
  ['非法 domain', request('/api/memory/search?q=x&domain=bad-domain')],
  ['limit 越界', request('/api/memory/search?q=x&limit=101')],
  ['重复 query 参数', request('/api/memory/search?q=x&q=y')],
  ['创建到 system 视图', request('/api/memory', json('POST', { parentUri: 'system://boot', content: 'x', priority: 1, disclosure: 'x', title: 'x' }))],
  ['非法英文标题', request('/api/memory', json('POST', { parentUri: 'core://agent', content: 'x', priority: 1, disclosure: 'x', title: '中文 标题' }))],
  ['替换缺 newString', request('/api/memory', json('PATCH', { uri: 'core://agent/evening_walk', oldString: 'x' }))],
  ['替换与追加混用', request('/api/memory', json('PATCH', { uri: 'core://agent/evening_walk', oldString: 'x', newString: 'y', append: 'z' }))],
  ['空更新', request('/api/memory', json('PATCH', { uri: 'core://agent/evening_walk' }))],
  ['修改 system 视图', request('/api/memory', json('PATCH', { uri: 'system://boot', append: 'x' }))],
]
for (const [label, pending] of badCases) {
  const response = await pending
  check(`${label} → 400`, response.status === 400 && errorCode(response) === 'BAD_REQUEST', JSON.stringify(response.body))
}
const missing = await request('/api/memory/read?uri=core%3A%2F%2Fmissing')
check('Nocturne 文本 Error 不会伪装成成功', missing.status === 502 && errorCode(missing) === 'MCP_TOOL_CALL_FAILED')

console.log('\n[4] 删除与诊断')
const deleted = await request('/api/memory?uri=core%3A%2F%2Fagent%2Fevening_walk', { method: 'DELETE' })
check('删除记忆', deleted.status === 200 && text(deleted).includes('deleted'))
const afterDelete = await request('/api/memory/read?uri=core%3A%2F%2Fagent%2Fevening_walk')
check('删除后不可读取', afterDelete.status === 502 && errorCode(afterDelete) === 'MCP_TOOL_CALL_FAILED')
const diagnostics = await request('/api/diagnostics/mcp?serverId=nocturne&handshake=0&limit=100')
const page = diagnostics.body as McpDiagnosticPage
check('每次记忆工具调用均进入 MCP 诊断链', diagnostics.status === 200 && page.total >= 12 && page.entries.every((entry) => entry.method === 'tools/call'), `total=${String(page.total)}`)

console.log(`\n=== Memory probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
