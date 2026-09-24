/**
 * Nocturne MCP 工具面事实采集（**无假设版**）
 *
 * 与 `probe-nocturne-live.ts` 的分工 —— 差别很关键：
 *   live 版把「这个实例应该有哪些工具」**写死**了（现在是 breath / trace），
 *   实例的工具面一旦漂移，它只会打一堆 ✗，却**读不出实例到底有什么**。
 *   本脚本相反：**不假设任何工具名**，只做两件事 —— 握手 + listTools，然后把工具面原样摊开。
 *
 * 纪律：**绝不调用任何工具**（不读、不写）。跑一万次也不会动到你的记忆。
 *
 * 它为什么存在（2026-09-24 发现 → 同日已收敛）：
 *   Habitat 的适配层原先按「官方 Nocturne 只读 Demo」的工具名写
 *   （`.env.example` 里那行 `MCP_NOCTURNE_URL=https://misaligned.top/mcp`），
 *   而北北自部署的实例自称 **Nocturne**（部署留档记 **Ombre Brain v1.30.0**），
 *   真实工具面是 `breath` / `trace` / `hold` / `wander` / `wander_mark` / `drive` /
 *   `undercurrent` / `trail_delta` / `trail_family` —— 与旧假设 **0/5 命中**。
 *   旧适配层要的 5 个名一个都不在，所以那次不是「改几个字符串」，是接口要重设计。
 *
 *   收敛结果（现在）：`MemoryProvider` 只留只读两方法 —— `recall()`→`breath`（无参）、
 *   `search()`→`trace(query, limit)`；写类端点全部撤掉。见 `src/providers/nocturne-memory.ts`。
 *
 * 📌 本脚本现在的用途 = **漂移检测**：实例升级 / 换血统 / 改工具名时，先跑它看一手事实，
 *    再决定要不要动适配层。对照表 `HABITAT_EXPECTED` 与适配层保持同步。
 *    ⚠️ 它**不替代验收** —— 只读链路的端到端验收是 `scripts/probe-memory.ts`。
 *
 * 用法（两处也可先写进 `server/.env`；真实环境变量优先于 .env）：
 *   cd server
 *   MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' npx tsx scripts/probe-nocturne-tools.ts
 *
 *   `NOCTURNE_SHOW_SECRET=1` 才会把密钥路径完整打印（默认打码，防截图/贴日志时外泄）。
 *   退出码非 0 只在**握手失败**时给出（工具面对不上不算「脚本失败」，那是事实）。
 *
 * ⚠️ 与 `probe-nocturne-tools-standalone.mjs` 的分工（**别装错**）：
 *   本文件（.ts）要 habitat 仓库 + tsx，适合**开发机**；
 *   `.mjs` 那个是**零依赖单文件**，适合「服务器上还没有仓库」的场合 ——
 *   Node 18+ 直接 `node probe-nocturne-tools-standalone.mjs` 就能跑，什么都不用装。
 *   两者输出口径一致（同一份对照表），随便用哪个都行。
 */
import '../src/lib/env.js'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = (process.env.MCP_NOCTURNE_URL ?? '').trim()
const TOKEN = (process.env.MCP_NOCTURNE_TOKEN ?? '').trim()
const NAMESPACE = (process.env.MCP_NOCTURNE_NAMESPACE ?? '').trim()
const SHOW_SECRET = process.env.NOCTURNE_SHOW_SECRET === '1'

/**
 * Habitat 适配层目前**写死**在代码里的工具名 —— 用来做「期望 vs 实际」对照。
 * 这份清单的出处：`src/providers/nocturne-memory.ts` 的 `NOCTURNE_TOOLS` 映射表。
 * ⚠️ 改适配层时同步改这里，否则本脚本的对照会失真。
 */
const HABITAT_EXPECTED: ReadonlyArray<{ name: string; usedBy: string }> = [
  { name: 'breath', usedBy: 'recall()（读全部，无参数）' },
  { name: 'trace', usedBy: 'search(query, limit)（关键词搜）' },
]

/** 密钥路径打码：/mcp-bff094f6…4af2d088 —— 保留头尾足以核对，中间不落地 */
function maskUrl(raw: string): string {
  if (SHOW_SECRET) return raw
  try {
    const url = new URL(raw)
    const segs = url.pathname.split('/').filter((seg) => seg !== '')
    const masked = segs.map((seg) => {
      if (/^mcp-[0-9a-f]{16,}$/i.test(seg)) return `${seg.slice(0, 8)}…${seg.slice(-6)}`
      return seg
    })
    url.pathname = `/${masked.join('/')}`
    return url.toString()
  } catch {
    return raw
  }
}

function errMessage(err: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = err
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.message)
      current = current.cause
      continue
    }
    parts.push(String(current))
    break
  }
  return parts.join(' <- ')
}

/** 把握手报错翻译成「卡在哪一层」—— 这次按**已知的部署事实**给提示，不再假设 nginx 没配 */
function diagnose(message: string): string[] {
  const hints: string[] = []
  if (/\b404\b/.test(message)) {
    hints.push('HTTP 404 —— 这个实例**故意**封了公开的 /mcp（nginx: `location = /mcp { return 404; }`）。')
    hints.push('  要走的路径是**加密钥的那条**：/mcp-<32位十六进制>。')
    hints.push('  ① 先确认你填的 URL 带密钥段；② 若带密钥仍 404，密钥可能已被更换 → 见 docs 的「换密钥」一节。')
    hints.push('  在服务器上验内网（绕开反代）：curl -i http://127.0.0.1:8000/mcp -X POST ...')
  }
  if (/\b401\b|\b403\b/.test(message)) {
    hints.push('HTTP 401/403 —— 鉴权被拒。该实例的访问控制是**靠秘密路径**而不是 Bearer，')
    hints.push('  所以先怀疑「URL 的密钥段不对」；若确实另加了 Basic Auth/鉴权头，再核对 MCP_NOCTURNE_TOKEN。')
  }
  if (/ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|socket hang up|ETIMEDOUT|aborted/i.test(message)) {
    hints.push('连不上 —— 核对主机/端口、本机能否出网、以及 8000 端口的容器是否在跑（docker compose ps）。')
  }
  if (/certificate|CERT_|self-signed|unable to verify/i.test(message)) {
    hints.push('TLS 证书问题 —— openssl s_client -connect <主机>:443 -servername <域名> -showcerts 看链是否完整。')
  }
  return hints
}

function schemaProps(schema: unknown): { props: string[]; required: string[] } {
  if (typeof schema !== 'object' || schema === null) return { props: [], required: [] }
  const obj = schema as { properties?: unknown; required?: unknown }
  const props =
    typeof obj.properties === 'object' && obj.properties !== null
      ? Object.keys(obj.properties as Record<string, unknown>)
      : []
  const required = Array.isArray(obj.required) ? obj.required.filter((r): r is string => typeof r === 'string') : []
  return { props, required }
}

if (MCP_URL === '') {
  console.log('\n✗ 没配 MCP_NOCTURNE_URL。')
  console.log('  例：MCP_NOCTURNE_URL=\'https://beiyan.cc/mcp-<密钥>\' npx tsx scripts/probe-nocturne-tools.ts')
  console.log('  （密钥见你本机的 MCP接入说明_Nocturne.md；默认打印时会被打码）')
  process.exit(1)
}

console.log('\n=== 目标 ===')
console.log(`  地址        : ${maskUrl(MCP_URL)}`)
console.log(`  Bearer      : ${TOKEN === '' ? '(未配)' : `已配（${TOKEN.length} 字符，不打印内容）`}`)
console.log(`  X-Namespace : ${NAMESPACE === '' ? '(未配 → 走实例默认空间)' : NAMESPACE}`)
console.log('  纪律        : 只握手 + listTools，**不调用任何工具**')

/* ------------------------------------------------------------------ 1. 握手 */
console.log('\n=== 1. 握手 ===')
const headers: Record<string, string> = {}
if (TOKEN !== '') headers.Authorization = `Bearer ${TOKEN}`
if (NAMESPACE !== '') headers['X-Namespace'] = NAMESPACE

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers } })
const client = new Client({ name: 'habitat-scan-tools', version: '0.1.0' }, { capabilities: {} })

let handshakeError: string | null = null
try {
  await client.connect(transport)
} catch (err) {
  handshakeError = errMessage(err)
}

if (handshakeError !== null) {
  console.log(`  ✗ 握手失败：${handshakeError}`)
  console.log('\n  诊断：')
  const hints = diagnose(handshakeError)
  if (hints.length === 0) console.log('    （没匹配到已知模式 —— 把上面那段原始报错贴出来再看）')
  for (const hint of hints) console.log(`    ${hint}`)
  console.log('\n=== 结论：链路就不通，工具面无从谈起 —— 先解决 1 ===')
  await client.close().catch(() => undefined)
  process.exit(1)
}

const serverVersion = client.getServerVersion()
const capabilities = client.getServerCapabilities()
const sessionId = transport.sessionId

console.log('  ✓ 握手成功')
console.log(`  · serverInfo     : ${serverVersion?.name ?? '?'} v${serverVersion?.version ?? '?'}`)
console.log(`  · mcp-session-id : ${sessionId === undefined || sessionId === '' ? '(空)' : `${sessionId.slice(0, 8)}…（非空即确认是 Streamable HTTP，不是 SSE 降级）`}`)
console.log(`  · 声明能力       : ${capabilities === undefined ? '(无)' : Object.keys(capabilities).join(', ') || '(无)'}`)

/* ------------------------------------------------------------------ 2. 工具面 */
console.log('\n=== 2. 工具面（listTools 原样摊开）===')
let toolNames: string[] = []
let listError: string | null = null

interface ToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}
let tools: ToolInfo[] = []

try {
  const listed = (await client.listTools()) as { tools?: ToolInfo[] }
  tools = listed.tools ?? []
  toolNames = tools.map((tool) => tool.name).sort()
} catch (err) {
  listError = errMessage(err)
}

if (listError !== null) {
  console.log(`  ✗ listTools 失败：${listError}`)
  console.log('\n=== 结论：握手通了但读不到工具清单 —— 实例可能没开 tools 能力 ===')
  await client.close().catch(() => undefined)
  process.exit(1)
}

console.log(`  共 ${tools.length} 个工具\n`)
for (const tool of tools) {
  const { props, required } = schemaProps(tool.inputSchema)
  const desc = (tool.description ?? '').replace(/\s+/g, ' ').trim()
  console.log(`  ● ${tool.name}`)
  if (desc !== '') console.log(`      说明   : ${desc.length > 160 ? `${desc.slice(0, 160)}…` : desc}`)
  console.log(`      参数   : ${props.length === 0 ? '(无)' : props.join(', ')}`)
  if (required.length > 0) console.log(`      必填   : ${required.join(', ')}`)
  console.log('')
}

/* ------------------------------------------------------------------ 3. 期望 vs 实际 */
console.log('=== 3. 适配层期望 vs 实例实际 ===')
const missing = HABITAT_EXPECTED.filter((item) => !toolNames.includes(item.name))
const presentExpected = HABITAT_EXPECTED.filter((item) => toolNames.includes(item.name))

if (missing.length === 0) {
  console.log(`  ✓ 适配层依赖的 ${HABITAT_EXPECTED.length} 个工具，实例**全部都有** —— 工具面无漂移。`)
} else {
  console.log(`  ⚠️ 适配层依赖的工具里，有 ${missing.length} / ${HABITAT_EXPECTED.length} 个实例**没有**（工具面漂移）：`)
  for (const item of missing) console.log(`      · ${item.name}  （适配层用于 ${item.usedBy}）`)
  if (presentExpected.length > 0) {
    console.log(`  · 实例确实有的：${presentExpected.map((item) => item.name).join(', ')}`)
  }
  const unknownToUs = toolNames.filter((name) => !HABITAT_EXPECTED.some((item) => item.name === name))
  if (unknownToUs.length > 0) {
    console.log(`  · 实例有、而适配层从未听说过的工具：${unknownToUs.join(', ')}`)
  }
  console.log('\n  ⚠️ 工具面漂移通常**不是改几个字符串**能解决的 —— 名字变了往往意味着数据模型也变了。')
  console.log('     适配层现在走的是「breath 读全部 + trace 关键词搜」这套语义（见 src/providers/nocturne-memory.ts）。')
  console.log('     先把上面这份「实例真实工具面」和适配层的调用点对齐，确认新名字怎么承载同一件事，')
  console.log('     再改 `NOCTURNE_TOOLS` 映射表；改完同步更新本脚本的 HABITAT_EXPECTED。')
  console.log('     若新实例的语义确实不同（例如 URI 树 / 九维驱动），那就是接口要重新设计，先停下来跟北北确认。')
}

/* ------------------------------------------------------------------ 证据 */
console.log('\n=== 证据（真实抓到的字段）===')
console.log(`  地址       : ${maskUrl(MCP_URL)}`)
console.log(`  serverInfo : ${serverVersion?.name ?? '?'} v${serverVersion?.version ?? '?'}`)
console.log(`  工具名     : ${toolNames.join(', ') || '(空)'}`)
console.log(`  工具数     : ${tools.length}`)
console.log(`  namespace  : ${NAMESPACE === '' ? '(默认空间)' : NAMESPACE}`)
console.log('  实际调用   : (无 —— 本脚本不调用任何工具)')

console.log('\n=== 汇总 ===')
console.log(`  链路     : ${handshakeError === null ? '通' : '不通'}`)
console.log(`  工具面   : ${missing.length === 0 ? '与适配层期望一致' : '与适配层期望不一致（漂移，见 §3）'}`)
console.log('  端到端验收: 本脚本不做 —— 只读链路验收请跑 scripts/probe-memory.ts')

await client.close().catch(() => undefined)
