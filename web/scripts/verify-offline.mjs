/**
 * Phase 6 · 离线只读前端验收（无头 Edge + CDP 裸驱动）
 *
 * 验的是「断网时到底还能用多少」：本地数据一律可读，会发请求的动作一律禁用并说清原因。
 * 用 CDP 的 `Network.emulateNetworkConditions` 造真实断网 —— 它会让 `navigator.onLine`
 * 与 fetch 同时失效，和真拔网线一致（只 mock `navigator.onLine` 是验不出问题的）。
 *
 * 前置（与 run-front-verify.sh 组一相同，可直接挂在那条流水线末尾）：
 *   server:3100（.env 指向 mock 上游）+ mock:3334 + vite:5174 + 无头 Edge:9222
 * 环境变量：VERIFY_CDP（默认 :9222）、VERIFY_APP（默认 :5174）
 *
 * ⚠️ 断网后**不能**再 `Page.navigate` / `Page.reload` —— dev server 不可达且 dev 下没有
 *    Service Worker 兜底，一导航就白屏。断网阶段的所有页面切换都走 SPA 内部点击。
 * 用法：node web/scripts/verify-offline.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })

const results = []
/**
 * 控制台日志按阶段分开收：
 * 断网阶段必然有请求失败（这正是「如实失败」的证明），不该被算成异常；
 * 联网阶段（包括恢复联网之后）则必须零异常。
 */
let phase = 'online'
const consoleLogs = { online: [], offline: [], recovered: [] }
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  → ${detail}`}`)
}

const targets = await (await fetch(`${CDP}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (target === undefined) throw new Error('找不到 Edge page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

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
      consoleLogs[phase].push(`[${type}] ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`)
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
  // ⚠️ 必须先 await 再判断：条件写成 Promise 时 `if (promise)` 恒真，会变成假等待
  const ok = await evaluate(
    `(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){try{if(await (${expression}))return true}catch{}await new Promise(r=>setTimeout(r,150))}return false})()`,
  )
  if (!ok) throw new Error(`等待超时：${label}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 真断网 / 真恢复（同时影响 navigator.onLine 与 fetch） */
async function setOffline(offline) {
  await send('Network.emulateNetworkConditions', offline
    ? { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
}
/** 点 SPA 内部链接（断网后唯一的页面切换方式） */
async function clickSelector(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'ok' })()`)
}
async function clickText(text) {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)})
    if (!el) return 'missing'
    el.click()
    return 'ok'
  })()`)
}
/** 按钮文本带图标或全角符号时（如「＋ 新建」）用包含匹配 */
async function clickContains(text) {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button')].find((x) => (x.textContent ?? '').includes(${JSON.stringify(text)}))
    if (!el) return 'missing'
    el.click()
    return 'ok'
  })()`)
}
async function disabledOf(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? 'missing' : el.disabled === true })()`)
}
/** React 受控输入：必须走原生 setter + input 事件，直接改 .value 不会让 React 收到变更 */
async function setValue(selector, text) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'missing'
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value
  })()`)
}
/** 菜单项文本（含 speak —— 它不在 verify-chat 那份白名单里） */
const MENU_LABELS = `[...document.querySelectorAll('[data-testid^="action-"]')].filter((el) => el.tagName === 'BUTTON').map((el) => el.innerText.trim())`
/** 长按气泡打开菜单的移动端路径（右键是桌面路径，两者走同一套回调） */
async function openMenuByLongPress(messageText) {
  return evaluate(`(async () => {
    const root = [...document.querySelectorAll('[data-message-id]')].find((el) => (el.innerText ?? '').includes(${JSON.stringify(messageText)}))
    if (!root) return 'missing'
    const bubble = root.querySelector('.msg-bubble')
    if (!bubble) return 'no-bubble'
    const r = bubble.getBoundingClientRect()
    bubble.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 8, clientY: r.top + 8 }))
    await new Promise((res) => setTimeout(res, 900))
    return document.querySelector('[data-testid="action-sheet"]') !== null ? 'open' : 'closed'
  })()`)
}
async function closeMenu() {
  await evaluate(`(() => { const el = document.querySelector('[data-testid="action-sheet-backdrop"]'); if (el) el.click(); return 'ok' })()`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
// 开工前显式把网络状态归位。本脚本是**唯一**会把浏览器切到断网的验收，
// 万一上一轮异常退出留下残留，先重置一次再谈结论。
// （实测：CDP 会话一断开，上一会话设的断网覆盖就自动失效，所以这一步是兜底而非必需。）
await setOffline(false)

// ⚠️ Runtime.enable 会把**上一个 CDP 会话**留下的 console 消息重放一遍（已实测确认）。
//    不清的话，同一支脚本的「联网阶段零异常」会被上游脚本的报错污染成假 FAIL。
await sleep(600)
consoleLogs.online.length = 0
consoleLogs.offline.length = 0
consoleLogs.recovered.length = 0

try {
  /* ---------- 一、联网基线 ---------- */
  // ⚠️ 两个坑，都踩过：
  //    ① 别导航到根路径 —— 本次会话还没进过会先落到欢迎页，永远等不到聊天列表。
  //    ② 别在这里找英文 "Chat" —— 那是底栏还是「英文标签」时代的残留；第 2 批底栏已换中文
  //       （对话 / 家 / 大脑 / 生活 / 设置），英文串消失会让这条等待一直超时。
  //    统一以「新建」为聊天列表已挂载的信号（与 verify-chat / verify-export 同一口径）。
  await send('Page.navigate', { url: `${APP}/chat` })
  await waitFor('document.body.innerText.includes("新建")', '聊天列表挂载')

  check('联网时不显示离线横幅', (await evaluate('document.querySelector(\'[data-testid="offline-banner"]\') === null')))

  /* ---------- 二、造数据：真发一条消息，拿到 AI 回复 ---------- */
  await clickContains('新建')
  await waitFor('location.pathname.startsWith("/chat/") && location.pathname.length > 6', '进入会话窗口')
  check('新建会话并进入聊天窗口', true, APP + await evaluate('location.pathname'))

  // ⚠️ 新建会话是异步的：路由变了不等于输入框已挂载。少了这一步，setValue 会**静默**
  //    返回 'missing' → 草稿是空的 → 发送按钮一直禁用 → 后面白等超时才报错。
  await waitFor('document.querySelector(\'[data-testid="composer"]\') !== null', '输入框就绪')
  const typed = await setValue('[data-testid="composer"]', '离线验收用的消息')
  check('输入框可写入草稿', typed === '离线验收用的消息', String(typed))
  await clickSelector('[data-testid="send"]')
  await waitFor('document.body.innerText.includes("离线验收用的消息")', '用户消息落地')
  await waitFor('document.body.innerText.includes("流式回复")', 'AI 回复落地', 30000)
  check('联网时能正常对话（后面用它验离线可读）', true)

  check('联网时输入框提示语为常规文案', (await evaluate('document.querySelector(\'[data-testid="composer"]\').placeholder')) === '输入消息…')
  await clickSelector('[data-testid="mini-terminal-open"]')
  await waitFor('document.querySelector(\'[data-testid="tool-select"]\') !== null || document.body.innerText.includes("没有可用工具")', '工具面板已加载')
  check('联网时工具面板可用', true)
  await clickSelector('[aria-label="关闭工具面板"]')

  /* ---------- 三、断网 ---------- */
  // ⚠️ 切换分段桶**必须**紧跟断网动作。漏了这一行，断网阶段那批「请求失败」的
  //    console.error（正是「如实失败」的证据）会被记进 online 桶，
  //    最后那条「联网阶段控制台零异常」就会误报成 FAIL。
  phase = 'offline'
  await setOffline(true)
  check('浏览器已进入断网状态', (await evaluate('navigator.onLine')) === false)

  await waitFor('document.querySelector(\'[data-testid="offline-banner"]\') !== null', '离线横幅出现', 8000)
  const bannerText = await evaluate('document.querySelector(\'[data-testid="offline-banner"]\').innerText')
  check('离线横幅出现', true)
  check('横幅说清「本地照常可看」', bannerText.includes('本地内容照常可看'), bannerText)
  check('横幅点明哪些动作不可用', bannerText.includes('发消息'), bannerText)
  check('横幅不遮挡页面内容（在文档流内且不重叠）', await evaluate(`(() => {
    const banner = document.querySelector('[data-testid="offline-banner"]').getBoundingClientRect()
    const main = document.querySelector('main').getBoundingClientRect()
    return banner.bottom <= main.top + 1
  })()`))

  /* ---------- 四、离线：本地数据照常可读 ---------- */
  await clickSelector('a[href="/chat"]')
  await waitFor('location.pathname === "/chat"', '回到会话列表')
  await sleep(600)
  const listText = await evaluate('document.body.innerText')
  check('离线时聊天列表仍能打开', true)
  check('离线时会话记录仍在（本地数据可读）', listText.includes('离线验收用的消息') || (await evaluate('document.querySelectorAll(\'a[href^="/chat/"]\').length')) > 0)

  /* ---------- 五、离线：输入区 ---------- */
  await clickSelector('a[href^="/chat/"]')
  await waitFor('document.querySelector(\'[data-testid="composer"]\') !== null', '回到聊天窗口')
  // 消息区是虚拟列表：进页面 ≠ 消息已渲染，得等它真出来再断言
  await waitFor('document.body.innerText.includes("离线验收用的消息")', '离线会话内容渲染', 15000)
  check('离线时仍能进入会话窗口并看到历史消息', true)
  check('离线时输入框提示语改为说明离线', (await evaluate('document.querySelector(\'[data-testid="composer"]\').placeholder')).includes('离线'))

  await setValue('[data-testid="composer"]', '离线时写的草稿')
  check('离线时仍可以写草稿（只有发送被禁）', (await evaluate('document.querySelector(\'[data-testid="composer"]\').value')) === '离线时写的草稿')
  check('离线时发送按钮禁用', (await disabledOf('[data-testid="send"]')) === true)
  check('离线时语音按钮禁用', (await disabledOf('[data-testid="quick-voice"]')) === true)
  check('离线时「请求回复」禁用', (await disabledOf('[data-testid="request-reply"]')) === true)

  await evaluate(`(() => { const el = document.querySelector('[data-testid="composer"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`)

  /* ---------- 六、离线：消息菜单里的联网动作应消失，本地动作应保留 ---------- */
  const aiMenu = await openMenuByLongPress('流式回复')
  check('离线时长按仍能打开消息菜单', aiMenu === 'open', String(aiMenu))
  const aiLabels = aiMenu === 'open' ? JSON.parse(await evaluate(`JSON.stringify(${MENU_LABELS})`)) : []
  check('离线时 AI 消息菜单不再提供「朗读」', !aiLabels.includes('朗读'), aiLabels.join('/'))
  check('离线时 AI 消息菜单不再提供「换一个」', !aiLabels.includes('换一个'), aiLabels.join('/'))
  check('离线时本地动作仍保留（收藏 / 复制）', aiLabels.includes('收藏') && aiLabels.some((label) => label.startsWith('复制')), aiLabels.join('/'))
  await closeMenu()

  const userMenu = await openMenuByLongPress('离线验收用的消息')
  const userLabels = userMenu === 'open' ? JSON.parse(await evaluate(`JSON.stringify(${MENU_LABELS})`)) : []
  check('离线时用户消息菜单不再提供「重发」', !userLabels.includes('重发'), userLabels.join('/'))
  check('离线时用户消息仍可编辑 / 删除', userLabels.includes('编辑') && userLabels.includes('删除'), userLabels.join('/'))
  await closeMenu()

  /* ---------- 七、离线：工具面板给的是「离线」而不是「没配 MCP」 ---------- */
  await clickSelector('[data-testid="mini-terminal-open"]')
  await waitFor('document.querySelector(\'[data-testid="tool-offline"]\') !== null', '工具面板离线说明', 8000)
  const toolText = await evaluate('document.querySelector(\'[data-testid="mini-terminal"]\').innerText')
  check('离线时工具面板说明是「离线」而非「没有可用工具」', toolText.includes('当前离线') && !toolText.includes('没有可用工具'), toolText.replace(/\n/g, ' '))
  await clickSelector('[aria-label="关闭工具面板"]')

  /* ---------- 八、离线：设置页与 Life 页 ---------- */
  // ⚠️ 会话窗口是沉浸式的（AppShell 对它隐藏底部导航），先回列表才点得到 Setting
  await clickSelector('a[href="/chat"]')
  await waitFor('location.pathname === "/chat"', '回列表')
  await clickSelector('a[href="/setting"]')
  await waitFor('location.pathname === "/setting"', '设置页打开')
  await waitFor('document.body.innerText.includes("数据备份")', '备份区块渲染')
  check('离线时设置页仍能打开（本地数据可读）', true)
  // 导出全量备份只读本机 Dexie + 触发下载，压根不碰网络 —— 断网时它必须照常可用
  check('离线时「导出备份」仍可用（纯本地动作）', (await disabledOf('[data-testid="backup-export"]')) === false)
  check('离线时「选择备份文件」仍可用', (await disabledOf('[data-testid="backup-choose"]')) === false)
  const offlineReadOnly = await evaluate(`(() => {
    const text = document.body.innerText
    return text.includes('重试') || text.includes('失败') || text.includes('离线') || text.includes('还没有导出过')
  })()`)
  check('离线时联网区块给出可读状态而不是静默空屏', offlineReadOnly)

  const testDisabled = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '测试连接')
    return btn === undefined ? 'absent' : btn.disabled === true
  })()`)
  // 方案列表来自服务端、本地不缓存（SPEC §6.2 的有意偏离），所以断网时它整个不出现也算对；
  // 只要「出现了就一定是禁用的」，就不会出现「点了才报错」
  check('离线时「测试连接」不可点（出现即禁用）', testDisabled === true || testDisabled === 'absent', String(testDisabled))

  // ⚠️ 到达判据别写成 body.innerText.includes('生活') —— 「生活」是**底栏标签**（第 2 批起，
  //    以前叫「Life」），所以它其实哪一页都在，写成存在性判断会恒真；而 LifePage 的 h1 也用这四个字，
  //    页面标题字号大、渲染慢，同样不稳。更稳的是直接看路由。运行视图同理，用 query 参数判，别靠文本。
  await clickSelector('a[href="/life"]')
  await waitFor('location.pathname === "/life"', 'Life 页打开')
  // 第 5 批起「生活」默认落在「生活痕迹」段，记录页签在「记录」段里 —— 先切过去
  await clickText('记录')
  await clickText('运行')
  await waitFor('new URLSearchParams(location.search).get("tab") === "runtime"', '切到运行视图')
  // 运行态整块数据（server / Eventide / MCP / 主动行为）全部来自服务端、本地不缓存
  // （SPEC §6.2 的有意偏离），所以断网时它**整体拿不到** —— 页面如实抛出一行「离线」错误，
  // 而「立即检查」所在的那个 Panel 压根渲染不出来。
  // 因此合格形态是「给出可读说明」而不是「按钮变灰」：按钮不出现也算对，
  // 只要它一旦出现就必定是禁用的 —— 绝不会出现「点了才报错」。
  await waitFor(
    'document.body.innerText.includes("当前处于离线状态") || document.body.innerText.includes("立即检查")',
    '运行视图渲染（离线说明或按钮）', 10000,
  )
  check(
    '离线时运行视图给出可读说明而不是静默空白',
    (await evaluate('document.body.innerText.includes("当前处于离线状态")')) === true,
    (await evaluate('document.body.innerText')).slice(0, 60).replace(/\n/g, ' '),
  )
  const checkNowDisabled = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '立即检查')
    return btn === undefined ? 'absent' : btn.disabled === true
  })()`)
  check('离线时「立即检查」不可点（出现即禁用）', checkNowDisabled === true || checkNowDisabled === 'absent', String(checkNowDisabled))

  const offlineShot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/verify-offline.png`, Buffer.from(offlineShot.data, 'base64'))

  /* ---------- 九、恢复联网 ---------- */
  phase = 'recovered'
  await setOffline(false)
  await waitFor('navigator.onLine === true', '恢复联网')
  await waitFor('document.querySelector(\'[data-testid="offline-banner"]\') === null', '离线横幅消失', 8000)
  check('恢复联网后离线横幅消失', true)

  await clickSelector('a[href="/chat"]')
  await waitFor('document.body.innerText.includes("离线验收用的消息")', '回列表')
  await clickSelector('a[href^="/chat/"]')
  await waitFor('document.querySelector(\'[data-testid="composer"]\') !== null', '回聊天窗口')
  check('恢复联网后输入框提示语还原', (await evaluate('document.querySelector(\'[data-testid="composer"]\').placeholder')) === '输入消息…')
  await setValue('[data-testid="composer"]', '恢复后的草稿')
  const sendRevived = await waitFor('document.querySelector(\'[data-testid="send"]\').disabled === false', '发送按钮恢复可用', 5000)
    .then(() => true).catch(() => false)
  check('恢复联网后发送按钮恢复可用', sendRevived)

  check('联网阶段控制台零异常', consoleLogs.online.length === 0, consoleLogs.online.slice(0, 4).join(' | '))
  check('恢复联网后控制台零异常', consoleLogs.recovered.length === 0, consoleLogs.recovered.slice(0, 4).join(' | '))
  if (consoleLogs.offline.length > 0) {
    console.log(`\n（记录，不判失败）断网阶段有 ${consoleLogs.offline.length} 条控制台输出 —— 断网时请求失败是预期行为：`)
    for (const line of consoleLogs.offline.slice(0, 3)) console.log(`   ${line}`)
  }
} finally {
  // 无论成败都要把网络恢复，否则会毒到同一条流水线后面的脚本
  await setOffline(false).catch(() => undefined)
  ws.close()
}

const passed = results.filter((result) => result.ok).length
console.log(`\n离线只读：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
