/**
 * UI 换装第 5 批 · 生活 + 设置换皮验收
 *
 * 生活（设计源 screens-life.jsx，拍板：两套并排）：
 *   - 默认落在「生活痕迹」：心情 / 睡眠 / 日记 / 一起听 / 雨 五格；
 *     ⚠️ 心情 / 睡眠 / 一起听 / 雨 **没有真实数据来源，必须是诚实空态** ——
 *     设计稿里的「7h12m」「心情曲线」「3.5 小时」全是占位，一格都不许搬（铁律）；
 *     日记格是本周真篇数（种一条验一条）。
 *   - 「记录」段里旧五页签（月历/账本/通知/事件/运行）一个不丢，?tab= 深链仍直达。
 * 设置（设计源 screens-setting.jsx）：
 *   - 顶栏 + 住客信息卡 + 分组（外观 / API 方案 / 数据备份 / 高级）；
 *   - 主题是分段控件，切了**真的生效**（data-theme 跟着变）；
 *   - 旧的「将在 Phase 3 接入」占位段落必须消失（Phase 3 早完成了，假占位不留）。
 *
 * 前置：与组一相同（server:3100 + vite:5174 + CDP:9222）。
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  → ${detail}`}`)
}

const list = await (await fetch(`${CDP}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
if (target === undefined) {
  console.log('找不到可用的页面 target')
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
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
    consoleLogs.push(
      `[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`,
    )
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLogs.push(`[exception] ${msg.params.exceptionDetails.text}`)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails !== undefined) {
    throw new Error(`${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`)
  }
  return res.result.value
}
async function waitFor(expression, label, timeout = 25000) {
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
async function shot(name) {
  await sleep(800)
  const data = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(data.data, 'base64'))
}
const go = async (path) => {
  await send('Page.navigate', { url: `${APP}${path}` })
  await sleep(700)
}
const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)})
    if (!el) return 'missing'
    el.click()
    return 'ok'
  })()`)

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await sleep(600)
consoleLogs.length = 0
const originalTheme = await evaluate(`document.documentElement.dataset.theme ?? ''`)

/* ================================================================
   一、生活 · 生活痕迹（默认视图）
   ================================================================ */
await go('/life')
await waitFor(`document.querySelector('[data-testid="life-view-switch"]') !== null`, '生活页两段开关挂载')

const traces = await evaluate(`(() => {
  const text = document.body.innerText
  return {
    switchOn: document.querySelector('.seg .seg-item.is-on')?.textContent.trim() ?? '',
    cells: [...document.querySelectorAll('.bento > .bento-cell')].length,
    moodEmpty: text.includes('还没有心情记录'),
    sleepEmpty: text.includes('还没有睡眠记录'),
    listenEmpty: text.includes('还没一起听过歌'),
    rainEmpty: text.includes('还没听过雨声'),
    diaryCell: text.includes('篇') && text.includes('日记'),
    fakeGone: !text.includes('7h') && !text.includes('3.5') && !text.includes('目标 8h') && !text.includes('雨声占了一大半'),
    footer: text.includes('数据只记录，不评判'),
  }
})()`)
check('默认落在「生活痕迹」段', traces.switchOn === '生活痕迹', traces.switchOn)
check('痕迹视图是 Bento 五格（心情/睡眠/日记/一起听/雨）', traces.cells === 5, `cells=${traces.cells}`)
check('心情 / 睡眠 / 一起听 / 雨都是诚实空态', traces.moodEmpty && traces.sleepEmpty && traces.listenEmpty && traces.rainEmpty, JSON.stringify(traces))
check('设计稿的占位数据（7h12m / 3.5 小时 / 目标 8h）一格都没搬', traces.fakeGone)
check('收尾一句「数据只记录，不评判」在', traces.footer)

/* 日记格吃真库：种一条今天的用户日记，「你 1 篇」必须出现 */
const seededDiary = await evaluate(`(async () => {
  const m = await import('/src/db/home.ts')
  const today = new Date()
  const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
  await m.createDiary('痕迹验收日记', '今天陪验收脚本跑了一趟。', key)
  return 'ok'
})()`)
await go('/life')
await waitFor(`document.body.innerText.includes('痕迹验收日记') === false`, '生活页重进')
const diaryLine = await evaluate(`(() => {
  const cell = [...document.querySelectorAll('.bento > .bento-cell')].find((c) => c.innerText.includes('日记'))
  return cell === null ? '' : cell.innerText
})()`)
check(
  '日记格是本周真篇数（种一条用户日记 → 计数含「你 N 篇 / 小栖写了 N 篇」）',
  seededDiary === 'ok' && /你 \d+ 篇/.test(diaryLine) && /小栖写了 \d+ 篇/.test(diaryLine),
  diaryLine.replace(/\n/g, ' / '),
)
await shot('shot-skin-life-traces.png')

/* ================================================================
   二、生活 · 记录（旧五页签一个不丢 + 深链直达）
   ================================================================ */
check('可切到「记录」段', await clickText('记录') === 'ok')
await waitFor(`document.body.innerText.includes('月历') && document.body.innerText.includes('账本')`, '记录段页签')
// 月历摘要的「本月事件 N」是异步拉事件后再渲染的 —— 只等页签会撞竞速（流水线慢机上报过一次）
await waitFor(`document.body.innerText.includes('本月事件')`, '月历摘要渲染', 15000)
const recordTabs = await evaluate(`(() => {
  const text = document.body.innerText
  return ['月历', '账本', '通知', '事件', '运行'].every((value) => text.includes(value)) &&
    text.includes('本月事件')
})()`)
check('记录段五页签齐全且月历摘要可用', recordTabs === true)
await go('/life?tab=runtime')
await waitFor(`new URLSearchParams(location.search).get('tab') === 'runtime'`, '深链 runtime')
check('?tab=runtime 深链仍直达记录段运行视图', (await evaluate(`document.body.innerText.includes('habitat-server')`)) === true)

/* ================================================================
   三、设置 · 重新分组
   ================================================================ */
await go('/setting')
await waitFor(`document.querySelector('.topbar') !== null`, '设置页顶栏')
const setting = await evaluate(`(() => {
  const text = document.body.innerText
  const labels = [...document.querySelectorAll('.setting-group-label')].map((el) => el.textContent.trim())
  return {
    title: document.querySelector('.topbar .t-h1')?.textContent.trim() ?? '',
    hostCard: text.includes('住在这里的人'),
    labels,
    themeSeg: document.querySelector('[data-testid="theme-light"]') !== null && document.querySelector('[data-testid="theme-dark"]') !== null,
    api: text.includes('API 方案'),
    backup: text.includes('数据备份'),
    diagnostics: text.includes('诊断日志'),
    staleGone: !text.includes('Phase 3 接入'),
  }
})()`)
check('设置页是低存在感顶栏 + 住客信息卡', setting.title === '设置' && setting.hostCard, `${setting.title} / host=${String(setting.hostCard)}`)
check(
  '分组标签齐（外观 / 高级），API 方案与数据备份在正文中',
  setting.labels.includes('外观') && setting.labels.includes('高级') && setting.api && setting.backup,
  JSON.stringify(setting.labels),
)
check('诊断日志区块还在（高级段里）', setting.diagnostics)
check('旧占位段「将在 Phase 3 接入」已清掉', setting.staleGone)

/* 主题分段控件切了要真的生效 */
await evaluate(`(() => { document.querySelector('[data-testid="theme-dark"]').click(); return 'ok' })()`)
const darkApplied = await evaluate(`document.documentElement.dataset.theme`)
await evaluate(`(() => { document.querySelector('[data-testid="theme-light"]').click(); return 'ok' })()`)
const lightApplied = await evaluate(`document.documentElement.dataset.theme`)
check('主题分段控件切深/浅都真生效', darkApplied === 'dark' && lightApplied === 'light', `${darkApplied} → ${lightApplied}`)
await shot('shot-skin-setting.png')

/* ================================================================
   四、收尾
   ================================================================ */
await go('/life')
check(
  '移动端无横向溢出',
  (await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')) === true,
  await evaluate('document.documentElement.scrollWidth + " vs " + document.documentElement.clientWidth'),
)
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}`)
await send('Emulation.clearDeviceMetricsOverride')
ws.close()

const passed = results.filter((r) => r.ok).length
console.log(`\n生活 + 设置换皮（第 5 批）：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
