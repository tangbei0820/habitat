/**
 * Phase 6.5 P2 · LLM 页面（小栖档案 / App Launcher）前端验收。
 *
 * 前置：habitat-server + Vite + 带 remote-debugging-port 的 Edge（建议隔离库）。
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）、VERIFY_API（默认同 VERIFY_APP）。
 *
 * ⚠️ 这支脚本**刻意不写死任何能力名或能力数量**：页面上的能力面来自服务端，
 *    环境不同（有没有 Nocturne / Eventide）结果就不同。
 *    所以这里一律**先取 `/api/capabilities` 真值，再和 DOM 逐条比**。
 *    写死的话，换个环境就会假红或假绿。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const API = process.env.VERIFY_API ?? APP
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })
const results = []
const consoleLogs = []
function check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` → ${detail}` : ''}`) }

const targets = await (await fetch(`${CDP}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) throw new Error('找不到 Edge page target')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result) }
  } else if (message.method === 'Runtime.consoleAPICalled') {
    if (message.params.type === 'error' || message.params.type === 'warning') {
      consoleLogs.push(`[${message.params.type}] ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`)
    }
  } else if (message.method === 'Runtime.exceptionThrown') consoleLogs.push(`[exception] ${message.params.exceptionDetails.text}`)
}
function send(method, params = {}) { return new Promise((resolve, reject) => { const callId = ++id; pending.set(callId, { resolve, reject }); ws.send(JSON.stringify({ id: callId, method, params })) }) }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, label, timeout = 20000) {
  const ok = await evaluate(`(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,150))}return false})()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}

/* 真值：服务端此刻认定的能力面 */
const truth = (await (await fetch(`${API}/api/capabilities`)).json()).capabilities
if (!Array.isArray(truth) || truth.length === 0) throw new Error('/api/capabilities 返回空 —— 无法比对')

await send('Runtime.enable')
await send('Page.enable')
// `Runtime.enable` 会重放上一会话的 console；等桶稳定后清空，免得把别人的报错算成本页异常
await new Promise((resolve) => setTimeout(resolve, 600))
consoleLogs.length = 0

await send('Page.navigate', { url: `${APP}/llm` })
await waitFor(`document.querySelector('[data-testid="llm-summary"]') !== null || document.querySelector('[data-testid="llm-error"]') !== null`, '档案页出结果')

const hasError = await evaluate(`document.querySelector('[data-testid="llm-error"]') !== null`)
check('能力面读取成功（没有落到错误态）', !hasError, hasError ? await evaluate(`document.querySelector('[data-testid="llm-error"]').innerText`) : '')

/* ---------- 1. 与真值逐条比对 ---------- */
const dom = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-testid^="capability-"]')]
    .filter((node) => !node.dataset.testid.startsWith('capability-reason-'))
    .map((node) => ({
      id: node.dataset.testid.replace('capability-', ''),
      enabled: node.dataset.enabled,
      text: node.innerText,
    }))
  return { rows, summary: document.querySelector('[data-testid="llm-summary"]')?.innerText ?? '' }
})()`)

const domIds = dom.rows.map((row) => row.id).sort()
const truthIds = truth.map((item) => item.id).sort()
check('卡片列出的能力与服务端快照完全一致', JSON.stringify(domIds) === JSON.stringify(truthIds), `dom=${JSON.stringify(domIds)} truth=${JSON.stringify(truthIds)}`)

const mismatched = truth.filter((item) => {
  const row = dom.rows.find((candidate) => candidate.id === item.id)
  return row === undefined || row.enabled !== String(item.enabled)
})
check('每项能力的可用状态与快照一致（不伪造）', mismatched.length === 0, JSON.stringify(mismatched.map((item) => item.id)))

const unavailable = truth.filter((item) => !item.enabled)
const missingReason = unavailable.filter((item) => {
  const row = dom.rows.find((candidate) => candidate.id === item.id)
  return row === undefined || !row.text.includes('为什么现在用不了')
})
check('不可用能力都明说了原因', unavailable.length === 0 || missingReason.length === 0, `不可用 ${unavailable.length} 项，缺原因 ${missingReason.length} 项`)

const enabledCount = truth.filter((item) => item.enabled).length
check(
  '顶部摘要与快照计数一致',
  dom.summary.includes(`共 ${truth.length} 项能力`) && dom.summary.includes(`当前可用 ${enabledCount} 项`),
  dom.summary,
)

const boundTools = truth.filter((item) => item.enabled && item.toolName !== undefined)
const toolMissing = boundTools.filter((item) => {
  const row = dom.rows.find((candidate) => candidate.id === item.id)
  return row === undefined || !row.text.includes(item.toolName)
})
check('可用且绑了工具的能力都显示了工具名', boundTools.length === 0 || toolMissing.length === 0, `缺 ${toolMissing.length} 项`)

/* ---------- 2. App Launcher：有界面才可点 ---------- */
const EXPECTED_LAUNCH = { diary: '/home/diary', board: '/home/board', state: '/life?tab=runtime' }
const NAV_ONLY = ['memory', 'tools']

const modules = await evaluate(`(() => [...document.querySelectorAll('[data-testid^="llm-module-"]')].map((node) => ({
  key: node.dataset.testid.replace('llm-module-', ''),
  launchable: node.dataset.launchable,
  tag: node.tagName,
  href: node.getAttribute('href'),
  text: node.innerText,
})))()`)

for (const [key, path] of Object.entries(EXPECTED_LAUNCH)) {
  const mod = modules.find((item) => item.key === key)
  check(
    `模块「${key}」是可点的入口且指向 ${path}`,
    mod !== undefined && mod.tag === 'A' && mod.launchable === 'true' && mod.href === path,
    JSON.stringify(mod ?? null),
  )
}
for (const key of NAV_ONLY) {
  const mod = modules.find((item) => item.key === key)
  check(
    `模块「${key}」没有界面时不可点且明说`,
    mod !== undefined && mod.tag === 'DIV' && mod.launchable === 'false' && mod.text.includes('暂无界面'),
    JSON.stringify(mod ?? null),
  )
}

/* ---------- 3. 真的能启动 ---------- */
/**
 * 点卡片 → 等路由 → 等目标页自己的内容出现。
 *
 * ⚠️ 两段都要**等**：路由变了 ≠ 页面已渲染（运行视图的状态是异步拉的）。
 * 只断言路由会得到一个假的 PASS，只断言内容又会在还没跳走时读错页。
 * 这里刻意**不抛异常**而是返回 false —— 断言失败要变成一条 FAIL 记录，
 * 而不是把整支脚本带崩、后面十几条一个都看不到。
 */
async function launchModule(key, expectPath, expectText) {
  await send('Page.navigate', { url: `${APP}/llm` })
  await waitFor(`document.querySelector('[data-testid="llm-module-${key}"]') !== null`, `回到档案页等「${key}」卡片`)
  const clicked = await evaluate(`(() => { const node = document.querySelector('[data-testid="llm-module-${key}"]'); if (!node) return false; node.click(); return true })()`)
  if (!clicked) return false
  const waitInPage = (expression) =>
    evaluate(`(async()=>{const end=Date.now()+20000;while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,150))}return false})()`)
  const routed = await waitInPage(`location.pathname + location.search === ${JSON.stringify(expectPath)}`)
  if (!routed) return false
  return waitInPage(`document.body.innerText.includes(${JSON.stringify(expectText)})`)
}

check('点日记卡片进入 Home 日记', await launchModule('diary', '/home/diary', '日记'))
check('点留言板卡片进入 Home 留言板', await launchModule('board', '/home/board', '留言板'))
check('点状态卡片进入 Life 运行视图', await launchModule('state', '/life?tab=runtime', 'habitat-server'))

/* ---------- 4. 收尾 ---------- */
await send('Page.navigate', { url: `${APP}/llm` })
await waitFor(`document.querySelector('[data-testid="llm-summary"]') !== null`, '回到档案页')
check('移动端页面无横向溢出', await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))

const screenshot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/verify-llm.png`, Buffer.from(screenshot.data, 'base64'))

const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

ws.close()
const passed = results.filter((result) => result.ok).length
console.log(`\nLLM 档案页：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
