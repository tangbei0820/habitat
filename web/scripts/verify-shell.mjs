/**
 * UI 换装第 2 批 · 应用外壳验收（SPEC §9.8）。
 *
 * 盯四件事：
 *   1. 底部导航 = 浮起胶囊 + 线框图标 + 中文标签 + 顺序，且**是真链接**；
 *      当前项用**实心**表达位置（不是换色），并且宽屏下不许横跨整屏。
 *   2. 欢迎页：一次会话只拦一次根路径，点「进入栖息地」到对话；页内不显示底栏。
 *   3. 子页面滑入 = **动画**而不是换屏 —— `/home/diary` 依然是真网址，
 *      刷新 / 直接打开时不播进场动画。
 *   4. 界面上不再有 emoji 当图标用（表情选择器里的**内容**不算，那是用户要发出去的）。
 *
 * 前置：habitat-server + Vite + 带 remote-debugging-port 的 Edge（建议隔离库）。
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）、VERIFY_API（默认同 VERIFY_APP）。
 *
 * ⚠️ 本脚本会**清 sessionStorage**（欢迎页的「本次已进入」标记就在那里），
 *    所以它不需要是全新的浏览器配置；但也因此**别把它排在依赖「已进入过」的脚本前面**。
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
async function shot(name) {
  // ⚠️ 先等入场动画播完再拍：`.rise` 是 `animation-fill-mode: both`，
  // 延迟期间停在第一帧（opacity: 0）—— 抢拍会得到一张「内容都不见了」的图，
  // 看起来像页面坏了，其实只是还没浮上来。
  await new Promise((resolve) => setTimeout(resolve, 800))
  const image = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(image.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
// 移动仿真：本批验的就是手机上的样子（宽屏另有一段专门覆盖）
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
// `Runtime.enable` 会重放上一会话的 console；等桶稳定后清空，免得把别人的报错算成本页异常
await new Promise((resolve) => setTimeout(resolve, 600))
consoleLogs.length = 0

/* ============================================================
   一、底部导航
   ============================================================ */
await send('Page.navigate', { url: `${APP}/home` })
await waitFor(`document.querySelector('[data-testid="bottom-nav"]') !== null`, '底栏出现')
await waitFor(`document.querySelector('[data-testid="home-entries"]') !== null`, 'Home 列表渲染')

const nav = await evaluate(`(() => {
  const nav = document.querySelector('[data-testid="bottom-nav"]')
  const items = [...nav.querySelectorAll('a')]
  const style = getComputedStyle(nav)
  const fillOf = (a) => {
    const svg = a === undefined ? null : a.querySelector('svg')
    return svg === null ? null : { fill: svg.getAttribute('fill'), stroke: svg.getAttribute('stroke') }
  }
  const active = items.find((a) => a.classList.contains('is-active'))
  const idle = items.find((a) => !a.classList.contains('is-active'))
  return {
    tag: nav.tagName,
    ariaLabel: nav.getAttribute('aria-label'),
    hasClass: nav.classList.contains('bottom-nav'),
    hrefs: items.map((a) => a.getAttribute('href')),
    labels: items.map((a) => a.textContent.trim()),
    radius: style.borderRadius,
    bottom: style.bottom,
    backdrop: style.backdropFilter,
    itemCount: items.length,
    svgCount: nav.querySelectorAll('svg').length,
    activeHref: active === undefined ? null : active.getAttribute('href'),
    activeFill: fillOf(active),
    idleFill: fillOf(idle),
  }
})()`)

check('底栏是 nav 且有「主导航」无障碍标签', nav.tag === 'NAV' && nav.ariaLabel === '主导航', JSON.stringify(nav.ariaLabel))
check('五个入口都下是**真链接**（<a href>，不是 button）', nav.itemCount === 5, `${nav.itemCount} 个`)
check(
  '顺序为 对话 / 家 / 大脑 / 生活 / 设置',
  JSON.stringify(nav.hrefs) === JSON.stringify(['/chat', '/home', '/llm', '/life', '/setting']),
  JSON.stringify(nav.hrefs),
)
check('入口名称是中文', JSON.stringify(nav.labels) === JSON.stringify(['对话', '家', '大脑', '生活', '设置']), JSON.stringify(nav.labels))
check('当前所在的那一项被标出来（is-active）', nav.activeHref === '/home', String(nav.activeHref))

check('底栏是浮起胶囊（大圆角 + 毛玻璃 + 离底有距离）',
  nav.hasClass && Number.parseFloat(nav.radius) > 20 && nav.backdrop !== 'none' && Number.parseFloat(nav.bottom) > 0,
  `radius=${nav.radius} bottom=${nav.bottom} backdrop=${nav.backdrop}`)

check('底栏图标全是 SVG（不再是 emoji / 文字）', nav.svgCount === 5, `${nav.svgCount}/5`)
check('选中项图标是**实心**（靠形状表达位置）', nav.activeFill?.fill === 'currentColor' && nav.activeFill?.stroke === 'none', JSON.stringify(nav.activeFill))
check('未选中项图标是**线框**', nav.idleFill?.fill === 'none' && nav.idleFill?.stroke === 'currentColor', JSON.stringify(nav.idleFill))

// 页面底部避让 = 胶囊高度 + 离底间距。胶囊是浮起的，只算高度会让内容被压住一截。
const avoid = await evaluate(`(() => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bottom-nav-height').trim()
  const nav = document.querySelector('[data-testid="bottom-nav"]')
  const gap = Number.parseFloat(getComputedStyle(nav).bottom)
  return { raw, expect: Math.round(nav.getBoundingClientRect().height + gap) }
})()`)
const avoidValue = Number.parseFloat(avoid.raw)
check('底部避让令牌 = 胶囊高度 + 离底间距', Math.abs(avoidValue - avoid.expect) <= 1, `令牌=${avoid.raw} 期望=${avoid.expect}px`)

await shot('verify-shell-home.png')

// 宽屏：胶囊必须仍待在 448px 那一列里，而不是横跨整屏（定位祖先丢了就会出现这种）
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise((resolve) => setTimeout(resolve, 400))
const wide = await evaluate(`(() => { const r = document.querySelector('[data-testid="bottom-nav"]').getBoundingClientRect(); return { width: Math.round(r.width), left: Math.round(r.left) } })()`)
check('宽屏下底栏不横跨整屏（仍在 448px 列内）', wide.width <= 430, `宽度=${wide.width}px 左=${wide.left}px`)
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await new Promise((resolve) => setTimeout(resolve, 400))

/* ============================================================
   二、欢迎页
   ============================================================ */
// 清掉「本次会话已进入」标记 —— 先落到同源的任意页才能操作 sessionStorage
await send('Page.navigate', { url: `${APP}/setting` })
await waitFor(`location.pathname === '/setting'`, '先到设置页建立同源上下文')
await evaluate(`sessionStorage.clear()`)

await send('Page.navigate', { url: APP })
await waitFor(`location.pathname === '/welcome'`, '根路径分流到欢迎页')
check('本次会话没进过 → 根路径落到欢迎页', (await evaluate('location.pathname')) === '/welcome')

await waitFor(`document.querySelector('[data-testid="welcome"]') !== null`, '欢迎页渲染')
const welcome = await evaluate(`(() => {
  const root = document.querySelector('[data-testid="welcome"]')
  const enter = document.querySelector('[data-testid="welcome-enter"]')
  return {
    text: root.innerText,
    hasRain: root.querySelector('.rain-backdrop') !== null,
    hasDeck: root.querySelector('.deck') !== null,
    enterFound: enter !== null,
    enterVisible: enter !== null && enter.getBoundingClientRect().height > 0,
    navShown: document.querySelector('[data-testid="bottom-nav"]') !== null,
    peek: document.querySelector('[data-testid="welcome-peek"]')?.innerText ?? null,
  }
})()`)

check('欢迎页有雨幕背景与叠卡', welcome.hasRain && welcome.hasDeck)
check('欢迎页显示当前时间与日期问候',
  /\d{1,2}:\d{2}/.test(welcome.text) && /\d+月\d+日 · 周/.test(welcome.text),
  welcome.text.split('\n').slice(0, 3).join(' | '))
check('「进入栖息地」按钮存在且可见', welcome.enterFound && welcome.enterVisible)
check('欢迎页不显示底部导航', welcome.navShown === false)
check('叠卡有内容（真实最近消息，或诚实的空态）', welcome.peek !== null && !welcome.peek.includes('2 条未读'), (welcome.peek ?? '').replace(/\n/g, ' ⏎ ').slice(0, 60))
await shot('verify-shell-welcome.png')

await evaluate(`document.querySelector('[data-testid="welcome-enter"]').click()`)
await waitFor(`location.pathname === '/chat'`, '点进入栖息地')
check('点「进入栖息地」到对话页', (await evaluate('location.pathname')) === '/chat')
await waitFor(`document.querySelector('[data-testid="bottom-nav"]') !== null`, '进入后底栏出现')
check('进入应用后底栏出现（欢迎页之外都有）', true)

await send('Page.navigate', { url: APP })
await waitFor(`location.pathname === '/chat'`, '再次打开根路径')
check('本次会话已进入过 → 根路径不再拦到欢迎页', (await evaluate('location.pathname')) === '/chat')

await send('Page.navigate', { url: `${APP}/welcome` })
await waitFor(`document.querySelector('[data-testid="welcome"]') !== null`, '直接访问欢迎页')
check('直接访问 /welcome 仍能看到（不是只有被拦截时才存在）', true)

/* ============================================================
   三、子页面滑入（网址不变）
   ============================================================ */
await send('Page.navigate', { url: `${APP}/home` })
await waitFor(`document.querySelector('[data-testid="home-entries"]') !== null`, '回到 Home')

const moduleIcons = await evaluate(`(() => {
  const items = [...document.querySelectorAll('[data-testid="home-entries"] li')]
  return { total: items.length, withSvg: items.filter((li) => li.querySelector('svg') !== null).length }
})()`)
check('Home 每个模块入口的图标都是 SVG', moduleIcons.total > 0 && moduleIcons.total === moduleIcons.withSvg, JSON.stringify(moduleIcons))

const clicked = await evaluate(`(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/home/diary')
  if (link === undefined) return false
  link.click()
  return true
})()`)
check('Home 上能找到「日记」入口', clicked)
await waitFor(`location.pathname === '/home/diary'`, '进入日记子页')
check('子页面用的是**真网址**（/home/diary，不是叠放换屏）', (await evaluate('location.pathname')) === '/home/diary')
check('子页面仍显示底栏', (await evaluate(`document.querySelector('[data-testid="bottom-nav"]') !== null`)) === true)

const slide = await evaluate(`(() => {
  const node = document.querySelector('.slide-in')
  if (node === null) return null
  const style = getComputedStyle(node)
  return { name: style.animationName, duration: style.animationDuration }
})()`)
check('导航进入时播放滑入动画', slide !== null && slide.name === 'slide-in-right', JSON.stringify(slide))

// 直接打开网址（POP）不该播「新开了一层」的动画
await send('Page.navigate', { url: `${APP}/home/diary` })
await waitFor(`document.body.innerText.includes('日记')`, '直接打开子页')
await new Promise((resolve) => setTimeout(resolve, 400))
check('直接打开网址 / 刷新时不播进场动画', (await evaluate(`document.querySelector('.slide-in') === null`)) === true)

const back = await evaluate(`(() => {
  const link = document.querySelector('a[href="/home"]')
  return link === null ? null : { text: link.textContent.trim(), found: true }
})()`)
check('子页面提供返回首页的入口', back !== null && back.found === true, JSON.stringify(back?.text ?? null))

/* ============================================================
   四、界面不再用 emoji 当图标
   ============================================================ */
// `\p{Extended_Pictographic}` 覆盖真正的图形 emoji；`♡` 是设计里的排版装饰符（欢迎页那句），不是图标
const PAGES = ['/chat', '/home', '/home/diary', '/home/board', '/home/countdown', '/llm', '/life', '/setting', '/welcome']
const offenders = []
for (const path of PAGES) {
  await send('Page.navigate', { url: `${APP}${path}` })
  await waitFor(`document.body.innerText.trim().length > 0`, `${path} 渲染`, 15000)
  await new Promise((resolve) => setTimeout(resolve, 350))
  const hits = await evaluate(`(() => {
    const found = document.body.innerText.match(/\\p{Extended_Pictographic}/gu) ?? []
    return [...new Set(found)].filter((ch) => ch !== '♡')
  })()`)
  if (hits.length > 0) offenders.push(`${path}: ${hits.join(' ')}`)
}
check('各页面渲染文本里不再有 emoji 图标', offenders.length === 0, offenders.join(' | '))

/* ---------- 收尾 ---------- */
// 还原成移动视口：中间为验「宽屏下底栏不横跨整屏」改过 deviceMetrics，
// 别把一个 1200px 的宽屏状态留给后面的脚本。
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: `${APP}/home` })
await waitFor(`document.querySelector('[data-testid="bottom-nav"]') !== null`, '回到 Home')
check('移动端页面无横向溢出', await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))

const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

ws.close()
const passed = results.filter((result) => result.ok).length
console.log(`\n应用外壳：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
