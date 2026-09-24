/**
 * Phase 6 · PWA 前端验收（无头 Edge + CDP 裸驱动）
 *
 * ⚠️ 与其它 verify-* 不同：**打的是生产构建产物，不是 dev server**。
 *    开发期刻意不注册 Service Worker（`vite.config.ts` → `devOptions.enabled: false`），
 *    否则改代码不生效；而 manifest / sw.js / 图标全都只在构建后存在。
 *
 * 前置（两件事）：
 *   web/ : npm run build
 *   web/ : npx vite preview --port 5284 --strictPort
 *   任意 : msedge --headless=new --remote-debugging-port=9434 --user-data-dir=<临时目录>
 *
 * 环境变量：VERIFY_APP（默认 :5284）、VERIFY_CDP（默认 :9434）
 * （端口刻意避开 `run-front-verify.sh` 已占用的 5274 / 9333，两条流水线可并存）
 *
 * 覆盖：manifest 与图标 → Service Worker 注册与接管 → 预缓存内容 →
 *       与 Phase 4 推送处理器的合并 → **断网后仍能打开应用外壳** → 断网时 /api/ 不被兜底成 HTML。
 * 用法：node web/scripts/verify-pwa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9434'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5284'
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })

const results = []
/** 联网阶段的控制台异常要断言为空；离线阶段的失败留给 T-029 的离线态兜底，只记录不判失败 */
let phase = 'online'
const consoleLogs = { online: [], offline: [] }
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  → ${detail}`}`)
}

const targets = await (await fetch(`${CDP}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (target === undefined) throw new Error('找不到 Edge page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const request = pending.get(message.id)
    if (request !== undefined) {
      pending.delete(message.id)
      if (message.error !== undefined) request.reject(new Error(JSON.stringify(message.error)))
      else request.resolve(message.result)
    }
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const type = message.params.type
    if (type === 'error' || type === 'warning') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
      consoleLogs[phase].push(`[${type}] ${text}`)
    }
  } else if (message.method === 'Runtime.exceptionThrown') {
    consoleLogs[phase].push(`[exception] ${message.params.exceptionDetails.text}`)
  }
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const callId = ++id
    pending.set(callId, { resolve, reject })
    ws.send(JSON.stringify({ id: callId, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, label, timeout = 20000) {
  // ⚠️ 这里必须 `await` 一下再判断：条件写成 Promise 时（如 getRegistration(...).then(...)），
  //    直接 `if (promise)` 恒为真 —— 会变成「一上来就成立」的假等待，等于没等。
  const ok = await evaluate(
    `(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){try{if(await (${expression}))return true}catch{}await new Promise(r=>setTimeout(r,150))}return false})()`,
  )
  if (!ok) throw new Error(`等待超时：${label}`)
}
async function httpStatus(url) {
  try {
    const response = await fetch(url, { method: 'GET' })
    return response.status
  } catch {
    return 0
  }
}

await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')

/* ---------- 一、首次访问：manifest 与图标 ---------- */
await send('Page.navigate', { url: APP })
await waitFor('document.querySelector("#root") !== null', '应用外壳挂载')

const manifestHref = await evaluate(
  'document.querySelector(\'link[rel="manifest"]\')?.getAttribute("href") ?? null',
)
check('HTML 里注入了 manifest 链接', manifestHref !== null, String(manifestHref))

const manifestStatus = await httpStatus(`${APP}/manifest.webmanifest`)
check('manifest 文件可访问', manifestStatus === 200, `HTTP ${manifestStatus}`)

const manifest = await (await fetch(`${APP}/manifest.webmanifest`)).json()
check('名称与语言正确', manifest.name === '栖息地' && manifest.short_name === '栖息地' && manifest.lang === 'zh-CN', `${manifest.name} / ${manifest.lang}`)
check('以独立应用形态启动', manifest.display === 'standalone', String(manifest.display))
check('起始地址与作用域都是根', manifest.start_url === '/' && manifest.scope === '/', `${manifest.start_url} / ${manifest.scope}`)
check('主题色与页面一致', manifest.theme_color === '#f6f4f1' && manifest.background_color === '#f6f4f1', String(manifest.theme_color))

const icons = Array.isArray(manifest.icons) ? manifest.icons : []
const hasIcon = (size, purpose) => icons.some((icon) => icon.sizes === size && String(icon.purpose).includes(purpose))
check('含 192 与 512 的普通图标', hasIcon('192x192', 'any') && hasIcon('512x512', 'any'), icons.map((i) => `${i.sizes}:${i.purpose}`).join(' '))
check('含 512 的 maskable 图标', hasIcon('512x512', 'maskable'))
check('图标数量为三张（不多带冗余）', icons.length === 3, String(icons.length))

let iconsOk = true
for (const icon of icons) {
  const status = await httpStatus(`${APP}/${icon.src}`)
  if (status !== 200) { iconsOk = false; console.log(`     图标不可访问：${icon.src} → HTTP ${status}`) }
}
check('所有图标文件均可访问', iconsOk)

check(
  '声明了 iOS 主屏图标（manifest 图标 iOS 不认）',
  (await evaluate('document.querySelector(\'link[rel="apple-touch-icon"]\')?.getAttribute("href") ?? null')) === '/apple-touch-icon.png',
)
check('iOS 主屏图标文件可访问', (await httpStatus(`${APP}/apple-touch-icon.png`)) === 200)

/* ---------- 二、Service Worker 注册与接管 ---------- */
await waitFor('navigator.serviceWorker.getRegistration("/").then((r) => r?.active?.state === "activated")', 'Service Worker 激活', 30000)
check('Service Worker 已注册并激活', await evaluate('navigator.serviceWorker.getRegistration("/").then((r) => r?.active?.state === "activated")'))

// 首次安装的 SW 不会接管「已经打开的那个页面」（prompt 模式刻意不开 clientsClaim），
// 刷新一次才会 —— 这也正是真实用户第二次访问时会遇到的情形。
await send('Page.reload')
await waitFor('navigator.serviceWorker.controller !== null', 'Service Worker 接管页面', 30000)
const swUrl = await evaluate('navigator.serviceWorker.controller.scriptURL')
check('当前页面已被 Service Worker 接管', typeof swUrl === 'string' && swUrl.endsWith('/sw.js'), String(swUrl))

// Phase 4 的推送处理器是手写文件，必须被并进同一个 SW —— 否则两个 SW 抢作用域，推送时有时无
const swSource = await (await fetch(`${APP}/sw.js`)).text()
const hasPushHandler = swSource.includes('web-push-sw.js')
check(
  '推送处理器已并入同一个 SW',
  hasPushHandler,
  hasPushHandler ? 'web-push-sw.js 已由主 SW 引入' : '未在 sw.js 中看到 importScripts',
)
check('推送处理器文件本身可访问', (await httpStatus(`${APP}/web-push-sw.js`)) === 200)

const cacheSummary = await evaluate(
  `(async()=>{const keys=await caches.keys();let entries=[];for(const key of keys){const cache=await caches.open(key);entries=entries.concat(await cache.keys())}return {keys, urls: entries.map((request)=>new URL(request.url).pathname)}})()`,
)
check('已建立预缓存', cacheSummary.keys.length > 0, cacheSummary.keys.join(' '))
check('应用外壳（index.html）已进缓存', cacheSummary.urls.includes('/index.html'), cacheSummary.urls.slice(0, 6).join(' '))
const cachedScripts = cacheSummary.urls.filter((url) => url.endsWith('.js'))
check(
  '主脚本已进缓存',
  cachedScripts.length > 0,
  cachedScripts.length > 0 ? `已缓存 ${cachedScripts.length} 个脚本` : '缓存里没有 js',
)

/* ---------- 三、断网：应用外壳仍要能打开 ---------- */
phase = 'offline'
await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
})
check('浏览器已进入断网状态', (await evaluate('navigator.onLine')) === false)

await send('Page.reload')
const shellLoaded = await waitFor('document.querySelector("#root")?.children.length > 0', '断网后应用外壳加载', 25000)
  .then(() => true)
  .catch(() => false)
check('断网后应用外壳仍能从缓存打开', shellLoaded)

const offlineText = await evaluate('document.body.innerText.trim().length')
check('断网后页面渲染出真实内容（非白屏）', typeof offlineText === 'number' && offlineText > 0, `${String(offlineText)} 字符`)

// 关键：/api/ 不能被 navigateFallback 兜底成 index.html，否则断网时会拿到一页 HTML 当接口响应
const apiDuringOffline = await evaluate(
  `fetch('/api/health').then((response)=>({ok:true, status:response.status, type:response.headers.get('content-type')})).catch(()=>({ok:false}))`,
)
check(
  '断网时 /api/ 请求如实失败（未被兜底成 HTML）',
  apiDuringOffline.ok === false || String(apiDuringOffline.type ?? '').includes('application/json') === false,
  JSON.stringify(apiDuringOffline),
)

const offlineScreenshot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/verify-pwa-offline.png`, Buffer.from(offlineScreenshot.data, 'base64'))

/* ---------- 四、恢复联网并收尾 ---------- */
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
})
await send('Page.reload')
await waitFor('navigator.onLine === true', '恢复联网')
check('恢复联网后页面可正常加载', (await evaluate('navigator.onLine')) === true)

const onlineScreenshot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/verify-pwa.png`, Buffer.from(onlineScreenshot.data, 'base64'))

check('联网阶段控制台零异常', consoleLogs.online.length === 0, consoleLogs.online.join(' | '))
if (consoleLogs.offline.length > 0) {
  console.log(`\n（记录，不判失败）断网阶段有 ${consoleLogs.offline.length} 条控制台输出，交由 T-029 的离线态兜底处理：`)
  for (const line of consoleLogs.offline.slice(0, 5)) console.log(`   ${line}`)
}

ws.close()
const passed = results.filter((result) => result.ok).length
console.log(`\nPWA：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
