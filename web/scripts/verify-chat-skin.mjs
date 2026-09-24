/**
 * UI 换装第 3 批 · 对话页换皮验收（SPEC §11.3，设计源 `designs/qixi-habitat/screens-chat.jsx`）
 *
 * 第 1 批把「对话积木」写进了 `theme/qixi/components.css`，第 2 批换了外壳，
 * 第 3 批才轮到真正把积木套到对话页上。这一支盯的就是「到底套上没有」：
 *
 *   1. **气泡**：AI / 用户两侧的方向与底色分开、圆角来自令牌阶梯、时间行每条约有；
 *   2. **操作行常显**：设计的 `.msg-actions` 默认 `opacity: 0` 靠 hover 显形，
 *      触屏没有 hover —— 这里必须**真的 opacity = 1 且 hit-test 命中**，否则手机上四个入口等于不存在；
 *   3. **输入胶囊**：浮起玻璃、圆角 28px、停在文档流里**不遮消息**（原型是绝对定位浮层，
 *      栖息地是沉浸式会话页，照搬会与虚拟列表抢高度 —— 这条断言就是那个偏离的守门人）；
 *   4. **圆形发送按钮**：图标化（不再是「发送」两个字），所以本支只按 `data-testid` 找它；
 *   5. **11 个既有入口一个不缺** + 界面不再拿 ＋ / ⋯ / emoji 当图标用。
 *
 * ⚠️ 断言写的是**相对关系**（气泡底色 === 根元素上的 `--accent-strong` 解析值），
 *    不写死色值 —— 配色将来会调，关系不该变。
 *
 * 前置（四件都得起着；本支要真发一条消息才拿得到气泡）：
 *   server/ : node node_modules/tsx/dist/cli.mjs src/providers/mock-openai.ts   → :3334
 *   server/ : node node_modules/tsx/dist/cli.mjs src/index.ts                   → :3100（.env 指向 mock 上游）
 *   web/    : HABITAT_API_TARGET=http://127.0.0.1:3100 node node_modules/vite/bin/vite.js --port 5174
 *   任意    : msedge --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录>
 *
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）、VERIFY_MOCK（默认 :3334）
 * 用法：node web/scripts/verify-chat-skin.mjs
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
  await sleep(800) // 等 `.rise` / `msg-in` 播完，抢拍会拍到 opacity:0 的第一帧
  const data = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(data.data, 'base64'))
}
const COMPOSER = `document.querySelector('[data-testid="composer"]')`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await sleep(600)
consoleLogs.length = 0

/** 主题固定成浅色再量：截图可读，且「浅/深色都要成立」由 verify-tokens 管，这里只管结构 */
const originalTheme = await evaluate(`document.documentElement.dataset.theme ?? ''`)

/**
 * 根元素上的一批**尺寸类**令牌（这类值不会被浏览器改写法，可以逐字比）。
 * ⚠️ 必须在**导航到应用之后**才读 —— 浏览器此刻还停在 `about:blank`，
 * 那份文档里一个样式表都没有，读出来全是空串（踩过：底座比较项全成 undefined，一片假红）。
 */
const readTokens = (names) =>
  evaluate(`(() => {
    const cs = getComputedStyle(document.documentElement)
    const out = {}
    for (const name of ${JSON.stringify(names)}) out[name] = cs.getPropertyValue(name).trim()
    return out
  })()`)

/**
 * 把**颜色**令牌解析成 rgb()。
 * ⚠️ 不能直接拿 `getPropertyValue('--bg-surface-solid')` 去比 —— 令牌里写的是 `#ffffff`，
 * 而 `getComputedStyle(el).backgroundColor` 返回 `rgb(255, 255, 255)`，字符串永远对不上。
 * 挂个探针元素让浏览器自己换算，两边就同一种写法了。
 * 探针里写的是**令牌解析后的原值**而不是 `var(--x)`：内联样式里的 `var()` 一旦解析不了
 * 就会静默退回 `color` 的初始值（黑），于是所有颜色都被"验成"黑色。
 */
const tokenColor = (name) =>
  evaluate(`(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()
    if (raw === '') return ''
    const probe = document.createElement('div')
    probe.style.color = raw
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })()`)

/* ================================================================
   一、会话列表页（设计稿里没有这一屏，只验「已经穿的是新衣服」）
   ================================================================ */
await send('Page.navigate', { url: `${APP}/chat` })
await waitFor(`document.querySelector('[data-testid="bottom-nav"]') !== null`, '外壳挂载')
await waitFor(`document.querySelector('.topbar') !== null`, '列表顶栏出现')
await evaluate(`(() => { document.documentElement.dataset.theme = 'light'; return 'ok' })()`)
await sleep(200)

const COLOR = {
  accent: await tokenColor('--accent-strong'),
  surface: await tokenColor('--bg-surface-solid'),
  subtle: await tokenColor('--bg-subtle'),
}
const RADIUS = await readTokens(['--radius-lg', '--radius-sm'])
if (COLOR.accent === '' || RADIUS['--radius-lg'] === '') {
  throw new Error('设计令牌读不到 —— 应用没挂上或主题样式没加载，后面的颜色/圆角断言会全部无意义')
}

const listSkin = await evaluate(`(() => {
  const top = document.querySelector('.topbar')
  const title = top === null ? null : top.querySelector('.topbar-title')
  const pills = [...document.querySelectorAll('.btn-pill')].map((b) => ({
    text: b.textContent.trim(),
    radius: getComputedStyle(b).borderRadius,
    hasIcon: b.querySelector('svg') !== null,
  }))
  return { title: title === null ? null : title.textContent.trim(), pills }
})()`)
check(
  '列表顶栏走设计的 `.topbar`，标题是「对话」',
  listSkin.title === '对话',
  String(listSkin.title),
)
check(
  '「新建 / 分组」是胶囊按钮（999px）且图标是 SVG',
  listSkin.pills.length >= 2 &&
    listSkin.pills.every((p) => p.radius === '999px' && p.hasIcon),
  JSON.stringify(listSkin.pills),
)
// 会话行的卡片形态留到「发完消息再回列表」那一段验 —— 此刻列表可能是空的
await shot('shot-skin-chat-list-empty.png')

/** 比颜色：忽略空白与大小写（`rgb(1, 2, 3)` vs `rgb(1,2,3)`） */
function normEq(a, b) {
  return String(a ?? '').replace(/\s+/g, '') === String(b ?? '').replace(/\s+/g, '')
}

/* ================================================================
   二、进一个真会话（气泡要真数据才画得出来）
   ================================================================ */
const started = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建'))
  if (btn === undefined) return 'missing'
  btn.click()
  return 'ok'
})()`)
if (started !== 'ok') throw new Error('列表页找不到「新建」按钮')
await waitFor(`location.pathname.startsWith('/chat/')`, '进入会话窗口')
await waitFor(`${COMPOSER} !== null`, '输入区就绪')

// 发一条并等回复落地：气泡两侧各一条，才验得到左右与底色
await evaluate(`(() => { ${COMPOSER}.focus(); return 'ok' })()`)
await sleep(200)
await send('Input.insertText', { text: '换皮验收：看一眼气泡' })
await sleep(450)
await evaluate(`(() => { document.querySelector('[data-testid="send"]').click(); return 'ok' })()`)
await waitFor(
  `document.querySelectorAll('[data-testid^="msg-actions-"]').length > 0 &&
   document.body.innerText.includes('流式回复')`,
  '首轮回复落地',
  30000,
)
await sleep(600)

/* ================================================================
   三、顶栏（低存在感）
   ================================================================ */
const topbar = await evaluate(`(() => {
  const header = document.querySelector('[data-testid="chat-topbar"]')
  if (header === null) return { found: false }
  const status = document.querySelector('[data-testid="chat-status"]')
  const buttons = [...header.querySelectorAll('button, a.icon-btn')].map((el) => {
    const cs = getComputedStyle(el)
    return {
      testid: el.getAttribute('data-testid'),
      radius: cs.borderRadius,
      w: cs.width,
      h: cs.height,
      hasIcon: el.querySelector('svg') !== null,
      text: el.textContent.trim(),
    }
  })
  return {
    found: true,
    isTopbar: header.classList.contains('topbar'),
    title: (header.querySelector('.topbar-title') ?? {}).textContent ?? null,
    statusText: status === null ? null : status.textContent.trim(),
    hasDot: status !== null && status.querySelector('.dot') !== null,
    buttons,
  }
})()`)
check('会话页顶栏是设计的 `.topbar`（不是一个带底边的自绘 header）', topbar.found && topbar.isTopbar, JSON.stringify(topbar.title))
check(
  '顶栏状态行是「点 + 真话」两件套（在线 / 正在回复… / 离线）',
  topbar.hasDot === true &&
    ['在线', '正在回复…', '离线'].some((t) => (topbar.statusText ?? '').startsWith(t)),
  String(topbar.statusText),
)
check(
  '顶栏每个按钮都是圆形图标按钮（44px 命中区、无文字）',
  topbar.buttons.length >= 3 &&
    topbar.buttons.every(
      (b) => b.radius === '50%' && b.w === '44px' && b.h === '44px' && b.hasIcon && b.text === '',
    ),
  JSON.stringify(topbar.buttons.map((b) => `${b.testid}:${b.radius}/${b.w}`)),
)

/* ================================================================
   四、气泡：方向 / 底色 / 圆角 / 时间行 / 操作行
   ================================================================ */
const bubbles = await evaluate(`(() => {
  const pick = (sel) => {
    const row = document.querySelector(sel)
    if (row === null) return null
    const bubble = row.querySelector('.msg-bubble')
    if (bubble === null) return null
    const cs = getComputedStyle(bubble)
    return {
      direction: getComputedStyle(row).flexDirection,
      justify: getComputedStyle(row).justifyContent,
      bg: cs.backgroundColor,
      tl: cs.borderTopLeftRadius,
      tr: cs.borderTopRightRadius,
      col: row.querySelector('.msg-col') !== null,
      meta: row.querySelector('.msg-meta') !== null,
    }
  }
  return { user: pick('.msg-row.from-user'), ai: pick('.msg-row.from-ai') }
})()`)
check(
  '用户消息行靠右（justify-content: flex-end；DOM 顺序不翻转，头像才能待在气泡外侧）',
  bubbles.user !== null && bubbles.user.direction === 'row' && bubbles.user.justify === 'flex-end',
  bubbles.user === null ? 'missing' : `${bubbles.user.direction}/${bubbles.user.justify}`,
)
check(
  'AI 消息行不反转（气泡靠左）',
  bubbles.ai !== null && bubbles.ai.direction === 'row',
  bubbles.ai === null ? 'missing' : bubbles.ai.direction,
)
check(
  '用户气泡底色 = --accent-strong',
  bubbles.user !== null && normEq(bubbles.user.bg, COLOR.accent),
  bubbles.user === null ? 'missing' : `${bubbles.user.bg} vs ${COLOR.accent}`,
)
check(
  'AI 气泡底色 = --bg-surface-solid',
  bubbles.ai !== null && normEq(bubbles.ai.bg, COLOR.surface),
  bubbles.ai === null ? 'missing' : `${bubbles.ai.bg} vs ${COLOR.surface}`,
)
check(
  '气泡圆角来自令牌阶梯（圆角侧 24px + 贴近头像那角 12px）',
  bubbles.ai !== null &&
    bubbles.ai.tl === RADIUS['--radius-sm'] &&
    bubbles.ai.tr === RADIUS['--radius-lg'] &&
    bubbles.user !== null &&
    bubbles.user.tl === RADIUS['--radius-lg'] &&
    bubbles.user.tr === RADIUS['--radius-sm'],
  `ai=${bubbles.ai?.tl}/${bubbles.ai?.tr} user=${bubbles.user?.tl}/${bubbles.user?.tr}`,
)
check(
  '每条消息走 `.msg-col` 列容器 + 时间行（不再是匿名 div 与百分比宽度）',
  bubbles.ai !== null && bubbles.ai.col && bubbles.ai.meta && bubbles.user !== null && bubbles.user.col,
  JSON.stringify({ aiCol: bubbles.ai?.col, aiMeta: bubbles.ai?.meta, userCol: bubbles.user?.col }),
)

const divider = await evaluate(`(() => {
  const d = document.querySelector('.day-divider')
  return d === null ? null : d.textContent.trim()
})()`)
check(
  '跨天处有日期分隔（今天的会话应显示「今天」）',
  divider === '今天',
  String(divider),
)

/* --- 操作行：触屏可见 + 真的点得到 --- */
const actions = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-testid^="msg-actions-"]')]
  const row = rows[rows.length - 1]
  if (row === undefined) return { found: false }
  const cs = getComputedStyle(row)
  const btn = row.querySelector('button')
  let hit = null
  if (btn !== null) {
    btn.scrollIntoView({ block: 'nearest' })
    const r = btn.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    hit = el === null ? 'null' : el.tagName + ':' + (el.getAttribute('data-testid') || '')
  }
  return {
    found: true,
    opacity: cs.opacity,
    visibility: cs.visibility,
    pointerEvents: cs.pointerEvents,
    buttonHit: hit,
    inView: btn !== null && btn.getBoundingClientRect().top >= 0,
  }
})()`)
check(
  '操作行常显（opacity = 1，不靠 hover）—— 触屏没有 hover',
  actions.found === true && actions.opacity === '1' && actions.visibility === 'visible',
  JSON.stringify({ opacity: actions.opacity, visibility: actions.visibility }),
)
check(
  '操作行按钮命中测试真的点得到（不是被别的层盖住）',
  actions.found === true && actions.buttonHit !== null && actions.buttonHit !== 'null',
  String(actions.buttonHit),
)

/* --- 进入动画只播一次：is-entering 窗口过了以后逐条动画必须是 none --- */
await waitFor(
  `document.querySelector('.chat-scroll.is-entering') === null`,
  '开场动画窗口关闭',
  5000,
).catch(() => {})
const anim = await evaluate(`(() => {
  const row = document.querySelector('.chat-scroll.is-virtual .msg-row')
  return row === null ? null : getComputedStyle(row).animationName
})()`)
check(
  '虚拟列表里逐条进入动画只播一次（窗口关了之后 animation-name = none）',
  anim === 'none',
  String(anim),
)
await shot('shot-skin-chat-bubbles.png')

/* ================================================================
   五、输入胶囊
   ================================================================ */
const bar = await evaluate(`(() => {
  const el = document.querySelector('.chat-inputbar')
  if (el === null) return { found: false }
  const cs = getComputedStyle(el)
  const ta = el.querySelector('textarea[data-testid="composer"]')
  const send = el.querySelector('[data-testid="send"]')
  const sendCs = send === null ? null : getComputedStyle(send)
  const quick = document.querySelector('[data-testid="quick-bar"]')
  const area = document.querySelector('[data-testid="chat-message-area"]')
  const rect = el.getBoundingClientRect()
  return {
    found: true,
    docked: el.classList.contains('chat-inputbar--docked'),
    position: cs.position,
    radius: cs.borderRadius,
    backdrop: cs.backdropFilter || cs.webkitBackdropFilter || '',
    hasTextarea: ta !== null,
    sendRadius: sendCs === null ? null : sendCs.borderRadius,
    sendW: sendCs === null ? null : sendCs.width,
    sendH: sendCs === null ? null : sendCs.height,
    sendHasIcon: send !== null && send.querySelector('svg') !== null,
    sendText: send === null ? '' : send.textContent.trim(),
    bottom: rect.bottom,
    top: rect.top,
    viewport: innerHeight,
    quickBottom: quick === null ? null : quick.getBoundingClientRect().bottom,
    areaBottom: area === null ? null : area.getBoundingClientRect().bottom,
  }
})()`)
check(
  '输入区是「停靠」变体（文档流内，不抢虚拟列表高度）',
  bar.found === true && bar.docked === true && bar.position === 'static',
  `${bar.position} / docked=${String(bar.docked)}`,
)
check('输入胶囊圆角 28px', bar.radius === '28px', String(bar.radius))
check('输入胶囊有毛玻璃（backdrop blur）', bar.backdrop.includes('blur'), bar.backdrop || '(空)')
check(
  '胶囊不遮消息（消息区底 ≤ 胶囊顶）',
  bar.areaBottom !== null && bar.areaBottom <= bar.top + 1,
  `area=${bar.areaBottom} pill=${bar.top}`,
)
check(
  '胶囊是整屏最底部那一条（快捷栏在它上方，不被顶离底部）',
  bar.quickBottom !== null &&
    bar.quickBottom <= bar.top + 1 &&
    // 容差给到 24px：要区分的是「沉在底部」与「像原型那样浮在底栏上方 86px」，不是精确到像素
    bar.bottom >= bar.viewport - 24,
  `quick=${bar.quickBottom} pillTop=${bar.top} pillBottom=${bar.bottom} vh=${bar.viewport}`,
)
check(
  '主按钮是圆形图标按钮（42px 正圆、内含 SVG、没有文字）',
  bar.sendRadius === '50%' &&
    bar.sendW === '42px' &&
    bar.sendH === '42px' &&
    bar.sendHasIcon &&
    bar.sendText === '',
  `${bar.sendRadius}/${bar.sendW}×${bar.sendH} icon=${String(bar.sendHasIcon)} text=${JSON.stringify(bar.sendText)}`,
)

const quick = await evaluate(`(() => {
  const ids = ['quick-voice', 'quick-emoji', 'quick-more', 'request-reply']
  const out = {}
  for (const id of ids) {
    const el = document.querySelector('[data-testid="' + id + '"]')
    // 可读名：图标按钮靠 aria-label，带文字的按钮靠它自己的文字
    out[id] =
      el !== null &&
      ((el.getAttribute('aria-label') ?? '').trim() !== '' || el.textContent.trim() !== '')
  }
  out.inPill = document.querySelector('.chat-inputbar [data-testid="quick-more"]') !== null
  return out
})()`)
check(
  '快捷栏四项齐（语音 / 表情 / 更多 / 请求回复）且有可读名',
  quick['quick-voice'] && quick['quick-emoji'] && quick['quick-more'] && quick['request-reply'],
  JSON.stringify(quick),
)
check('「＋」进了胶囊本体（与设计一致：＋ / 文本 / 语音 / 圆形主按钮）', quick.inPill === true, String(quick.inPill))

/* 表情面板：贴着胶囊长出来的卡片，不是一条带顶边框的横条 */
await evaluate(`(() => { document.querySelector('[data-testid="quick-emoji"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="emoji-panel"]') !== null`, '表情面板展开')
const panel = await evaluate(`(() => {
  const el = document.querySelector('[data-testid="emoji-panel"]')
  const cs = getComputedStyle(el)
  return { isCard: el.classList.contains('card'), radius: cs.borderTopLeftRadius, bg: cs.backgroundColor }
})()`)
check(
  '表情面板是浮起卡片（`.card` + 令牌圆角），不是带顶边框的横条',
  panel.isCard && panel.radius === RADIUS['--radius-lg'],
  JSON.stringify(panel),
)
await shot('shot-skin-chat-composer.png')
await evaluate(`(() => { document.querySelector('[data-testid="quick-emoji"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="emoji-panel"]') === null`, '表情面板收起')

/* ================================================================
   六、11 个既有入口一个不缺 + 界面不再拿字符当图标
   ================================================================ */
const REQUIRED = [
  'chat-back', // 返回会话列表（沉浸式路由唯一的回程入口）
  'mini-terminal-open', // 工具面板
  'chat-settings-open', // 聊天设置
  'chat-message-area', // 消息区（会话背景挂在这里）
  'chat-status', // 状态行
  'composer', // 文本输入
  'send', // 发送
  'quick-voice', // 语音条
  'quick-emoji', // 表情包
  'quick-more', // 更多（只发送 / 发图 / 生图 / 插入时间 / 清空）
  'request-reply', // 请求回复
]
const found = await evaluate(`(() => {
  const ids = ${JSON.stringify(REQUIRED)}
  const miss = ids.filter((id) => document.querySelector('[data-testid="' + id + '"]') === null)
  const prefix = ['msg-actions-', 'more-', 'reroll-'].filter(
    (p) => document.querySelector('[data-testid^="' + p + '"]') === null,
  )
  return { miss, prefix }
})()`)
check(
  `既有对话入口一个不缺（${REQUIRED.length} 个显式 + 消息级操作行）`,
  found.miss.length === 0 && found.prefix.length === 0,
  `缺 ${JSON.stringify(found.miss)} / 前缀缺 ${JSON.stringify(found.prefix)}`,
)

const charIcons = await evaluate(`(() => {
  // ＋(U+FF0B) ⋯(U+22EF) 与 emoji 都不该再当图标用；表情面板里的**内容**不算（那是用户要发出去的）
  const re = /[\\uFF0B\\u22EF\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u
  return [...document.querySelectorAll('button, a')]
    .filter((el) => el.getAttribute('data-testid') !== 'emoji-option')
    .filter((el) => re.test(el.textContent ?? ''))
    .map((el) => (el.getAttribute('data-testid') ?? el.className) + ':' + el.textContent.trim().slice(0, 6))
})()`)
check('界面上不再用 ＋ / ⋯ / emoji 当图标', charIcons.length === 0, charIcons.slice(0, 4).join(' | '))

/* ================================================================
   七、回列表看会话行（此刻库里已经有会话了，卡片形态才验得到）
   ================================================================ */
await evaluate(`(() => { document.querySelector('[data-testid="chat-back"]').click(); return 'ok' })()`)
await waitFor(`location.pathname === '/chat'`, '回到会话列表')
await waitFor(`document.querySelector('[data-testid^="session-row-"]') !== null`, '会话行出现')

const rowSkin = await evaluate(`(() => {
  const row = document.querySelector('[data-testid^="session-row-"]')
  const cs = getComputedStyle(row)
  const menu = document.querySelector('[data-testid^="session-menu-"]')
  const re = /[\\uFF0B\\u22EF\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u
  return {
    bg: cs.backgroundColor,
    radius: cs.borderTopLeftRadius,
    isCard: row.classList.contains('card'),
    menuHasIcon: menu !== null && menu.querySelector('svg') !== null,
    menuText: menu === null ? '' : menu.textContent.trim(),
    offenders: [...document.querySelectorAll('button, a')]
      .filter((el) => re.test(el.textContent ?? ''))
      .map((el) => (el.getAttribute('data-testid') ?? el.className) + ':' + el.textContent.trim().slice(0, 6)),
  }
})()`)
check(
  '会话行是卡片（`.card` + 底色 = --bg-surface-solid + 圆角 = --radius-lg）',
  rowSkin.isCard && normEq(rowSkin.bg, COLOR.surface) && rowSkin.radius === RADIUS['--radius-lg'],
  `${rowSkin.bg} / ${rowSkin.radius} / card=${String(rowSkin.isCard)}`,
)
check(
  '行内「更多」已是图标按钮（不再是 ⋯ 字符）',
  rowSkin.menuHasIcon && rowSkin.menuText === '',
  `icon=${String(rowSkin.menuHasIcon)} text=${JSON.stringify(rowSkin.menuText)}`,
)
check('会话列表上也没有 ＋ / ⋯ / emoji 当图标', rowSkin.offenders.length === 0, rowSkin.offenders.slice(0, 4).join(' | '))
await shot('shot-skin-chat-list.png')

/* ================================================================
   八、收尾
   ================================================================ */
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
console.log(`\n对话页换皮（第 3 批）：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
