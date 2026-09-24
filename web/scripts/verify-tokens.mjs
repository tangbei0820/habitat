/**
 * 栖息地 UI 换装 · 第 1 批（地基）验收：设计令牌 + 翻译层 + 通用积木。
 *
 * 前置：Vite 起在 VERIFY_APP（默认 :5174）+ 带 remote-debugging-port 的 Edge。
 *      **本支不需要 server** —— 它验的是"衣服到没到"，不是数据。（流水线里跟着组一跑也无害）
 *
 * 为什么值得单独给令牌写一支脚本：
 * 这次换装要在**不改 551 处旧代码**的前提下把新配色铺开，靠的就是 theme/tokens.css
 * 那层「翻译层」（旧名 `--color-bg` → 新令牌 `--bg-base`）。
 * 翻译层一旦哪条断了，症状是**某个页面某处字看不见**，很难一眼找到源头。
 * 所以在开工第一步就把它钉住：每条转发都逐字比对，断了立刻红。
 *
 * ⚠️ 这里断言的是**相对关系**（旧名 === 新名）而不是具体色值 —— 色值将来会调，
 *    相对关系不该变。只有"浅色和深色必须不同"这类约束才写死。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
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

/* ---------- 2. 翻译层：旧名逐条指到新名 ---------- */
const PAIRS = [
  ['--color-bg', '--bg-base'],
  ['--color-surface', '--bg-surface-solid'],
  ['--color-surface-alt', '--bg-subtle'],
  ['--color-text', '--text-primary'],
  ['--color-text-dim', '--text-secondary'],
  ['--color-primary', '--accent-strong'],
  ['--color-primary-contrast', '--accent-on-strong'],
  ['--color-danger', '--danger'],
  ['--color-border', '--border-soft'],
  ['--font-family', '--font-main'],
]
const pairNames = [...new Set(PAIRS.flat())]
const pairValues = await readTokens(pairNames)
const broken = PAIRS.filter(([oldName, newName]) => norm(pairValues[oldName]) !== norm(pairValues[newName]))
check(
  '翻译层 10 条转发全部接通（旧名 === 新名）',
  broken.length === 0,
  broken.map(([a, b]) => `${a}(${pairValues[a]}) ≠ ${b}(${pairValues[b]})`).join(' | ') || `${PAIRS.length} 条`,
)

/* ---------- 3. 历史遗留：--color-accent 之前根本没定义 ---------- */
const legacyAccent = await readTokens(['--color-accent'])
check('历史遗留的 --color-accent 已补齐（此前 4 处引用全部失效）', legacyAccent['--color-accent'] !== '' && norm(legacyAccent['--color-accent']) === norm(pairValues['--accent-strong']), `--color-accent = ${legacyAccent['--color-accent'] || '(空)'}`)

/* ---------- 4. 旧组件的容器仍拿到占位高度（AppShell 依赖） ---------- */
const navHeight = await readTokens(['--bottom-nav-height'])
check('--bottom-nav-height 仍在（底部导航占位依赖它）', navHeight['--bottom-nav-height'] !== '', navHeight['--bottom-nav-height'])

/* ---------- 5. 新配色已经铺到真实页面上 ---------- */
const lightBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
check('浅色下 body 用的是新底色 --bg-base', lightBg === 'rgb(243, 243, 245)', `body = ${lightBg}`)
await shot('verify-tokens-light.png')

/* ---------- 6. 深色模式：新令牌与旧别名必须**一起**跟随 ---------- */
await applyTheme('dark')
await new Promise((resolve) => setTimeout(resolve, 400))
const darkTokens = await readTokens(['--bg-base', '--text-primary', '--color-bg', '--color-text', '--color-surface'])
const darkBodyBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
check('深色下 --bg-base 取到深色值', darkTokens['--bg-base'] === '#121212', darkTokens['--bg-base'])
check('深色下 body 底色跟着变', darkBodyBg === 'rgb(18, 18, 18)', `body = ${darkBodyBg}`)
check('深色下旧别名自动跟随（说明不是只有新名在切）', norm(darkTokens['--color-bg']) === norm(darkTokens['--bg-base']) && norm(darkTokens['--color-text']) === norm(darkTokens['--text-primary']), `--color-bg=${darkTokens['--color-bg']} --color-text=${darkTokens['--color-text']}`)
check('深色不是把浅色值照抄一份', norm(darkTokens['--bg-base']) !== norm(pairValues['--bg-base']), `${pairValues['--bg-base']} → ${darkTokens['--bg-base']}`)
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
check('用户侧消息行方向反转（右侧对齐）', built.userRow.flexDirection === 'row-reverse', built.userRow.flexDirection)
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
console.log(`\n设计地基（令牌 / 翻译层 / 积木）：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
