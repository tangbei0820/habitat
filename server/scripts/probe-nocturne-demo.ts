/**
 * Phase 3A · 真实链路验收：**Nocturne 官方只读 Demo**
 * （技术方案 §9 风险1 对策 / `AGENTS.md` §5 风险1：「先用 Nocturne 公共 demo 验证客户端代码」）
 *
 * 为什么挑官方 Demo 而不是随便找个 MCP server：官方 README 明确写着该实例是
 * **只读模式，仅开放 `read_memory` 与 `search_memory`** —— 于是「不写入任何外部数据」
 * 由**服务端**物理保证，不靠调用方自觉。
 *
 * 分两段跑，为的是「万一挂了，卡在哪一层能判」：
 *   [1] 原始 SDK 直连   —— 隔离协议层：握手是否成立、是否真 Streamable HTTP（看 session id）
 *   [2] 经 McpGateway   —— 验证**我们自己的生产代码路径**：工具清单 / system://boot / 诊断留痕
 *
 * 数据库：一次性临时库（同 `probe-diag-retention` 的做法），不碰真实诊断记录；跑完连 WAL 一起删。
 * 只读保证：除了「Demo 根本没有写工具」这个结构性保证，脚本还用**记录型包装**统计实际发出的调用，
 *           断言调用名全程落在 {read_memory, search_memory} 内 —— 双保险。
 *
 * 用法：cd server && npx tsx scripts/probe-nocturne-demo.ts
 * 目标地址可用 NOCTURNE_DEMO_URL 覆盖。退出码非 0 表示有断言失败。
 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolGateway } from '@shared/providers.js'

const DEMO_URL = process.env.NOCTURNE_DEMO_URL ?? 'https://misaligned.top/mcp'
/** Demo 只读模式开放的工具；写类工具一个都不该出现 */
const READ_TOOLS = ['read_memory', 'search_memory']
const WRITE_TOOLS = ['create_memory', 'update_memory', 'delete_memory', 'add_alias', 'manage_triggers']

const DB_PATH = './data/probe-nocturne-demo.db'
process.env.HABITAT_DB_PATH = DB_PATH
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })

// 必须等 HABITAT_DB_PATH 落到 env 之后再加载 db/index.js（模块加载期就读环境变量）
const { McpGateway } = await import('../src/mcp/gateway.js')
const { NocturneMemoryProvider } = await import('../src/providers/nocturne-memory.js')
const { listMcpDiagnostics } = await import('../src/db/diagnostics.js')
const { closeDb } = await import('../src/db/index.js')

let passed = 0
let failed = 0

function check(label: string, ok: boolean, extra = ''): void {
  const suffix = extra === '' ? '' : `  ${extra}`
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${suffix}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${suffix}`)
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function schemaProps(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return []
  const props = (schema as { properties?: unknown }).properties
  if (typeof props !== 'object' || props === null) return []
  return Object.keys(props as Record<string, unknown>)
}

/** 从正文里取一个词当搜索词 —— 避免把 Demo 的预置内容写死在断言里 */
function deriveQuery(text: string): string {
  return text.match(/[\u4e00-\u9fff]{2,}/)?.[0]?.slice(0, 4) ?? text.match(/[A-Za-z]{4,}/)?.[0] ?? 'memory'
}

interface ToolSummary {
  name: string
  description?: string
  inputSchema?: unknown
}

console.log(`\n=== 0. 目标：${DEMO_URL} ===`)

/* ---------------------------------------------------------------- 1. 原始 SDK 直连 */
console.log('\n=== 1. 原始 SDK 直连：握手（隔离协议层）===')
const rawTransport = new StreamableHTTPClientTransport(new URL(DEMO_URL))
const rawClient = new Client({ name: 'habitat-probe-raw', version: '0.1.0' }, { capabilities: {} })
let handshakeError: string | null = null
try {
  await rawClient.connect(rawTransport)
} catch (err) {
  handshakeError = errMessage(err)
}
check('initialize 握手成功', handshakeError === null, handshakeError ?? '')
if (handshakeError !== null) {
  console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} —— 握手都没成立，后面没意义，提前退出 ===`)
  closeDb()
  process.exitCode = 1
  process.exit(1)
}
const sessionId = rawTransport.sessionId
check(
  '拿到 mcp-session-id → 确属 Streamable HTTP，而不是 SSE 降级',
  typeof sessionId === 'string' && sessionId.length > 0,
  `sessionId=${sessionId ?? '(空)'}`,
)
const serverVersion = rawClient.getServerVersion()
check('serverInfo 可读', serverVersion !== undefined, `name=${serverVersion?.name} version=${serverVersion?.version}`)
check('serverInfo.name 是 Nocturne', serverVersion?.name === 'Nocturne Memory Interface', serverVersion?.name ?? '(无)')
check('server 声明了 tools 能力', rawClient.getServerCapabilities()?.tools !== undefined)

/* ---------------------------------------------------------------- 2. 经我们 Gateway */
console.log('\n=== 2. 经 McpGateway（我们的生产代码路径）===')
const calls: Array<{ serverId: string; name: string }> = []
const gateway = new McpGateway([{ id: 'nocturne', url: DEMO_URL, token: null }])
/** 记录型包装：只用来统计实际发出的调用，行为与 gateway 完全一致 */
const recorder: ToolGateway = {
  listTools: (serverId?: string) => gateway.listTools(serverId),
  callTool: (serverId: string, name: string, args: Record<string, unknown>) => {
    calls.push({ serverId, name })
    return gateway.callTool(serverId, name, args)
  },
  health: () => gateway.health(),
  diagnostics: () => gateway.diagnostics(),
}
const memory = new NocturneMemoryProvider(recorder)

await gateway.connectAll()
const nocturne = (await gateway.health()).find((item) => item.serverId === 'nocturne')
check('状态机走到 ready', nocturne?.state === 'ready', `state=${nocturne?.state}`)
check('无残留错误', nocturne?.lastError === null, nocturne?.lastError ?? '')
check('lastCheckedAt 有值', typeof nocturne?.lastCheckedAt === 'number', `at=${nocturne?.lastCheckedAt ?? '(无)'}`)
check('工具数 = 2（Demo 只读模式）', nocturne?.toolCount === 2, `toolCount=${nocturne?.toolCount}`)

console.log('\n=== 3. 握手留痕（§7.2② 全量留痕）===')
const handshakeLog = listMcpDiagnostics({ serverId: 'nocturne', handshake: true, limit: 50 })
const initializeRow = handshakeLog.entries.find((entry) => entry.method === 'initialize')
check('有 handshake=true 的 initialize 记录', initializeRow !== undefined)
check(
  '该记录无错误且带耗时',
  initializeRow?.error === null && typeof initializeRow?.latencyMs === 'number',
  `latency=${initializeRow?.latencyMs ?? '(无)'}ms`,
)

/* ---------------------------------------------------------------- 4. 工具清单 */
console.log('\n=== 4. 工具清单 ===')
const listed = (await gateway.listTools('nocturne')) as Array<{ serverId: string; tools: ToolSummary[] }>
const tools = listed[0]?.tools ?? []
const names = tools.map((tool) => tool.name).sort()
check(
  '清单恰好是 Demo 开放的两个读工具',
  JSON.stringify(names) === JSON.stringify([...READ_TOOLS].sort()),
  names.join(', ') || '(空)',
)
const foundWriteTools = WRITE_TOOLS.filter((name) => names.includes(name))
check('写类工具一个都没有 → 客户端结构上无法写入', foundWriteTools.length === 0, foundWriteTools.join(', ') || '（无）')
check(
  '每个工具都下发了 description',
  tools.length > 0 && tools.every((tool) => typeof tool.description === 'string' && tool.description.trim() !== ''),
)
check(
  '每个工具都下发了 inputSchema',
  tools.length > 0 && tools.every((tool) => typeof tool.inputSchema === 'object' && tool.inputSchema !== null),
)
const readTool = tools.find((tool) => tool.name === 'read_memory')
const searchTool = tools.find((tool) => tool.name === 'search_memory')
check('read_memory 的 schema 声明了 uri 参数', schemaProps(readTool?.inputSchema).includes('uri'), schemaProps(readTool?.inputSchema).join(', '))
check('search_memory 的 schema 声明了 query 参数', schemaProps(searchTool?.inputSchema).includes('query'), schemaProps(searchTool?.inputSchema).join(', '))

/* ---------------------------------------------------------------- 5. system://boot */
console.log('\n=== 5. system://boot（经适配器 → tools/call）===')
let bootText = ''
let bootError: string | null = null
try {
  bootText = (await memory.recall()).text
} catch (err) {
  bootError = errMessage(err)
}
check('read_memory("system://boot") 未报错', bootError === null, bootError ?? '')
check('返回非空文本', bootText.trim().length > 0, `${bootText.trim().length} 字`)
check('确为真实内容而非占位（> 100 字）', bootText.trim().length > 100, `${bootText.trim().length} 字`)

/* ---------------------------------------------------------------- 6. search_memory（附加读路径） */
console.log('\n=== 6. search_memory（附加只读路径）===')
const query = deriveQuery(bootText)
let searchText = ''
let searchError: string | null = null
try {
  searchText = (await memory.search(query, { limit: 3 })).text
} catch (err) {
  searchError = errMessage(err)
}
check(`search_memory(query="${query}", limit=3) 未报错`, searchError === null, searchError ?? '')
check('返回非空文本', searchText.trim().length > 0, `${searchText.trim().length} 字`)

/* ---------------------------------------------------------------- 7. 只读保证 */
console.log('\n=== 7. 只读保证（本次到底发出过什么调用）===')
const callNames = calls.map((call) => call.name)
check('实际发出的调用全部落在读工具内', callNames.every((name) => READ_TOOLS.includes(name)), callNames.join(', ') || '(没发出调用)')
check('至少发出 2 次读调用（boot + search）', calls.length >= 2, `calls=${calls.length}`)
const toolCallLog = listMcpDiagnostics({ serverId: 'nocturne', handshake: false, limit: 100 })
const loggedCallCount = toolCallLog.entries.filter((entry) => entry.method === 'tools/call').length
check('每次读调用都在诊断表留痕', loggedCallCount === calls.length, `留痕 ${loggedCallCount} 条 / 实际 ${calls.length} 次`)

/* ---------------------------------------------------------------- 证据 */
console.log('\n=== 证据（真实抓到的字段）===')
console.log(`  demo           : ${DEMO_URL}`)
console.log(`  mcp-session-id : ${sessionId ?? '(空)'}`)
console.log(`  serverInfo     : ${serverVersion?.name ?? '?'} v${serverVersion?.version ?? '?'}`)
console.log(`  工具清单       : ${names.join(', ')}`)
console.log(`  实际调用       : ${callNames.join(', ')}`)
console.log(`  boot 正文前 160 字：\n    ${bootText.trim().slice(0, 160).replace(/\n/g, '\n    ')}`)

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} ===`)
if (failed > 0) process.exitCode = 1

/* ---------------------------------------------------------------- 收尾 */
await rawClient.close().catch(() => undefined)
await gateway.closeAll()
closeDb()
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })
