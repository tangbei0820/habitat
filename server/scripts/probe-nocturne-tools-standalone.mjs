#!/usr/bin/env node
/**
 * Nocturne MCP 工具面侦察 —— **零依赖单文件版**（只用 Node 内置能力）
 *
 * 为什么有这个版本：
 *   `probe-nocturne-tools.ts` 要 habitat 仓库 + tsx 才能跑，适合「本机开发机」。
 *   但真正需要侦察的时刻往往是「在服务器上、仓库还没同步过去」——
 *   这时 `cd server` 会找不到目录，`npx tsx` 还要现下载。本文件把依赖降到 0：
 *   Node 18+ 直接 `node probe-nocturne-tools-standalone.mjs` 即可。
 *
 * ★ 它**不调用任何工具**：只做 initialize 握手 + tools/list。
 *   跑一万次也不会读、不会写你的记忆。
 *
 * 用法：
 *   node probe-nocturne-tools-standalone.mjs                      # 默认打内网 http://127.0.0.1:8000/mcp
 *   node probe-nocturne-tools-standalone.mjs http://127.0.0.1:8000/mcp
 *   MCP_NOCTURNE_URL='https://beiyan.cc/mcp-<密钥>' node probe-nocturne-tools-standalone.mjs
 *   MCP_NOCTURNE_TOKEN=xxx node probe-nocturne-tools-standalone.mjs   # 仅当实例启用了 api_token
 *
 * 输出默认对 URL 里的密钥段打码；要全显设 NOCTURNE_SHOW_SECRET=1。
 */

const RAW_URL = (process.argv[2] ?? process.env.MCP_NOCTURNE_URL ?? 'http://127.0.0.1:8000/mcp').trim()
const TOKEN = (process.env.MCP_NOCTURNE_TOKEN ?? '').trim()
const SHOW_SECRET = process.env.NOCTURNE_SHOW_SECRET === '1'
const TIMEOUT_MS = Number(process.env.NOCTURNE_PROBE_TIMEOUT_MS ?? 20000)

/** 适配层 `server/src/providers/nocturne-memory.ts` 里**写死的** 5 个工具名。用于逐条对照。 */
const EXPECTED = ['read_memory', 'search_memory', 'create_memory', 'update_memory', 'delete_memory']

const maskedUrl = SHOW_SECRET ? RAW_URL : RAW_URL.replace(/\/(mcp)-[A-Za-z0-9_-]{6,}/, '/$1-******')

let sessionId = ''
let idSeq = 0

/** 从响应体里取出 JSON-RPC 报文：可能是纯 JSON，也可能是 SSE（`data: {...}` 若干行）。 */
function parseRpc(text) {
  const t = text.trim()
  if (t === '') return null
  try {
    return JSON.parse(t)
  } catch {}
  const found = []
  for (const line of t.split(/\r?\n/)) {
    const m = /^data:\s*(.*)$/.exec(line)
    if (!m) continue
    try {
      found.push(JSON.parse(m[1]))
    } catch {}
  }
  return found.find((o) => o && (o.result !== undefined || o.error !== undefined)) ?? found[0] ?? null
}

async function rpc(method, params, { notify = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId !== '') headers['mcp-session-id'] = sessionId
  if (TOKEN !== '') headers['Authorization'] = `Bearer ${TOKEN}`

  const body = notify
    ? { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }
    : { jsonrpc: '2.0', id: ++idSeq, method, ...(params === undefined ? {} : { params }) }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(RAW_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const sid = res.headers.get('mcp-session-id')
  if (sid !== null && sid !== '') sessionId = sid

  const text = await res.text()
  const out = { status: res.status, contentType: res.headers.get('content-type') ?? '', text, notify }
  if (notify === false) out.parsed = parseRpc(text)
  return out
}

function fail(msg, extra) {
  console.error('')
  console.error(`✖ ${msg}`)
  if (extra !== undefined) console.error(extra)
  process.exit(1)
}

function describeSchema(schema) {
  const props = schema?.properties ?? {}
  const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
  return Object.entries(props).map(([name, v]) => {
    let type = '?'
    if (typeof v?.type === 'string') type = v.type
    else if (Array.isArray(v?.type)) type = v.type.join('|')
    else if (Array.isArray(v?.anyOf)) type = v.anyOf.map((x) => x?.type ?? '?').join('|')
    return {
      name,
      required: required.has(name),
      type,
      desc: String(v?.description ?? '').replace(/\s+/g, ' ').trim(),
    }
  })
}

const line = '='.repeat(64)

console.log(line)
console.log(' Nocturne MCP 工具面侦察（零依赖版）')
console.log(line)
console.log(` 目标     : ${maskedUrl}`)
console.log(` 鉴权     : ${TOKEN === '' ? '未携带 Bearer（走路径即密码 / 或实例未启用）' : '已携带 Bearer'}`)
console.log('')

/* ---------- 一、握手 ---------- */
let init
try {
  init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'habitat-probe', version: '1.0.0' },
  })
} catch (err) {
  fail(
    `连不上：${maskedUrl}`,
    `  原始错误：${err?.cause?.code ?? err?.name ?? '?'} ${err?.message ?? err}\n` +
      '  排查顺序：\n' +
      '    1) 容器活着吗     → docker ps | grep -i nocturne\n' +
      '    2) 端口通吗       → curl -i http://127.0.0.1:8000/dashboard\n' +
      '    3) 路径对吗       → 内网直连用 /mcp；走公网才用 /mcp-<密钥>',
  )
}

if (init.status !== 200) {
  fail(
    `握手返回 HTTP ${init.status}（期望 200）`,
    `  响应前 500 字：\n${init.text.slice(0, 500)}`,
  )
}

const initResult = init.parsed?.result
if (initResult === undefined) {
  fail(
    '握手没有拿到 result —— 服务端不是按 MCP 协议回的',
    `  响应前 500 字：\n${init.text.slice(0, 500)}`,
  )
}

const serverInfo = initResult.serverInfo
console.log(' ✔ 握手成功')
console.log(`   协议版本  : ${initResult.protocolVersion ?? '?'}`)
console.log(`   服务端    : ${serverInfo?.name ?? '?'} v${serverInfo?.version ?? '?'}`)
console.log(
  `   会话 ID   : ${sessionId === '' ? '(空 —— 服务端未用 Streamable HTTP 会话)' : `${sessionId.slice(0, 12)}…（非空 → 确认是 Streamable HTTP）`}`,
)
if (init.contentType.includes('text/event-stream')) {
  console.log('   响应形态  : text/event-stream（SSE 分帧）')
}
console.log('')

/* ---------- 二、initialized 通知（失败不致命） ---------- */
try {
  const n = await rpc('notifications/initialized', undefined, { notify: true })
  console.log(` ✔ 已发送 initialized 通知（HTTP ${n.status}）`)
} catch (err) {
  console.log(` ⚠ initialized 通知未成功（${err?.message ?? err}）—— 多数实现不强制，继续`)
}
console.log('')

/* ---------- 三、拉工具面 ---------- */
const list = await rpc('tools/list', {})
if (list.status !== 200) {
  fail(`tools/list 返回 HTTP ${list.status}`, `  响应前 500 字：\n${list.text.slice(0, 500)}`)
}
const tools = list.parsed?.result?.tools
if (!Array.isArray(tools)) {
  fail('tools/list 没返回 tools 数组', `  响应前 500 字：\n${list.text.slice(0, 500)}`)
}

console.log(line)
console.log(` 实例真实工具面：共 ${tools.length} 个`)
console.log(line)
tools.forEach((t, i) => {
  console.log('')
  console.log(` ── ${i + 1}) ${t.name ?? '(无名)'} ──────────────────────────`)
  const d = String(t.description ?? '').replace(/\s+/g, ' ').trim()
  if (d !== '') console.log(`    说明 : ${d}`)
  const rows = describeSchema(t.inputSchema)
  if (rows.length === 0) {
    console.log('    参数 : (无)')
  } else {
    console.log('    参数 :')
    for (const r of rows) {
      const flag = r.required ? '必填' : '可选'
      console.log(`      · ${r.name} [${flag}] ${r.type}${r.desc === '' ? '' : ` — ${r.desc}`}`)
    }
  }
  const topRequired = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : []
  if (topRequired.length > 0) console.log(`    顶层必填 : ${topRequired.join(', ')}`)
})

/* ---------- 四、与适配层写死的名字对照 ---------- */
const realNames = new Set(tools.map((t) => t.name))
console.log('')
console.log(line)
console.log(' 与适配层写死的 5 个名字对照')
console.log('   （来源：server/src/providers/nocturne-memory.ts）')
console.log(line)
for (const name of EXPECTED) {
  const hit = realNames.has(name)
  console.log(`  ${hit ? '✅' : '❌'} ${name}${hit ? '' : '   ← 实例里没有这个名字'}`)
}
const extra = tools.map((t) => t.name).filter((n) => !EXPECTED.includes(n))
if (extra.length > 0) {
  console.log('')
  console.log(`  实例有、适配层不知道的（${extra.length} 个）：`)
  for (const n of extra) console.log(`    + ${n}`)
}

const matched = EXPECTED.filter((n) => realNames.has(n)).length
console.log('')
console.log(line)
if (matched === EXPECTED.length) {
  console.log(` 结论：5/5 全对上 —— 适配层的工具名假设成立，链路可直接用。`)
} else if (matched === 0) {
  console.log(` 结论：0/5 —— 工具面完全不同（${tools.length} 个工具无一命中）。`)
  console.log('       这不是改字符串的事：要重新映射语义，可能还要重定 MemoryProvider 接口。')
  console.log('       请把上面这份完整输出贴回 habitat 仓库，按真实工具面定映射。')
} else {
  console.log(` 结论：${matched}/5 命中 —— 部分对得上，需要逐个核对语义是否一致。`)
  console.log('       请把上面这份完整输出贴回 habitat 仓库。')
}
console.log(line)
