/**
 * 诊断日志查询端点验收脚本（**要求 server 已启动**）
 *
 * 前置：
 *   1) PORT=3100 HABITAT_DB_PATH=./data/probe.db npm run dev:server
 *   2) npx tsx scripts/probe-diagnostics.ts
 *
 * 为什么要直接连库写 fixture：诊断表的内容只由「MCP 真的握手 / 真的调工具」产生，
 * 而筛选与游标分页需要**确定的形状**（几条错、几条握手）才能断言。所以脚本用
 * 独立连接往同一个 SQLite 文件塞一批带唯一 `server_id` 标记的记录（WAL 模式下多进程可读写），
 * 结束前按标记删干净 —— 仓库里既有的真实记录一条都不动。
 *
 * 覆盖：默认排序 / 字段原样回传 / 三类筛选 / 组合筛选 / 游标分页（含「total 不随翻页变小」）/
 *       未知 serverId / 参数校验 7 种非法输入 / 真实记录可见性。
 * 退出码非 0 表示有断言失败。
 */
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { McpDiagnosticPage } from '@shared/types.js'

const BASE = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3100'
const DB_PATH = resolve(process.env.PROBE_DB ?? process.env.HABITAT_DB_PATH ?? './data/habitat.db')
/** fixture 的唯一标记：用它筛、也用它清理，绝不误伤真实记录 */
const MARKER = `probe-diag-${process.pid}`

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

interface Res {
  status: number
  body: unknown
}

async function get(path: string): Promise<Res> {
  const res = await fetch(`${BASE}${path}`)
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

function page(res: Res): McpDiagnosticPage {
  return res.body as McpDiagnosticPage
}

function errorCode(res: Res): unknown {
  return (res.body as { error?: { code?: unknown } } | null)?.error?.code
}

/** 只带 MARKER 筛选的查询（其余条件由调用方补） */
function diagQuery(extra = ''): Promise<Res> {
  return get(`/api/diagnostics/mcp?serverId=${encodeURIComponent(MARKER)}${extra}`)
}

/* ---------- fixture ---------- */

interface Fixture {
  handshake: boolean
  direction: 'in' | 'out'
  method: string
  httpStatus: number | null
  latencyMs: number | null
  error: string | null
}

const FIXTURES: Fixture[] = [
  { handshake: true, direction: 'out', method: 'initialize', httpStatus: null, latencyMs: 120, error: null },
  { handshake: true, direction: 'in', method: 'initialize', httpStatus: null, latencyMs: 900, error: null },
  { handshake: true, direction: 'out', method: 'initialize', httpStatus: null, latencyMs: null, error: 'probe 握手超时' },
  { handshake: false, direction: 'out', method: 'tools/list', httpStatus: 200, latencyMs: 12, error: null },
  { handshake: false, direction: 'out', method: 'tools/list', httpStatus: null, latencyMs: 33, error: null },
  { handshake: false, direction: 'out', method: 'tools/call', httpStatus: null, latencyMs: 45, error: 'probe 工具调用失败' },
  { handshake: false, direction: 'out', method: 'tools/call', httpStatus: null, latencyMs: null, error: 'probe 传输中断' },
]

const EXPECTED_TOTAL = FIXTURES.length
const EXPECTED_ERRORS = FIXTURES.filter((f) => f.error !== null).length
const EXPECTED_HANDSHAKE = FIXTURES.filter((f) => f.handshake).length
const EXPECTED_TOOL = EXPECTED_TOTAL - EXPECTED_HANDSHAKE

const sqlite = new Database(DB_PATH)
const tableExists =
  sqlite
    .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='mcp_diagnostic_log'`)
    .get() as { n: number }
if (tableExists.n === 0) {
  console.error(`\n数据库 ${DB_PATH} 里没有 mcp_diagnostic_log 表 —— 说明它还不是 server 的库文件。`)
  console.error('请用同一个 HABITAT_DB_PATH 启动 server，或设 PROBE_DB 指向正确的文件。\n')
  sqlite.close()
  process.exit(1)
}

function cleanup(): void {
  sqlite.prepare('DELETE FROM mcp_diagnostic_log WHERE server_id = ?').run(MARKER)
}

cleanup() // 上一轮异常退出可能留下残留
const insert = sqlite.prepare(
  `INSERT INTO mcp_diagnostic_log (server_id, direction, method, http_status, handshake, latency_ms, error, at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)
const now = Date.now()
FIXTURES.forEach((f, index) => {
  insert.run(MARKER, f.direction, f.method, f.httpStatus, f.handshake ? 1 : 0, f.latencyMs, f.error, now + index)
})

try {
  /* ---------- 默认排序与字段原样回传 ---------- */

  const all = await diagQuery()
  const allPage = page(all)
  check('默认查询返回 200', all.status === 200, `status=${all.status}`)
  check('total 等于 fixture 条数', allPage.total === EXPECTED_TOTAL, `total=${allPage.total}`)
  check('errorCount 等于带错条数', allPage.errorCount === EXPECTED_ERRORS, `errorCount=${allPage.errorCount}`)
  check('一页装得下时不报 hasMore', allPage.hasMore === false)
  check('条数等于 fixture 条数', allPage.entries.length === EXPECTED_TOTAL, `got=${allPage.entries.length}`)

  const ids = allPage.entries.map((e) => e.id)
  const sortedDesc = ids.every((id, i) => i === 0 || ids[i - 1]! > id)
  check('按 id 倒序（最新在前）', sortedDesc, ids.join(','))
  check('最新插入的那条排第一', allPage.entries[0]?.error === 'probe 传输中断')

  // 按**唯一文本**取条目：fixture 里有两条 tools/call，靠 method 找会拿到最新那条
  const toolCall = allPage.entries.find((e) => e.error === 'probe 工具调用失败')
  check('method 原样回传', toolCall?.method === 'tools/call', `${toolCall?.method}`)
  check('error 原文一字不改', toolCall?.error === 'probe 工具调用失败', `${toolCall?.error}`)
  check('latencyMs 有值时原样回传', toolCall?.latencyMs === 45, `${toolCall?.latencyMs}`)
  check('httpStatus 为 null 时保持 null', toolCall?.httpStatus === null, `${toolCall?.httpStatus}`)
  check('handshake 是布尔而非 0/1', toolCall?.handshake === false, `${typeof toolCall?.handshake}`)
  check('direction 原样回传', toolCall?.direction === 'out')

  const transport = allPage.entries.find((e) => e.error === 'probe 传输中断')
  check('latencyMs 为 null 时保持 null', transport?.latencyMs === null, `${transport?.latencyMs}`)

  const listOk = allPage.entries.find((e) => e.method === 'tools/list' && e.httpStatus === 200)
  check(
    'httpStatus / latencyMs 有值时原样回传',
    listOk?.httpStatus === 200 && listOk?.latencyMs === 12,
    `httpStatus=${String(listOk?.httpStatus)} latencyMs=${String(listOk?.latencyMs)}`,
  )

  const inDir = allPage.entries.find((e) => e.direction === 'in')
  check(
    'in 方向的握手记录也能读出来',
    inDir?.handshake === true && inDir?.method === 'initialize',
    `${inDir?.direction}/${inDir?.method}`,
  )

  /* ---------- 筛选 ---------- */

  const onlyErrors = page(await diagQuery('&errorsOnly=1'))
  check('errorsOnly 只留带错条数', onlyErrors.total === EXPECTED_ERRORS, `total=${onlyErrors.total}`)
  check('errorsOnly 的 errorCount 与 total 相等', onlyErrors.errorCount === onlyErrors.total)
  check(
    'errorsOnly 的每条都真有 error',
    onlyErrors.entries.every((e) => e.error !== null),
  )

  const onlyHandshake = page(await diagQuery('&handshake=1'))
  check('handshake=1 只留握手', onlyHandshake.total === EXPECTED_HANDSHAKE, `total=${onlyHandshake.total}`)
  check(
    'handshake=1 的每条 handshake 均为 true',
    onlyHandshake.entries.every((e) => e.handshake),
  )

  const onlyTool = page(await diagQuery('&handshake=0'))
  check('handshake=0 只留工具调用', onlyTool.total === EXPECTED_TOOL, `total=${onlyTool.total}`)
  check('两半相加等于总数', onlyHandshake.total + onlyTool.total === EXPECTED_TOTAL)

  const combined = page(await diagQuery('&handshake=0&errorsOnly=1'))
  check('组合筛选（工具调用 + 有错）', combined.total === 2, `total=${combined.total}`)

  const unknown = page(await get('/api/diagnostics/mcp?serverId=probe-不存在的服务'))
  check('未知 serverId 返回空页而非报错', unknown.total === 0 && unknown.entries.length === 0)
  check('空页的 hasMore 为 false', unknown.hasMore === false)

  /* ---------- 游标分页 ---------- */

  const p1 = page(await diagQuery('&limit=3'))
  check('第一页按 limit 截断', p1.entries.length === 3, `got=${p1.entries.length}`)
  check('还有更早时 hasMore 为 true', p1.hasMore === true)
  check('翻页时 total 不缩小', p1.total === EXPECTED_TOTAL, `total=${p1.total}`)

  const p2 = page(await diagQuery(`&limit=3&before=${p1.entries[p1.entries.length - 1]!.id}`))
  check('第二页拿满 3 条', p2.entries.length === 3, `got=${p2.entries.length}`)
  check('第二页的 total 与第一页一致', p2.total === EXPECTED_TOTAL, `total=${p2.total}`)
  check('第二页的 errorCount 与第一页一致', p2.errorCount === p1.errorCount)
  check(
    '第二页全部严格早于第一页',
    p2.entries.every((e) => e.id < p1.entries[p1.entries.length - 1]!.id),
  )

  const p3 = page(await diagQuery(`&limit=3&before=${p2.entries[p2.entries.length - 1]!.id}`))
  check('第三页只剩 1 条', p3.entries.length === 1, `got=${p3.entries.length}`)
  check('第三页之后没有更早的了', p3.hasMore === false)

  const paged = [...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.id)
  check('三页拼起来不重不漏', new Set(paged).size === EXPECTED_TOTAL, `got=${paged.length}`)
  check(
    '跨页整体仍是倒序',
    paged.every((id, i) => i === 0 || paged[i - 1]! > id),
  )

  /* ---------- 参数校验 ---------- */

  const badInputs: Array<[string, string]> = [
    ['&limit=0', 'limit 为 0'],
    ['&limit=abc', 'limit 非数字'],
    ['&limit=300', 'limit 超过上限 200'],
    ['&limit=-1', 'limit 为负'],
    ['&before=0', 'before 为 0'],
    ['&before=abc', 'before 非数字'],
    ['&handshake=maybe', 'handshake 非布尔'],
  ]
  for (const [qs, label] of badInputs) {
    const res = await get(`/api/diagnostics/mcp?serverId=${MARKER}${qs}`)
    check(
      `非法参数被拒并给出可读原因：${label}`,
      res.status === 400 && errorCode(res) === 'BAD_REQUEST',
      `status=${res.status} code=${String(errorCode(res))}`,
    )
  }
  const dup = await get(`/api/diagnostics/mcp?serverId=a&serverId=b`)
  check(
    '同名参数重复传被拒',
    dup.status === 400 && errorCode(dup) === 'BAD_REQUEST',
    `status=${dup.status}`,
  )
  const badMsg = await get('/api/diagnostics/mcp?limit=300')
  check(
    '错误信息里带上限数值（人话提示）',
    String((badMsg.body as { error?: { message?: string } }).error?.message).includes('200'),
    String((badMsg.body as { error?: { message?: string } }).error?.message),
  )

  /* ---------- 真实记录可见 ---------- */

  const withReal = page(await get('/api/diagnostics/mcp?limit=200'))
  check(
    '接口能读到启动时的真实握手记录（≥1 条）',
    withReal.total >= 1,
    `total=${withReal.total}`,
  )
  const realServerIds = new Set(withReal.entries.map((e) => e.serverId))
  check(
    '真实记录里含已注册的 MCP server',
    [...realServerIds].some((id) => id !== MARKER) || withReal.total > EXPECTED_TOTAL,
    [...realServerIds].join(','),
  )
} finally {
  cleanup()
  const left = sqlite
    .prepare('SELECT count(*) AS n FROM mcp_diagnostic_log WHERE server_id = ?')
    .get(MARKER) as { n: number }
  sqlite.close()
  console.log(`\n清理 fixture：剩余 ${left.n} 条（应为 0）`)
  if (left.n !== 0) failed += 1
}

console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${passed} 通过 / ${failed} 失败\n`)
process.exit(failed === 0 ? 0 : 1)
