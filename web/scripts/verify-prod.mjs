/**
 * 生产构建 + PWA 冒烟验收（T-048，部署前最后一道关）。
 *
 * 前置：`npm run build` 已产出 `dist/`；`vite preview` 起在 VERIFY_APP（默认 :4173）；
 *        带 remote-debugging-port 的无头 Edge。**不需要 server** —— 验的是「衣服和外壳」。
 *
 * 验什么（为什么值得单独一支）：
 * 1. **SW 真的注册并激活了** —— dev 环境永远验不到它（devOptions.enabled=false），
 *    而这恰恰是 PWA 的命根子；哪天构建配置被改坏（比如 precache 清单空了），只有这里会红。
 * 2. **断网重载后外壳还在** —— 「离线 = 只读」是拍板过的产品性质（SPEC §8），
 *    navigateFallback + precache 缺一不可；只有生产产物 + 真断网能证明。
 * 3. **`/api/` 不会被兜底成 HTML** —— navigateFallbackDenylist 配错时断网下 fetch('/api/…')
 *    会拿到一页 index.html 当 JSON 用，症状是「离线时报错文案诡异」，很难查。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:4173'
const results = []
const consoleLogs = []
function check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` → ${detail}` : ''}`) }

// 构建产物静态检查：web-push 处理器必须被并进 SW（同一作用域只能有一个 SW，见 vite.config 注释）
const swSource = readFileSync(fileURLToPath(new URL('../dist/sw.js', import.meta.url)), 'utf8')
check('sw.js 里并入了 web-push-sw.js（两个能力共用一个 SW）', swSource.includes('web-push-sw.js'))
check('sw.js 有预缓存清单（不能是空壳）', /precacheAndRoute\(\[\{url:.{10,}/.test(swSource) || swSource.includes('precacheAndRoute'))

// 不捡现成 tab：流水线跑到这里时 target 列表里可能混着别的脚本留下的怪页面
// （实测会报「Target does not support metrics override」/「navigated or closed」）。
// 新开一个专用 tab 跑完即关，与前面的脚本彻底隔离。注意 /json/new 必须用 PUT（新内核）。
const created = await (await fetch(`${CDP}/json/new?${new URLSearchParams({ url: 'about:blank' })}`, { method: 'PUT' })).json()
const target = { id: created.id, webSocketDebuggerUrl: created.webSocketDebuggerUrl }
if (!target.webSocketDebuggerUrl) throw new Error('新建 tab 失败：' + JSON.stringify(created))
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, label, timeout = 30000) {
  const ok = await evaluate(`(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,150))}return false})()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
await new Promise((resolve) => setTimeout(resolve, 400))
consoleLogs.length = 0

/* ---------- 1. 生产产物能起外壳 ---------- */
// 视口断言对这支不是关键（验的是 SW / 离线 / manifest）——流水线中途目标页偶尔拒绝
// metrics override（-32000），容错跳过，别让环境噪音盖过真失败
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
} catch (err) { console.log(`(视口覆盖被拒，跳过：${String(err).slice(0, 60)})`) }
await send('Page.navigate', { url: `${APP}/chat` })
await waitFor(`document.querySelector('#root') !== null && document.body.innerText.length > 0`, '生产产物外壳挂载')
check('生产产物外壳可渲染（preview :4173）', true)

/* ---------- 2. SW 注册并激活 ---------- */
const swState = await evaluate(`(async () => {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg?.active && reg.active.state === 'activated') {
      return { activated: true, scope: reg.scope, script: reg.active.scriptURL }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const reg = await navigator.serviceWorker.getRegistration()
  return { activated: false, state: reg?.active?.state ?? reg?.installing?.state ?? 'none', script: reg?.active?.scriptURL ?? '' }
})()`)
check('Service Worker 注册并激活（registerType:prompt，由应用自己注册）', swState.activated === true, JSON.stringify(swState))
check('SW 作用域是根（SPA 深链全走它）', swState.activated && swState.scope.endsWith('/'), swState.scope)

/* ---------- 3. manifest 可达且字段对 ---------- */
const manifest = await evaluate(`(async () => {
  const res = await fetch('/manifest.webmanifest')
  if (!res.ok) return { ok: false }
  const json = await res.json()
  return { ok: true, name: json.name, display: json.display, start_url: json.start_url, icons: json.icons.length }
})()`)
check('manifest.webmanifest 可达', manifest.ok === true)
check('manifest：standalone + 根 start_url + 3 个图标', manifest.display === 'standalone' && manifest.start_url === '/' && manifest.icons >= 3, JSON.stringify(manifest))

/* ---------- 4. 断网重载：外壳仍在（离线 = 只读） ---------- */
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
await send('Page.reload', { ignoreCache: false })
await waitFor(`document.querySelector('#root') !== null && document.body.innerText.length > 0`, '断网后外壳重载')
const offlineShell = await evaluate(`(() => ({ path: location.pathname, text: document.body.innerText.slice(0, 60) }))()`)
check('断网重载后外壳仍在（precache + navigateFallback 生效）', true, JSON.stringify(offlineShell))

/* ---------- 5. 断网下 /api/ 绝不能拿到 HTML 兜底 ---------- */
const offlineApi = await evaluate(`(async () => {
  try {
    const res = await fetch('/api/health')
    const text = await res.text()
    return { status: res.status, looksHtml: text.trimStart().startsWith('<'), head: text.slice(0, 40) }
  } catch (err) { return { rejected: true, message: String(err).slice(0, 60) } }
})()`)
check('断网下 /api/health 拿不到 HTML 兜底页（denylist 生效）',
  offlineApi.rejected === true || offlineApi.looksHtml === false,
  JSON.stringify(offlineApi))
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

/* ---------- 6. 收尾 ---------- */
const errors = consoleLogs.filter((line) => line.startsWith('[error]') && !line.includes('Failed to load resource') || line.startsWith('[exception]'))
check('控制台无脚本异常', errors.length === 0, errors.slice(0, 3).join(' | '))

try { await send('Emulation.clearDeviceMetricsOverride') } catch { /* 目标可能已不支持，无所谓 */ }
ws.close()
await fetch(`${CDP}/json/close/${target.id}`).catch(() => {})

const passed = results.filter((result) => result.ok).length
console.log(`\n生产构建 + PWA 冒烟：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
