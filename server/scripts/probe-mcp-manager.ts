/**
 * V2-A · MCP Manager 基础切片验收。
 *
 * 前置：同一条命令启动 mock MCP(:3333) 与 habitat-server（建议使用全新
 * HABITAT_DB_PATH），再执行 `PROBE_SERVER=http://127.0.0.1:3259 npx tsx
 * scripts/probe-mcp-manager.ts`。脚本只通过公开 API 验收，不直接读 SQLite。
 */

const base = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3259').replace(/\/$/, '')
const mockUrl = process.env.MOCK_MCP_URL ?? 'http://127.0.0.1:3333/mcp'
const secret = 'probe-token-that-must-not-leak'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, extra = ''): void {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${extra === '' ? '' : `  ${extra}`}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${extra === '' ? '' : `  ${extra}`}`)
  }
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  try { body = text === '' ? null : JSON.parse(text) } catch { body = text }
  return { status: response.status, body, text }
}

function json(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function serverList(value: unknown): Record<string, unknown>[] {
  const list = object(value).servers
  return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []
}

function findServer(value: unknown, id: string): Record<string, unknown> | undefined {
  return serverList(value).find((item) => item.serverId === id)
}

const headers = { 'content-type': 'application/json' }

export {}

console.log(`\n=== MCP Manager probe (${base}) ===`)
const health = await request('/api/health')
check('server 可达', health.status === 200 && object(health.body).ok === true)

const initial = await request('/api/mcp/servers')
check('manager 列表可读', initial.status === 200 && Array.isArray(object(initial.body).servers))
check('列表不回传明文凭据', !initial.text.includes(secret))

const created = await request('/api/mcp/servers', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    id: `probe-mcp-${process.pid}`,
    name: 'Probe MCP',
    url: mockUrl,
    token: secret,
    headers: { 'X-Probe': 'manager' },
    // 安全默认：先保存为关闭，测试通过后再接入 Gateway。
    enabled: false,
    allowAutonomous: false,
  }),
})
const createdBody = object(created.body)
const serverId = typeof createdBody.serverId === 'string' ? createdBody.serverId : ''
check('可注册关闭状态的 MCP', created.status === 201 && serverId !== '')
check('注册响应只回传凭据状态', created.status === 201 && createdBody.hasToken === true && !created.text.includes(secret))
check('自定义头只展示名称', created.status === 201 && json(createdBody.headerNames).includes('X-Probe') && !created.text.includes('manager'))
check('新 server 默认不进入工具面', created.status === 201 && createdBody.enabled === false && createdBody.state === 'disconnected')

const invalidUrl = await request('/api/mcp/servers', {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: 'Bad URL', url: 'file:///tmp/nope' }),
})
check('拒绝非 HTTP MCP 地址', invalidUrl.status === 400)

const broken = await request('/api/mcp/servers', {
  method: 'POST',
  headers,
  body: JSON.stringify({ id: `probe-broken-${process.pid}`, name: 'Broken MCP', url: 'http://127.0.0.1:1/mcp', enabled: false }),
})
const brokenId = object(broken.body).serverId
const brokenTest = await request(`/api/mcp/servers/${encodeURIComponent(String(brokenId))}/test`, { method: 'POST' })
const brokenTestBody = object(brokenTest.body)
check('失联 MCP 测试返回失败结果而非 500', broken.status === 201 && brokenTest.status === 200 && brokenTestBody.ok === false)
check('失败结果带可读原因', brokenTest.status === 200 && typeof brokenTestBody.error === 'string' && String(brokenTestBody.error).length > 0)
const brokenDeleted = await request(`/api/mcp/servers/${encodeURIComponent(String(brokenId))}`, { method: 'DELETE' })
check('失败配置仍可清理', brokenDeleted.status === 200 && object(brokenDeleted.body).deleted === true)

const testDisabled = await request(`/api/mcp/servers/${encodeURIComponent(serverId)}/test`, { method: 'POST' })
const testBody = object(testDisabled.body)
check('关闭状态仍可执行真实连接测试', testDisabled.status === 200 && testBody.ok === true)
check('连接测试返回工具数量与样例', testDisabled.status === 200 && Number(testBody.toolCount) >= 1 && Array.isArray(testBody.sampleTools))
const afterTest = await request('/api/mcp/servers')
check('测试关闭 server 后恢复 disconnected', findServer(afterTest.body, serverId)?.state === 'disconnected')

const enabled = await request(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ enabled: true, allowAutonomous: true }),
})
const enabledBody = object(enabled.body)
check('可启用连接并设置自主策略', enabled.status === 200 && enabledBody.enabled === true && enabledBody.allowAutonomous === true && enabledBody.state === 'ready')

const tools = await request(`/api/mcp/servers/${encodeURIComponent(serverId)}/tools`)
const toolList = object(tools.body).tools
check('可查看真实工具清单', tools.status === 200 && Array.isArray(toolList) && (toolList as unknown[]).some((item) => object(item).name === 'echo'))
check('工具清单为可渲染摘要', tools.status === 200 && !tools.text.includes('[object Object]'))
const diagnostics = await request(`/api/diagnostics/mcp?serverId=${encodeURIComponent(serverId)}&limit=5`)
check('可查看该 MCP 最近调用记录', diagnostics.status === 200 && Array.isArray(object(diagnostics.body).entries) && (object(diagnostics.body).entries as unknown[]).length >= 1)

const renamed = await request(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ name: 'Probe MCP Renamed' }),
})
check('可单独编辑名称', renamed.status === 200 && object(renamed.body).name === 'Probe MCP Renamed')
check('编辑后仍不回传 token', renamed.status === 200 && !renamed.text.includes(secret))

const disabled = await request(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ enabled: false }),
})
check('可停用并断开连接', disabled.status === 200 && object(disabled.body).enabled === false && object(disabled.body).state === 'disconnected')

const deleted = await request(`/api/mcp/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
check('可删除 MCP 注册', deleted.status === 200 && object(deleted.body).deleted === true)
const afterDelete = await request('/api/mcp/servers')
check('删除后列表不残留', findServer(afterDelete.body, serverId) === undefined)

console.log(`\nMCP Manager probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
