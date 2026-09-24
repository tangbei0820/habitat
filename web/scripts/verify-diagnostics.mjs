/**
 * 「诊断日志时间线」前端验收（无头 Edge + CDP 裸驱动）
 *
 * 覆盖：面板渲染（统计行）/ 首屏只拉一页 + 「加载更早」翻页 / 只看错误 / 仅握手 /
 *       组合筛选出空态 / 服务筛选 / 刷新 / 错误原文一字不改 / 控制台异常。
 *
 * 前置（三件都得起着，端口刻意与日常开发实例错开 —— 本脚本会重建数据库文件）：
 *   server/ : PORT=3200 HABITAT_DB_PATH=./data/ui-diag.db node node_modules/tsx/dist/cli.mjs src/index.ts
 *   web/    : HABITAT_API_TARGET=http://127.0.0.1:3200 node node_modules/vite/bin/vite.js --port 5274 --strictPort --host 127.0.0.1
 *   任意    : msedge --headless=new --remote-debugging-port=9333 --user-data-dir=<临时目录>
 *   （vite 必须显式 --host 127.0.0.1：默认 localhost 在 Windows 上会解析到 ::1，脚本用 127.0.0.1 连不上）
 *   （mock 上游与 mock MCP 都不需要 —— 本页只读服务端 SQLite）
 *   然后：VERIFY_CDP=http://127.0.0.1:9333 VERIFY_APP=http://127.0.0.1:5274 VERIFY_API=http://127.0.0.1:3200 \
 *         VERIFY_DB=<server 的库文件绝对路径> node web/scripts/verify-diagnostics.mjs
 *
 * ⚠️ 用 **Node ≥ 22** 跑本脚本：它用内置 `WebSocket` 驱动 CDP、用内置 `node:sqlite` 写 fixture。
 *    不要用 Node 20（没有全局 WebSocket），也别引 better-sqlite3（它是 Node 20 ABI，Node 22 下打不开）。
 * ⚠️ 后台进程在同一命令结束后会被回收，所以启动与执行要写在同一条命令里。
 * ⚠️ 与 verify-chat / verify-providers 共用同一个浏览器实例，**串行跑**，别并行。
 * ⚠️ 诊断表的内容只由「MCP 真的握手」产生，形状不可控，所以本脚本直接往 server 的库里塞一批
 *    带唯一 `server_id` 标记的 fixture（WAL 下多进程可读写），结束前按标记删干净 —— 真实记录一条不动。
 *    库文件路径由 `VERIFY_DB` 指定。
 * 用法：node web/scripts/verify-diagnostics.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
/** 后端直连：只用于读「真实记录有几条」来算期望值，断言仍全部走浏览器 */
const API = process.env.VERIFY_API ?? 'http://127.0.0.1:3100'
const SERVER_DIR = resolve(fileURLToPath(new URL('../../server', import.meta.url)))
const DB_PATH = resolve(process.env.VERIFY_DB ?? join(SERVER_DIR, 'data', 'ui-diag.db'))

/** fixture 的唯一标记：用它筛、也用它清理 */
const MARKER = `ui-diag-${process.pid}`

/** 前端每页条数（web/src/features/diagnostics/DiagnosticPanel.tsx 的 PAGE_SIZE） */
const PAGE_SIZE = 30

const NON_ERROR_ROWS = 32
const ERROR_ROWS = 8
const HANDSHAKE_ROWS = 4
const FIXTURE_TOTAL = NON_ERROR_ROWS + ERROR_ROWS + HANDSHAKE_ROWS

const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  → ${detail}`}`)
}

/* ---------- 准备：读真实记录数（算期望值）+ 塞 fixture ---------- */

async function diagApi(query = '') {
  const res = await fetch(`${API}/api/diagnostics/mcp${query}`)
  return res.json()
}

const beforeReal = await diagApi('?limit=200')
const realTotal = beforeReal.total
const realErrors = beforeReal.errorCount
const realHandshake = (await diagApi('?limit=200&handshake=1')).total

// fixture 直接写 server 的库文件：`node:sqlite` 是内置模块，不必碰 better-sqlite3
// （后者是按 Node 20 的 ABI 编译的，在 Node 22 下会 ERR_DLOPEN_FAILED）
const sqlite = new DatabaseSync(DB_PATH)
const hasTable =
  sqlite.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='mcp_diagnostic_log'`).get()
    .n > 0
if (!hasTable) {
  console.error(`\n库文件 ${DB_PATH} 里没有 mcp_diagnostic_log 表 —— 请让 server 用它启动（VERIFY_DB 可指定路径）。\n`)
  process.exit(1)
}

function cleanupFixtures() {
  sqlite.prepare('DELETE FROM mcp_diagnostic_log WHERE server_id = ?').run(MARKER)
}

cleanupFixtures() // 上一轮异常退出可能留下残留

const insert = sqlite.prepare(
  `INSERT INTO mcp_diagnostic_log (server_id, direction, method, http_status, handshake, latency_ms, error, at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)
const baseAt = Date.now() - 60_000
const fixtureErrorText = (i) => `UI 注入错误 #${i}：mock 上游连接被拒`
let seq = 0
const addRow = (row) => {
  insert.run(MARKER, row.direction, row.method, row.httpStatus ?? null, row.handshake ? 1 : 0, row.latencyMs ?? null, row.error ?? null, baseAt + seq)
  seq += 1
}
for (let i = 0; i < HANDSHAKE_ROWS; i += 1) {
  addRow({ direction: i % 2 === 0 ? 'out' : 'in', method: 'initialize', handshake: true, latencyMs: 100 + i })
}
for (let i = 0; i < NON_ERROR_ROWS; i += 1) {
  addRow({ direction: 'out', method: 'tools/list', handshake: false, latencyMs: 5 + i, httpStatus: 200 })
}
for (let i = 0; i < ERROR_ROWS; i += 1) {
  addRow({ direction: 'out', method: 'tools/call', handshake: false, error: fixtureErrorText(i) })
}

const expectTotalAll = realTotal + FIXTURE_TOTAL
const expectErrorsOnly = realErrors + ERROR_ROWS
const expectHandshake = realHandshake + HANDSHAKE_ROWS
console.log(
  `fixture 已就绪：${FIXTURE_TOTAL} 条（真实记录 ${realTotal} 条）→ 全量 ${expectTotalAll} / 有错 ${expectErrorsOnly} / 握手 ${expectHandshake}\n`,
)

/* ---------- CDP 驱动 ---------- */

const list = await (await fetch(`${CDP}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
if (target === undefined) {
  console.log('找不到可用的页面 target')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve_, reject) => {
  ws.onopen = resolve_
  ws.onerror = reject
})

const pending = new Map()
const consoleLogs = []
let msgId = 0

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined) {
    const p = pending.get(msg.id)
    if (p !== undefined) {
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    }
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    consoleLogs.push(`[${msg.params.type}] ${text}`)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLogs.push(`[exception] ${msg.params.exceptionDetails.text}`)
  }
}

const send = (method, params = {}) =>
  new Promise((resolve_, reject) => {
    const id = ++msgId
    pending.set(id, { resolve: resolve_, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails !== undefined) {
    throw new Error(`${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`)
  }
  return res.result.value
}

async function shot(name) {
  const data = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(data.data, 'base64'))
}

async function waitFor(expression, label, timeout = 20000) {
  const ok = await evaluate(`(async () => {
    const deadline = Date.now() + ${timeout}
    while (Date.now() < deadline) {
      if (${expression}) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  })()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}

/* ---------- 面板内的定位器（页面上还有方案列表的 li，必须**限定在面板内**） ---------- */

const PANEL = `[...document.querySelectorAll('section')].find((s) => (s.querySelector('h2')?.textContent ?? '').trim() === '诊断日志')`
const PANEL_TEXT = `(${PANEL}?.innerText ?? '')`
const ROW_COUNT = `(${PANEL}?.querySelectorAll('li').length ?? -1)`
const ROW_TEXTS = `[...(${PANEL}?.querySelectorAll('li') ?? [])].map((l) => l.innerText)`

/** 按统计行的「共 N 条」等待：数字对上了才算这一轮真的加载完 */
async function waitStats(expected, label) {
  await waitFor(`${PANEL_TEXT}.includes(${JSON.stringify(`共 ${expected} 条`)})`, label, 20000)
}

/**
 * 读统计行里的总数。
 * ⚠️ 别拿「渲染出来的行数」当总数 —— 首屏只有一页（PAGE_SIZE 条），
 *    两者在需要翻页时必然不等（写这条断言时就踩过）。
 */
async function statTotal() {
  const text = await evaluate(PANEL_TEXT)
  const matched = text.match(/共 (\d+) 条/)
  return matched === null ? -1 : Number(matched[1])
}

async function setSelect(labelText, value) {
  const result = await evaluate(`(() => {
    const label = [...(${PANEL}?.querySelectorAll('label') ?? [])]
      .find((l) => l.textContent.includes(${JSON.stringify(labelText)}))
    const sel = label ? label.querySelector('select') : null
    if (!sel) return 'missing'
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, ${JSON.stringify(value)})
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`)
  if (result !== 'ok') throw new Error(`找不到下拉：${labelText}（${result}）`)
}

async function selectOptions(labelText) {
  return evaluate(`(() => {
    const label = [...(${PANEL}?.querySelectorAll('label') ?? [])]
      .find((l) => l.textContent.includes(${JSON.stringify(labelText)}))
    return label ? [...label.querySelectorAll('option')].map((o) => o.value) : null
  })()`)
}

/** 面板内的按钮（默认按「包含」匹配） */
async function clickPanelButton(text) {
  return evaluate(`(() => {
    const btn = [...(${PANEL}?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent.includes(${JSON.stringify(text)}))
    if (!btn) return 'missing'
    btn.click()
    return 'ok'
  })()`)
}

/** 勾/取消「只看错误」：用 click 触发，React 的 onChange 才收得到 */
async function toggleOnlyErrors() {
  return evaluate(`(() => {
    const input = [...(${PANEL}?.querySelectorAll('label') ?? [])]
      .find((l) => l.textContent.includes('只看错误'))?.querySelector('input')
    if (!input) return 'missing'
    input.click()
    return 'ok'
  })()`)
}

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: `${APP}/setting` })
  await waitFor(`document.body.innerText.includes('诊断日志')`, '设置页出现诊断区块', 30000)
  // ⚠️ 只等标题会出现，会读到「读取中…」的空壳 —— 必须等统计行把真实条数报出来
  await waitStats(expectTotalAll, '诊断日志首屏加载完成')

  /* ---------- 1. 首屏 ---------- */
  const firstText = await evaluate(PANEL_TEXT)
  check('面板带说明文案（写明数据来自服务端留痕）', firstText.includes('MCP 握手与每次工具调用全量留痕'), '')
  check(
    '统计行报告全量条数',
    firstText.includes(`共 ${expectTotalAll} 条`),
    firstText.split('\n').find((l) => l.includes('共 ')) ?? '',
  )
  check(
    '统计行报告有错条数',
    firstText.includes(`其中 ${expectErrorsOnly} 条有错`),
    firstText.split('\n').find((l) => l.includes('其中 ')) ?? '',
  )
  check('首屏只拉一页', (await evaluate(ROW_COUNT)) === PAGE_SIZE, `rows=${await evaluate(ROW_COUNT)}`)
  check('首屏提示已载入多少', firstText.includes(`已载入 ${PAGE_SIZE} 条`), '')
  check('出现「加载更早的记录」按钮', firstText.includes('加载更早的记录'))
  // 截图要当「版面证据」用：把视口拉高 + 滚到面板，否则默认 800×600 只拍得到页面顶部的「外观」
  await send('Emulation.setDeviceMetricsOverride', {
    width: 460,
    height: 1500,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await evaluate(`${PANEL}.scrollIntoView({ block: 'start' })`)
  await sleep(400)
  await shot('shot-diagnostics-panel.png')

  /* ---------- 2. 时间线与原文 ---------- */
  const firstRows = await evaluate(ROW_TEXTS)
  check(
    '每行都有时间戳（毫秒级）',
    firstRows.every((t) => /\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/.test(t)),
    firstRows[0]?.split('\n')[0] ?? '',
  )
  check(
    '每行标出请求 / 响应方向与协议方法',
    // 方向文字之外的**箭头**是 SVG 图标（换装第 2 批），不再按 `→` `←` 字符断言
    firstRows.every((t) => (t.includes('请求') || t.includes('响应')) && t.includes('tools/')),
    firstRows[0]?.replace(/\n/g, ' ⏎ ') ?? '',
  )
  check(
    '错误原文一字不改地显示（含冒号后的细节）',
    firstText.includes(fixtureErrorText(0)),
    fixtureErrorText(0),
  )
  check(
    '最新的一条排在最上面',
    firstRows[0]?.includes(fixtureErrorText(ERROR_ROWS - 1)) ?? false,
    firstRows[0]?.split('\n').slice(1).join(' ⏎ ') ?? '',
  )

  /* ---------- 3. 加载更早（游标分页） ---------- */
  check('点「加载更早的记录」', (await clickPanelButton('加载更早的记录')) === 'ok')
  await waitStats(expectTotalAll, '翻页后统计行不变')
  await waitFor(`${ROW_COUNT} === ${expectTotalAll}`, '全部记录已载入', 20000)
  const afterMoreText = await evaluate(PANEL_TEXT)
  check('翻页后条数补齐', (await evaluate(ROW_COUNT)) === expectTotalAll, `rows=${expectTotalAll}`)
  check('翻页后 total 没有缩小（游标不参与计数）', afterMoreText.includes(`共 ${expectTotalAll} 条`), '')
  check('到底之后按钮收起', !afterMoreText.includes('加载更早的记录'))
  check('到底之后不再显示「已载入」', !afterMoreText.includes('已载入'))

  /* ---------- 4. 只看错误 ---------- */
  check('勾上「只看错误」', (await toggleOnlyErrors()) === 'ok')
  await waitStats(expectErrorsOnly, '只看错误的统计行')
  const errRows = await evaluate(ROW_TEXTS)
  check('只看错误 → 条数变为有错条数', errRows.length === expectErrorsOnly, `rows=${errRows.length}`)
  check(
    '只看错误 → 无错的行确实消失（工具列表那些）',
    errRows.every((t) => !t.includes('列出工具')),
    errRows.find((t) => t.includes('列出工具')) ?? '',
  )
  check(
    '只看错误 → 有错的行确实还在',
    errRows.some((t) => t.includes('UI 注入错误')),
    '',
  )

  check('再点一次取消「只看错误」', (await toggleOnlyErrors()) === 'ok')
  await waitStats(expectTotalAll, '取消只看错误后恢复')

  /* ---------- 5. 阶段筛选 ---------- */
  await setSelect('阶段', 'handshake')
  await waitStats(expectHandshake, '仅握手统计行')
  const hsRows = await evaluate(ROW_TEXTS)
  check('仅握手 → 条数正确', hsRows.length === expectHandshake, `rows=${hsRows.length}`)
  check(
    '仅握手 → 都是 initialize 且带握手徽标',
    hsRows.every((t) => t.includes('initialize') && t.includes('握手')),
    hsRows[0]?.replace(/\n/g, ' ⏎ ') ?? '',
  )

  await setSelect('阶段', 'tool')
  await waitStats(expectTotalAll - expectHandshake, '仅工具调用统计行')
  const toolRows = await evaluate(ROW_TEXTS)
  check(
    '仅工具调用 → 不再出现 initialize',
    toolRows.every((t) => !t.includes('initialize')),
    toolRows[0]?.replace(/\n/g, ' ⏎ ') ?? '',
  )
  check('仅工具调用 → 首屏仍只拉一页', toolRows.length === PAGE_SIZE, `rows=${toolRows.length}`)
  const toolTotal = await statTotal()
  check(
    '两个阶段相加等于全量（比的是统计总数，不是渲染行数）',
    expectHandshake + toolTotal === expectTotalAll,
    `${expectHandshake}+${toolTotal} vs ${expectTotalAll}`,
  )

  /* ---------- 6. 组合筛选出空态 ---------- */
  await setSelect('阶段', 'handshake')
  check('勾上「只看错误」做组合筛选', (await toggleOnlyErrors()) === 'ok')
  await waitStats(0, '组合筛选后的空态')
  check('组合无结果时给出空态文案', (await evaluate(PANEL_TEXT)).includes('没有符合条件的记录'))
  check('空态下不渲染任何行', (await evaluate(ROW_COUNT)) === 0, `rows=${await evaluate(ROW_COUNT)}`)
  check('空态下没有「加载更早」按钮', !(await evaluate(PANEL_TEXT)).includes('加载更早的记录'))
  await evaluate(`${PANEL}.scrollIntoView({ block: 'start' })`)
  await sleep(400)
  await shot('shot-diagnostics-empty.png')
  await send('Emulation.clearDeviceMetricsOverride')

  await toggleOnlyErrors()
  await setSelect('阶段', 'all')
  await waitStats(expectTotalAll, '恢复全量')

  /* ---------- 7. 服务筛选 ---------- */
  const serverOptions = await selectOptions('服务')
  check('服务下拉有「全部」', Array.isArray(serverOptions) && serverOptions.includes(''), JSON.stringify(serverOptions))
  check(
    '服务下拉包含已注册的 MCP server',
    Array.isArray(serverOptions) && serverOptions.includes('nocturne'),
    JSON.stringify(serverOptions),
  )
  await setSelect('服务', 'nocturne')
  await waitStats(realTotal, '按服务筛选后的统计行')
  const nocturneRows = await evaluate(ROW_TEXTS)
  check('按服务筛选 → 只剩该服务的记录', nocturneRows.length === realTotal, `rows=${nocturneRows.length}`)
  check(
    '筛选结果里没有 fixture 的活动痕迹',
    !nocturneRows.some((t) => t.includes('UI 注入错误')),
    '',
  )

  /* ---------- 8. 刷新 ---------- */
  await setSelect('服务', '')
  await waitStats(expectTotalAll, '切回全部')
  check('点「刷新」', (await clickPanelButton('刷新')) === 'ok')
  await waitStats(expectTotalAll, '刷新后统计行')
  check('刷新后仍能读到记录', (await evaluate(ROW_COUNT)) > 0, `rows=${await evaluate(ROW_COUNT)}`)

  /* ---------- 9. 控制台 ---------- */
  // favicon 404 是已知待优化项（见 docs/TASKS.md），不属于本页引入的问题
  const errors = consoleLogs.filter(
    (l) => (l.startsWith('[error]') || l.startsWith('[exception]')) && !l.includes('favicon'),
  )
  check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  cleanupFixtures()
  const left = sqlite
    .prepare('SELECT count(*) AS n FROM mcp_diagnostic_log WHERE server_id = ?')
    .get(MARKER).n
  sqlite.close()
  console.log(`\n清理 fixture：剩余 ${left} 条（应为 0）`)
  if (left !== 0) check('fixture 已清理干净', false, `left=${left}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 汇总：通过 ${results.length - failed.length} / ${results.length} ===`)
ws.close()
process.exit(failed.length === 0 ? 0 : 1)
