/**
 * Phase 3B · 自部署 Nocturne 接入验真（反代 / Token / Namespace / 工具面）
 * （技术方案 §9 风险1 对策的后半句「再排阿里云链路」；`docs/MEMORY.md` → 「复验方式」）
 *
 * 与 `probe-nocturne-demo.ts` 的分工：
 *   demo 版打的是 Nocturne **官方只读 Demo** —— 验的是「我们的客户端代码对不对」；
 *   本脚本打的是**自己部署的实例** —— 验的是「部署链路对不对」：
 *   反代有没有把 MCP 路径转发进来、Bearer Token 认不认、X-Namespace 收不收、
 *   以及这个实例真实开放了哪些工具。
 *
 * ⚠️ 两者有一个关键差别，它决定了本脚本的纪律：
 *   Demo 是**服务端物理只读**（只下发 2 个读工具），而自部署实例是**完整 9 个工具、含写**
 *   （`hold` 写记忆、`wander_mark` 表态、`drive` 调驱动 …）。
 *   也就是说「不写坏数据」**没有服务端兜底**，只能靠本脚本自己守住 ——
 *   全程只调读工具，并用记录型包装断言「实际发出的调用」确实落在读工具内。
 *
 * 用法（三项也可先写进 `server/.env`，脚本自己会读；真实环境变量优先于 .env）：
 *   cd server && MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<32位密钥>' \
 *     MCP_NOCTURNE_NAMESPACE=habitat \
 *     npx tsx scripts/probe-nocturne-live.ts
 *
 * ⚠️ 地址是**加密钥的那条**（`/mcp-<密钥>`），不是公开的 `/mcp` —— 后者被 nginx 特意 404 掉了。
 *    服务器上（仓库不在手边）用内网直连 `http://127.0.0.1:8000/mcp`，免密钥。
 *
 * 工具面（2026-09-24 实测收敛，不再是「官方 Demo 的读 2 写 5」）：
 *   实例真实开放 9 个 —— `breath` / `trace` / `hold` / `wander` / `wander_mark` /
 *   `drive` / `undercurrent` / `trail_delta` / `trail_family`；
 *   Habitat 只**依赖其中 2 个只读工具**：`recall()`→`breath`（无参）、`search()`→`trace(query, limit)`。
 *   写成常量的是下面 READ_TOOLS / WRITE_TOOLS 两张表 —— 与
 *   `src/providers/nocturne-memory.ts` 的 `NOCTURNE_TOOLS` 保持同步。
 *   ⚠️ 若工具名漂移，§6 起会失败 —— 先跑 `probe-nocturne-tools*.{ts,mjs,sh}` 拿一手事实。
 *
 * `NOCTURNE_PROBE_PREVIEW=1` 才会打印 boot 正文前 80 字 —— 默认不打印，那是你本人的记忆内容。
 * 退出码非 0 表示有断言失败。标 ⚠️ 的是**警告**（部署事实，不算我们代码的错）。
 */
import '../src/lib/env.js'

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolGateway } from '@shared/providers.js'

// env 已由上面那行 import 的副作用读入（ESM 里 import 先于本模块体求值）
const MCP_URL = (process.env.MCP_NOCTURNE_URL ?? '').trim()
const TOKEN = (process.env.MCP_NOCTURNE_TOKEN ?? '').trim()
const NAMESPACE = (process.env.MCP_NOCTURNE_NAMESPACE ?? '').trim()
const PREVIEW = process.env.NOCTURNE_PROBE_PREVIEW === '1'
const SHOW_SECRET = process.env.NOCTURNE_SHOW_SECRET === '1'

/** 默认遮住秘密路径；只有显式 NOCTURNE_SHOW_SECRET=1 才打印完整 URL。 */
function maskUrl(raw: string): string {
  if (SHOW_SECRET) return raw
  const maskSegment = (segment: string): string => `${segment.slice(0, 8)}...${segment.slice(-6)}`
  try {
    const url = new URL(raw)
    const masked = url.pathname.split('/').filter(Boolean).map((segment) =>
      /^mcp-[0-9a-f]{16,}$/i.test(segment) ? maskSegment(segment) : segment,
    )
    url.pathname = `/${masked.join('/')}`
    return url.toString()
  } catch {
    return raw.replace(/mcp-[0-9a-f]{16,}/gi, maskSegment)
  }
}

const SAFE_MCP_URL = maskUrl(MCP_URL)

/** Habitat 只依赖的只读工具（`recall()` / `search()` 的落点） */
const READ_TOOLS = ['breath', 'trace']
/** 实例具备、但 Habitat 只读接入**绝不调用**的写类工具（§9 会断言一次都没发出） */
const WRITE_TOOLS = ['hold', 'wander', 'wander_mark', 'drive']
const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, 'undercurrent', 'trail_delta', 'trail_family']

// 带上 pid，避免两个验真进程并行时互删/争抢同一个 SQLite 文件。
const DB_PATH = `./data/probe-nocturne-live-${process.pid}.db`
process.env.HABITAT_DB_PATH = DB_PATH
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })

// 必须等 HABITAT_DB_PATH 落到 env 之后再加载 db/index.js（模块加载期就读环境变量）
const { McpGateway } = await import('../src/mcp/gateway.js')
const { NocturneMemoryProvider } = await import('../src/providers/nocturne-memory.js')
const { listMcpDiagnostics } = await import('../src/db/diagnostics.js')
const { closeDb } = await import('../src/db/index.js')

let passed = 0
let failed = 0
let warned = 0

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

/** 警告：部署事实（例如服务端没开鉴权），不是我们代码的错，不计入失败 */
function warn(label: string, extra = ''): void {
  warned += 1
  console.log(`  ⚠️ ${label}${extra === '' ? '' : `  ${extra}`}`)
}

function info(label: string, extra = ''): void {
  console.log(`  · ${label}${extra === '' ? '' : `  ${extra}`}`)
}

function errMessage(err: unknown): string {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = err

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      const code = 'code' in current && typeof current.code === 'string' ? ` [${current.code}]` : ''
      messages.push(`${current.message}${code}`)
      current = current.cause
      continue
    }
    messages.push(String(current))
    break
  }

  const message = messages.join(' <- ')
  return MCP_URL === '' ? message : message.split(MCP_URL).join(SAFE_MCP_URL)
}

function removeProbeDb(): void {
  for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })
}

function schemaProps(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return []
  const props = (schema as { properties?: unknown }).properties
  if (typeof props !== 'object' || props === null) return []
  return Object.keys(props as Record<string, unknown>)
}

/** 取 inputSchema.required（拿不到就是空数组） */
function schemaRequired(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return []
  const required = (schema as { required?: unknown }).required
  return Array.isArray(required) ? required.map((item) => String(item)) : []
}

/** 从正文里取一个词当搜索词 —— 避免把实例里的内容写死在断言里 */
function deriveQuery(text: string): string {
  return text.match(/[\u4e00-\u9fff]{2,}/)?.[0]?.slice(0, 4) ?? text.match(/[A-Za-z]{4,}/)?.[0] ?? 'memory'
}

/** 握手的可携带头。namespace 只在显式配置时带上，避免污染默认空间。 */
function headersFor(withToken: boolean): Record<string, string> {
  const headers: Record<string, string> = {}
  if (withToken && TOKEN !== '') headers.Authorization = `Bearer ${TOKEN}`
  if (NAMESPACE !== '') headers['X-Namespace'] = NAMESPACE
  return headers
}

/** 把握手报错翻译成「卡在哪一层」—— 这个脚本有一半价值在这里 */
function diagnose(message: string): string[] {
  const hints: string[] = []
  if (/\b404\b/.test(message)) {
    hints.push('HTTP 404 —— 别急着去服务器改 nginx：这个实例的 /mcp 是**故意**被封的')
    hints.push('  （加固片段 `location = /mcp { return 404; }`），访问控制靠**秘密路径**而不是 Bearer Token。')
    hints.push('  → 要走的地址是 /mcp-<32位十六进制>，不是 /mcp。')
    hints.push('  ① 先确认 MCP_NOCTURNE_URL 里带了密钥段（见 docs/MEMORY.md「秘密路径」一节）；')
    hints.push('  ② 带密钥仍 404 → 密钥可能已被更换，按同节步骤换一个。')
    hints.push('  绕开反代验内网：curl -i http://127.0.0.1:8000/mcp -X POST -H "Content-Type: application/json" ...')
  }
  if (/\b401\b|\b403\b/.test(message)) {
    hints.push('HTTP 401/403 —— 鉴权被拒：核对 MCP_NOCTURNE_TOKEN 对不对、有没有过期。')
  }
  if (/ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|socket hang up/i.test(message)) {
    hints.push('连不上 —— 核对 MCP_NOCTURNE_URL 的主机/端口，以及本机能不能出网。')
  }
  if (/certificate|CERT_|self-signed|unable to verify/i.test(message)) {
    hints.push('TLS 证书问题 —— openssl s_client -connect <主机>:443 -servername <域名> -showcerts 看链是否完整。')
  }
  return hints
}

if (MCP_URL === '') {
  console.log('\n✗ 没配 MCP_NOCTURNE_URL —— 自部署验真必须先有地址（例如 https://beiyan.cc/mcp）。')
  console.log('  只想验客户端代码、不打自己实例的话，请跑 probe-nocturne-demo.ts。')
  closeDb()
  removeProbeDb()
  process.exit(1)
}

interface ToolSummary {
  name: string
  description?: string
  inputSchema?: unknown
}

console.log('\n=== 0. 目标与配置 ===')
console.log(`  实例地址    : ${SAFE_MCP_URL}`)
console.log(`  Bearer      : ${TOKEN === '' ? '(未配)' : `已配（${TOKEN.length} 字符，不打印内容）`}`)
console.log(`  X-Namespace : ${NAMESPACE === '' ? '(未配 → 走实例默认空间)' : NAMESPACE}`)

let origin = ''
try {
  origin = new URL(MCP_URL).origin
} catch {
  /* 下面那条 check 会报出来 */
}
check('MCP_NOCTURNE_URL 是合法 URL', origin !== '', SAFE_MCP_URL)

/* ---------------------------------------------------------------- 1. 反代可达性 */
console.log('\n=== 1. 反代可达性（REST 例外：只探 /health）===')
if (origin !== '') {
  let healthStatus = 0
  let healthBody = ''
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10_000) })
    healthStatus = res.status
    healthBody = (await res.text()).trim()
  } catch (err) {
    info('探测 /health 抛错', errMessage(err))
  }
  check(`${origin}/health 返回 200（Nocturne 进程活着）`, healthStatus === 200, `status=${healthStatus === 0 ? '(连不上)' : healthStatus}`)
  if (healthStatus === 200) info('健康正文', healthBody.slice(0, 120))
  else info('提示', '/health 不通不等于 MCP 不通（也可能只暴露了 MCP 路径）—— 继续往下验握手')
}

/* ---------------------------------------------------------------- 2. 原始 SDK 直连 */
console.log('\n=== 2. 原始 SDK 直连：握手（隔离协议层）===')
const rawTransport = new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: headersFor(true) } })
const rawClient = new Client({ name: 'habitat-probe-live', version: '0.1.0' }, { capabilities: {} })
let handshakeError: string | null = null
try {
  await rawClient.connect(rawTransport)
} catch (err) {
  handshakeError = errMessage(err)
}
check('initialize 握手成功', handshakeError === null, handshakeError ?? '')
if (handshakeError !== null) {
  console.log('\n  诊断：')
  const hints = diagnose(handshakeError)
  if (hints.length === 0) console.log('    （没匹配到已知模式，把上面那段原始报错贴出来）')
  for (const hint of hints) console.log(`    ${hint}`)
  console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} —— 握手都没成立，后面没意义，提前退出 ===`)
  await rawClient.close().catch(() => undefined)
  closeDb()
  removeProbeDb()
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
check('server 声明了 tools 能力', rawClient.getServerCapabilities()?.tools !== undefined)

/* ---------------------------------------------------------------- 3. 鉴权对照 */
console.log('\n=== 3. 鉴权对照（故意不带 Bearer 再握一次）===')
if (TOKEN === '') {
  warn('本实例没配 Bearer —— 无法做「鉴权有没有生效」的对照')
} else {
  const bareTransport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: headersFor(false) },
  })
  const bareClient = new Client({ name: 'habitat-probe-nobearer', version: '0.1.0' }, { capabilities: {} })
  let bareError: string | null = null
  try {
    await bareClient.connect(bareTransport)
  } catch (err) {
    bareError = errMessage(err)
  }
  if (bareError === null) {
    warn('不带 Token 也能握手成功 —— 该实例**没有强制鉴权**', '（我们客户端仍会带 Token，但服务端这层是空的）')
    await bareClient.close().catch(() => undefined)
  } else {
    check('不带 Token 被拒（鉴权这层真的在生效）', true, bareError)
  }
}

/* ---------------------------------------------------------------- 4. X-Namespace */
console.log('\n=== 4. X-Namespace ===')
if (NAMESPACE === '') {
  info('未配 namespace → 走实例默认空间', '(单人格本就该留空；多 AI 共用同一实例时才需要)')
} else {
  check('握手携带了 X-Namespace 且未被服务端拒绝', true, `X-Namespace: ${NAMESPACE}`)
  warn('服务端不回显当前空间 —— 隔离是否真的生效，得在你那边另行确认（见 docs/MEMORY.md）')
}

/* ---------------------------------------------------------------- 5. 经我们 Gateway */
console.log('\n=== 5. 经 McpGateway（我们的生产代码路径）===')
const calls: Array<{ serverId: string; name: string }> = []
const gateway = new McpGateway([
  { id: 'nocturne', url: MCP_URL, token: TOKEN === '' ? null : TOKEN, headers: headersFor(false) },
])
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

const handshakeLog = listMcpDiagnostics({ serverId: 'nocturne', handshake: true, limit: 50 })
const initializeRow = handshakeLog.entries.find((entry) => entry.method === 'initialize')
check('有 handshake=true 的 initialize 记录（§7.2② 全量留痕）', initializeRow !== undefined)
check(
  '该记录无错误且带耗时',
  initializeRow?.error === null && typeof initializeRow?.latencyMs === 'number',
  `latency=${initializeRow?.latencyMs ?? '(无)'}ms`,
)

/* ---------------------------------------------------------------- 6. 工具清单 */
console.log('\n=== 6. 工具清单（实例真实工具面 vs Habitat 依赖的子集）===')
const listed = (await gateway.listTools('nocturne')) as Array<{ serverId: string; tools: ToolSummary[] }>
const tools = listed[0]?.tools ?? []
const names = tools.map((tool) => tool.name).sort()
check(
  '适配层依赖的只读工具都在清单里',
  READ_TOOLS.every((name) => names.includes(name)),
  names.join(', ') || '(空)',
)
check(
  '每个工具都下发了 description',
  tools.length > 0 && tools.every((tool) => typeof tool.description === 'string' && tool.description.trim() !== ''),
)
check(
  '每个工具都下发了 inputSchema',
  tools.length > 0 && tools.every((tool) => typeof tool.inputSchema === 'object' && tool.inputSchema !== null),
)
const foundWriteTools = WRITE_TOOLS.filter((name) => names.includes(name))
if (foundWriteTools.length > 0) {
  info('实例开放了写类工具（Demo 是没有的）', foundWriteTools.join(', '))
  warn('自部署实例能写 —— 「不写坏数据」现在只剩客户端自觉，没有服务端兜底')
} else {
  info('未发现写类工具', '该实例可能也开了只读模式，或版本与 Demo 不同')
}
const unknownTools = names.filter((name) => !ALL_TOOLS.includes(name))
if (unknownTools.length > 0) warn('出现已知清单之外的工具（版本可能已变）', unknownTools.join(', '))
const breathTool = tools.find((tool) => tool.name === 'breath')
const traceTool = tools.find((tool) => tool.name === 'trace')
const breathRequired = schemaRequired(breathTool?.inputSchema)
check('breath 不要求任何必填参数（它读「全部」）', breathRequired.length === 0, breathRequired.join(', ') || '(无必填)')
check(
  'trace 的 schema 声明了 query 参数',
  schemaProps(traceTool?.inputSchema).includes('query'),
  schemaProps(traceTool?.inputSchema).join(', '),
)

/* ---------------------------------------------------------------- 7. recall() → breath */
console.log('\n=== 7. recall() → breath（经适配器 → tools/call）===')
let bootText = ''
let bootError: string | null = null
try {
  bootText = (await memory.recall()).text
} catch (err) {
  bootError = errMessage(err)
}
check('recall()（→ breath，无参）未报错', bootError === null, bootError ?? '')
check('返回非空文本', bootText.trim().length > 0, `${bootText.trim().length} 字`)
if (bootText.trim().length > 0) {
  info('boot 正文长度', `${bootText.trim().length} 字`)
  if (PREVIEW) info('boot 正文前 80 字', bootText.trim().slice(0, 80).replace(/\n/g, '⏎'))
  else info('正文未打印', '要看加 NOCTURNE_PROBE_PREVIEW=1')
}

/* ---------------------------------------------------------------- 8. search() → trace */
console.log('\n=== 8. search() → trace（附加只读路径）===')
const query = deriveQuery(bootText)
let searchText = ''
let searchError: string | null = null
try {
  searchText = (await memory.search(query, { limit: 3 })).text
} catch (err) {
  searchError = errMessage(err)
}
check(`search(query="${query}", limit=3) 未报错`, searchError === null, searchError ?? '')
check('返回非空文本', searchText.trim().length > 0, `${searchText.trim().length} 字`)

/* ---------------------------------------------------------------- 9. 只读纪律 */
console.log('\n=== 9. 只读纪律（本次到底发出过什么调用）===')
const callNames = calls.map((call) => call.name)
check('实际发出的调用全部落在读工具内', callNames.every((name) => READ_TOOLS.includes(name)), callNames.join(', ') || '(没发出调用)')
check('一次写工具都没调用过', !callNames.some((name) => WRITE_TOOLS.includes(name)), callNames.join(', ') || '(没发出调用)')
check('至少发出 2 次读调用（breath + trace）', calls.length >= 2, `calls=${calls.length}`)
const toolCallLog = listMcpDiagnostics({ serverId: 'nocturne', handshake: false, limit: 100 })
const loggedCallCount = toolCallLog.entries.filter((entry) => entry.method === 'tools/call').length
check('每次读调用都在诊断表留痕', loggedCallCount === calls.length, `留痕 ${loggedCallCount} 条 / 实际 ${calls.length} 次`)

/* ---------------------------------------------------------------- 证据 */
console.log('\n=== 证据（真实抓到的字段）===')
console.log(`  实例地址       : ${SAFE_MCP_URL}`)
console.log(`  mcp-session-id : ${sessionId ?? '(空)'}`)
console.log(`  serverInfo     : ${serverVersion?.name ?? '?'} v${serverVersion?.version ?? '?'}`)
console.log(`  工具面         : ${names.join(', ') || '(空)'}`)
console.log(`  实际调用       : ${callNames.join(', ') || '(无)'}`)
console.log(`  namespace      : ${NAMESPACE === '' ? '(默认空间)' : NAMESPACE}`)
console.log(`  boot 正文      : ${bootText.trim().length} 字`)

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed}${warned > 0 ? `，另有 ${warned} 条警告` : ''} ===`)
if (failed > 0) process.exitCode = 1

/* ---------------------------------------------------------------- 收尾 */
await rawClient.close().catch(() => undefined)
await gateway.closeAll()
closeDb()
removeProbeDb()
