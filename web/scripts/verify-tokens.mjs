/**
 * 栖息地 UI 换装验收：设计令牌 + 通用积木。
 *
 * 前置：Vite 起在 VERIFY_APP（默认 :5174）+ 带 remote-debugging-port 的 Edge。
 *      **本支不需要 server** —— 它验的是"衣服到没到"，不是数据。（流水线里跟着组一跑也无害）
 *
 * 历史：第 1 批靠 theme/tokens.css 翻译层（旧名 `--color-bg` → `--bg-base`）在不改
 * 551 处旧代码的前提下铺开新配色，本脚本当时逐条比对转发。换装 6 批走完（T-045）
 * 旧引用清零、翻译层删除 —— 本脚本反转职责：钉住「翻译层删干净、老名彻底失活」，
 * 防止哪次回退把文件加回来却没人发现。
 *
 * ⚠️ 这里断言的是**相对关系**（如深浅主题必须不同）而不是具体色值 —— 色值将来会调，
 *    相对关系不该变。只有"浅色和深色必须不同"这类约束才写死。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
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
async function waitFor(expression, label, timeout = 30000) {
  const ok = await evaluate(`(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,150))}return false})()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}
async function shot(file) {
  const data = (await send('Page.captureScreenshot', { format: 'png' })).data
  writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await new Promise((resolve) => setTimeout(resolve, 600))
consoleLogs.length = 0

// 手机视口（横向溢出这类断言必须在小屏上量才有意义）
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: `${APP}/chat` })
await waitFor(`document.querySelector('#root') !== null && document.body.innerText.length > 0`, '应用外壳挂载')
await new Promise((resolve) => setTimeout(resolve, 800))

/* ================================================================
   0. 记住当前主题，结束时原样还原（本脚本会来回切主题，不能污染后面的脚本）
   ================================================================ */
const originalTheme = await evaluate(`document.documentElement.dataset.theme ?? ''`)
const applyTheme = (mode) => evaluate(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(mode)}; return document.documentElement.dataset.theme })()`)

/** 读出根元素上一批自定义属性（浏览器会做 var() 替换，所以拿到的是**解析后**的值） */
const readTokens = (names) =>
  evaluate(`(() => {
    const cs = getComputedStyle(document.documentElement)
    const out = {}
    for (const name of ${JSON.stringify(names)}) out[name] = cs.getPropertyValue(name).trim()
    return out
  })()`)

/** 比"解析后的值是否一致"：忽略空白与大小写， 因为 var() 替换后带不带空格是实现细节 */
const norm = (value) => String(value ?? '').replace(/\s+/g, '').toLowerCase()

await applyTheme('light')
await new Promise((resolve) => setTimeout(resolve, 300))

/* ---------- 1. 新令牌齐不齐 ---------- */
const NEW_TOKENS = ['--bg-base', '--bg-surface', '--bg-surface-solid', '--bg-subtle', '--text-primary', '--text-secondary', '--text-tertiary', '--border-soft', '--accent-strong', '--accent-on-strong', '--danger', '--radius-lg', '--radius-pill', '--shadow-soft', '--font-main', '--ease-out', '--dur-normal', '--hit-min']
const newTokens = await readTokens(NEW_TOKENS)
const missingNew = NEW_TOKENS.filter((name) => newTokens[name] === '')
check('新设计令牌全部有值', missingNew.length === 0, missingNew.join(',') || `共 ${NEW_TOKENS.length} 个`)

/* ---------- 2. 翻译层已删净：老名必须彻底失活 ---------- */
const LEGACY_NAMES = [
  '--color-bg', '--color-surface', '--color-surface-alt', '--color-text', '--color-text-dim',
  '--color-primary', '--color-primary-contrast', '--color-danger', '--color-border',
  '--color-accent', '--font-family',
]
const legacyValues = await readTokens(LEGACY_NAMES)
const stillAlive = LEGACY_NAMES.filter((name) => legacyValues[name] !== '')
check(
  '翻译层删净：11 个旧令牌名全部失活（getComputedStyle 读不到值）',
  stillAlive.length === 0,
  stillAlive.map((name) => `${name}=${legacyValues[name]}`).join(' | ') || `${LEGACY_NAMES.length} 个全空`,
)
{
  const tokensFile = fileURLToPath(new URL('../src/theme/tokens.css', import.meta.url))
  const indexCss = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8')
  // 只查 @import 行 —— 注释里提一嘴"当年删过它"是允许的
  const stillImported = indexCss.split('\n').some((line) => line.trim().startsWith('@import') && line.includes('theme/tokens.css'))
  check('theme/tokens.css 文件已删、index.css 不再 import 它',
    !existsSync(tokensFile) && !stillImported,
    existsSync(tokensFile) ? '文件还在' : (stillImported ? 'index.css 还有 @import' : '已删净'))
}

/* ---------- 2b. 布局占位没被一起带走 ---------- */
const navHeight = await readTokens(['--bottom-nav-height'])
check('--bottom-nav-height 仍有兜底值（AppShell 占位 + BottomNav 实测回写依赖）', navHeight['--bottom-nav-height'] !== '', navHeight['--bottom-nav-height'])

/* ---------- 5. 新配色已经铺到真实页面上 ---------- */
const lightBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
check('浅色下 body 用的是新底色 --bg-base', lightBg === 'rgb(243, 243, 245)', `body = ${lightBg}`)
await shot('verify-tokens-light.png')

/* ---------- 6. 深色模式：新令牌必须跟随切换 ---------- */
await applyTheme('dark')
await new Promise((resolve) => setTimeout(resolve, 400))
const darkTokens = await readTokens(['--bg-base', '--text-primary'])
const darkBodyBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
check('深色下 --bg-base 取到深色值', darkTokens['--bg-base'] === '#121212', darkTokens['--bg-base'])
check('深色下 body 底色跟着变', darkBodyBg === 'rgb(18, 18, 18)', `body = ${darkBodyBg}`)
check('深色不是把浅色值照抄一份', norm(darkTokens['--bg-base']) !== norm(newTokens['--bg-base']), `${newTokens['--bg-base']} → ${darkTokens['--bg-base']}`)
await shot('verify-tokens-dark.png')
await applyTheme('light')
await new Promise((resolve) => setTimeout(resolve, 300))

/* ================================================================
   7. 通用积木：把每个类挂到一个探针元素上，量它**真的**算出了样式
      （CSS 里写了不等于生效：被后面的规则覆盖、或 var() 打错名字都会静默失效）
   ================================================================ */
const built = await evaluate(`(() => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:390px;height:600px;overflow:hidden'
  document.body.appendChild(host)
  const probes = {
    bento: ['bento'],
    cell: ['card', 'bento-cell'],
    btn: ['btn-pill', 'btn-strong'],
    toggle: ['toggle'],
    glass: ['glass'],
    bottomNav: ['bottom-nav'],
    subLayer: ['sub-layer'],
    rain: ['rain-backdrop'],
    userRow: ['msg-row', 'from-user'],
    aiRow: ['msg-row', 'from-ai'],
    inputbar: ['chat-inputbar'],
    h1: ['t-h1'],
    iconBtn: ['icon-btn'],
  }
  const out = {}
  for (const [key, classes] of Object.entries(probes)) {
    const node = document.createElement('div')
    node.className = classes.join(' ')
    node.textContent = '探针'
    host.appendChild(node)
    const cs = getComputedStyle(node)
    out[key] = {
      display: cs.display,
      position: cs.position,
      borderRadius: cs.borderRadius,
      minHeight: cs.minHeight,
      width: cs.width,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      fontSize: cs.fontSize,
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter || '',
      backgroundImage: cs.backgroundImage,
      transform: cs.transform,
    }
  }
  host.remove()
  return out
})()`)

check('Bento 是两列网格', built.bento.display === 'grid', built.bento.display)
check('卡片圆角按新阶梯（24px）', built.cell.borderRadius === '24px', built.cell.borderRadius)
check('胶囊按钮：999px 圆角 + 44px 最小点击高度', built.btn.borderRadius === '999px' && built.btn.minHeight === '44px', `${built.btn.borderRadius} / ${built.btn.minHeight}`)
check('开关：48px 宽（设计侧饱满 toggle）', built.toggle.width === '48px', built.toggle.width)
check('玻璃卡：真的有毛玻璃模糊', built.glass.backdrop.includes('blur'), built.glass.backdrop || '(空)')
check('胶囊底栏：绝对定位浮起', built.bottomNav.position === 'absolute', built.bottomNav.position)
check('子页面滑入层：绝对定位且有位移（收起态在屏外）', built.subLayer.position === 'absolute' && built.subLayer.transform !== 'none', built.subLayer.transform)
check('雨幕：背景是渐变（不是图片）', built.rain.backgroundImage.includes('linear-gradient'), built.rain.backgroundImage.slice(0, 48))
// 用户行不翻转方向：DOM 顺序 = [选择标, 气泡列, 头像]（头像在气泡「外侧」），
// 靠右由 justify-content 完成 —— row-reverse 会把 DOM 里最后的头像翻到左边，跟语义打架
check('用户侧消息行靠右（justify-content: flex-end）', built.userRow.flexDirection === 'row' && built.userRow.justifyContent === 'flex-end', `${built.userRow.flexDirection}/${built.userRow.justifyContent}`)
check('AI 侧消息行不反转', built.aiRow.flexDirection === 'row', built.aiRow.flexDirection)
check('输入胶囊：绝对定位（悬浮在内容之上）', built.inputbar.position === 'absolute', built.inputbar.position)
check('字号阶梯 t-h1 = 22px', built.h1.fontSize === '22px', built.h1.fontSize)
check('图标按钮点击区 44px', built.iconBtn.width === '44px', built.iconBtn.width)

/* ---------- 8. 收尾 ---------- */
check('移动端无横向溢出', await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), await evaluate('document.documentElement.scrollWidth + " vs " + document.documentElement.clientWidth'))

const errors = consoleLogs.filter((line) => line.startsWith('[error]') || line.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}`)
await send('Emulation.clearDeviceMetricsOverride')
ws.close()

const passed = results.filter((result) => result.ok).length
console.log(`\n设计地基（令牌 / 翻译层删净 / 积木）：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
