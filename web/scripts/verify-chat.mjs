/**
 * 聊天链路前端验收（无头 Edge + CDP 裸驱动）
 *
 * 覆盖：新建会话 → 发送 → 流式渲染 → 中止 → 刷新持久化 → 虚拟列表 → 消息块按 kind 分发 →
 *       分页加载 → 换一个 / 重发 → 消息对象操作 → 跨模块收录 → 会话置顶 / 聊天设置 →
 *       会话分组 → 输入区快捷栏 / 请求回复拆开 / 语音条 → 控制台异常。
 *
 * ⚠️ 「撤回不进模型上下文」这类语义**没有别的验法**：只能读 mock 上游记下的真实报文
 *    （`GET /__last-body`）看客户端到底送了什么。UI 上把消息藏起来很容易，送没送出去才是关键。
 *    同理「只发送没请求回复」也要读报文 —— 不去问上游，就只能靠「界面上没多出一条回复」来猜。
 *
 * ⚠️ 语音条验收依赖启动无头 Edge 时带 `--use-fake-device-for-media-stream`
 *    `--use-fake-ui-for-media-stream`（假麦克风）。缺了这两个开关，
 *    `getUserMedia` 拿不到流，录音相关的断言会全线失败 —— 那是环境问题，不是功能坏了。
 *
 * 前置（四件都得起着；agent-browser 在本沙箱会被 SIGTERM 拦，所以直接用 CDP 裸驱动）：
 *   server/ : node node_modules/tsx/dist/cli.mjs src/providers/mock-openai.ts   → :3334
 *   server/ : node node_modules/tsx/dist/cli.mjs src/index.ts                   → :3100（.env 指向 mock 上游）
 *   web/    : HABITAT_API_TARGET=http://127.0.0.1:3100 node node_modules/vite/bin/vite.js --port 5174
 *   任意    : msedge --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录>
 *
 * ⚠️ 后台进程在同一命令结束后会被回收，所以启动与执行要写在同一条命令里。
 * 用法：node web/scripts/verify-chat.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
/** mock 上游地址：撤回 / 编辑的「到底送了什么」要读它的调试钩子 */
const MOCK = process.env.VERIFY_MOCK ?? 'http://127.0.0.1:3334'
/**
 * 输入框一律显式指定 `[data-testid="composer"]`。
 * ⚠️ **别再用 `document.querySelector('textarea')`** —— 消息内联编辑态会在 DOM **更靠前**的位置
 * 放一个 textarea，裸选第一个会把字打进编辑框里，然后一路假失败。
 */
const COMPOSER = `document.querySelector('[data-testid="composer"]')`
/** 截图落在 .workbuddy/（已被 .gitignore 忽略），仅供人工核对视觉 */
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
    const text = msg.params.args
      .map((a) => a.value ?? a.description ?? '')
      .join(' ')
    consoleLogs.push(`[${msg.params.type}] ${text}`)
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
    throw new Error(
      `${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`,
    )
  }
  return res.result.value
}

async function shot(name) {
  const data = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(data.data, 'base64'))
}

/** 页面内轮询等待条件成立（vite 冷启动 + React 水合都需要时间，固定 sleep 不可靠） */
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

/** 像真人一样输入：聚焦后走 CDP 的 insertText，React 受控组件一定收得到 */
async function type(text) {
  await waitFor(`${COMPOSER} !== null`, '输入框出现')
  await evaluate(`(() => { ${COMPOSER}.focus(); return 'ok' })()`)
  await sleep(200)
  await send('Input.insertText', { text })
  await sleep(450)
}

async function sendButtonState() {
  return evaluate(`(() => {
    // 换装第 3 批后主按钮是**圆形图标按钮**（没有文字），所以按 data-testid 定位，
    // 不再按文案找 —— 按文案的写法在图标化之后会直接落空
    const btn = document.querySelector('[data-testid="send"]')
    const ta = ${COMPOSER}
    return { found: btn !== null, disabled: btn ? btn.disabled : null, draft: ta ? ta.value : null }
  })()`)
}

/** 读 mock 上游记下的最近一次 chat 请求体 —— 「客户端到底送了什么」的唯一硬证据 */
async function lastUpstreamBody() {
  const res = await fetch(`${MOCK}/__last-body`)
  if (!res.ok) throw new Error(`读 mock 报文失败：HTTP ${res.status}`)
  return res.json()
}

/** 点「发送」按钮（到处都要用，收一处）。主按钮已图标化，按 testid 定位 */
async function clickSend() {
  return evaluate(`(() => {
    const btn = document.querySelector('[data-testid="send"]')
    if (btn === null) return 'missing'
    btn.click()
    return 'ok'
  })()`)
}

/** reload 之后旧 DOM 还在，直接轮询会被它骗过 —— 先等新文档进入，再等条件 */
async function reloadAndWait(expression, label, timeout = 25000) {
  await send('Page.reload')
  await sleep(2000)
  await waitFor(expression, label, timeout)
}

/** 消息已定性的状态：中止保留了半截内容是合法收尾，不该被当成「还没完」 */
const TERMINAL_STATUSES = new Set(['done', 'error', 'aborted'])

/**
 * 直接读 IndexedDB 里的消息，而不是数 DOM。
 * 渲染层是虚拟列表（只渲染可视区），而且「只发送」的关键证据恰恰是**没渲染出来的回复** ——
 * 数 DOM 等于用一个会漏数的尺子去量「有没有多出一条」。
 */
const readMessages = (sessionId) =>
  evaluate(`(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('habitat-db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const store = db.transaction('messages').objectStore('messages')
    const rows = await new Promise((res, rej) => {
      const r = store.index('sessionId').getAll(${JSON.stringify(sessionId)})
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    db.close()
    return rows.sort((a, b) => a.createdAt - b.createdAt)
  })()`)

/**
 * 等这一轮真正收尾。
 *
 * ⚠️ **不要再用「页面上有没有一个文案是『发送』的按钮」当判据** —— 那个按钮**一直都在**，
 * 只是输入框为空时 disabled。所以那个条件在手指刚点下去、生成还没启动的一瞬间就成立，
 * 等于没等。本脚本此前就是那么写的，8 处调用其实都在抢跑，只是恰好被后面的显式等待兜住了；
 * 一旦后面紧跟的断言也读库，就会直接读到一个还没开始生成的瞬间。
 *
 * 真判据只有一个：**库里最后一条消息是 `assistant` 且已定性**（不再是 `streaming` / `pending`）。
 * 这条判据同时能覆盖「换一个」——它改的是已存在的 assistant 消息，不会新增一条。
 */
async function waitIdle(label, timeout = 30000) {
  const sessionId = await evaluate(`location.pathname.split('/').pop() ?? ''`)
  if (sessionId === '') throw new Error(`waitIdle：当前不在会话窗口里（${label}）`)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const rows = await readMessages(sessionId)
    const last = rows[rows.length - 1]
    if (last !== undefined && last.role === 'assistant' && TERMINAL_STATUSES.has(last.status)) return
    await sleep(200)
  }
  throw new Error(`等待超时：${label}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: `${APP}/chat` })
await waitFor(
  `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('新建'))`,
  '聊天列表就绪',
  30000,
)

/* ---------- 1. 新建会话 ---------- */
const created = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建'))
  if (!btn) return 'missing'
  btn.click()
  return 'ok'
})()`)
await waitFor(`location.pathname.startsWith('/chat/')`, '进入会话窗口')
const pathAfter = await evaluate('location.pathname')
check('新建会话并跳转', created === 'ok' && /^\/chat\/[^/]+$/.test(pathAfter), pathAfter)

/* ---------- 2. 发送 ---------- */
await type('你好，报到一下')
const firstState = await sendButtonState()
check('输入后发送按钮可用', firstState.disabled === false, JSON.stringify(firstState))
await clickSend()

/* ---------- 3. 流式中途截图（抓光标与「停止」按钮） ---------- */
await sleep(400)
const midText = await evaluate('document.body.innerText')
const midHasStop = await evaluate(
  `document.querySelector('[data-testid="composer-abort"]') !== null`,
)
await shot('shot-chat-streaming.png')
check(
  '发送中显示「停止」按钮 + 流式光标',
  midHasStop && (midText.includes('…') || midText.includes('▍')),
  '',
)

/* ---------- 4. 等待流式完成 ---------- */
const finalText = await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (document.body.innerText.includes('链路正常')) return document.body.innerText
    await new Promise((r) => setTimeout(r, 200))
  }
  return document.body.innerText
})()`)
check('流式回复完整落地', finalText.includes('收到，这是来自 mock 上游的 流式回复。'), '')
check('首条消息自动命名会话', !finalText.includes('新的对话'), '')
await waitIdle('第一轮收尾')

/* ---------- 5. 中止 ---------- */
await type('这条我会中途掐掉')
const secondState = await sendButtonState()
check('第二轮输入后按钮可用', secondState.disabled === false, JSON.stringify(secondState))
await clickSend()
// 「中止」要验证的是**保留已收内容**，掐得太早正文还是空的就什么也验不到，
// 所以先等到流式气泡里出现正文再掐
const gotPartial = await evaluate(`(async () => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const caret = document.querySelector('.animate-pulse')
    const bubble = caret ? caret.parentElement : null
    if (bubble) {
      // 去掉流式光标与「还没正文」的省略号占位，只有真出现正文才算数
      const text = (bubble.textContent ?? '').replace(/[▍…]/g, '').trim()
      if (text !== '') return text
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
})()`)
check(
  '中止前只收到部分正文',
  typeof gotPartial === 'string' && !gotPartial.includes('链路正常'),
  String(gotPartial).replace(/\n/g, '⏎'),
)
const stopClicked = await evaluate(`(() => {
  const btn = document.querySelector('[data-testid="composer-abort"]')
  if (btn === null) return 'missing'
  btn.click()
  return 'ok'
})()`)
await sleep(1800)
const abortedText = await evaluate('document.body.innerText')
check(
  '中止生效且保留已收内容',
  stopClicked === 'ok' && abortedText.includes('（已停止）'),
  `stop=${stopClicked}`,
)

await shot('shot-chat-window.png')

/* ---------- 6. 刷新持久化 ---------- */
await reloadAndWait(`document.body.innerText.includes('链路正常')`, '刷新后消息回填')
const reloadedText = await evaluate('document.body.innerText')
check('刷新后消息仍在（Dexie 落库）', reloadedText.includes('链路正常'), '')

/* ---------- 7. IndexedDB 版本与索引 ---------- */
// Dexie 把声明的版本号 ×10 当作 IndexedDB 版本（v1→10 / v2→20 / v3→30）。
// 这里不只比版本号：光看版本号分不出「升到了 v3」和「v3 的 stores 写错了」，
// 所以顺带把 v3 引入的三元复合索引取出来验一眼。
const dbInfo = await evaluate(`(async () => {
  const list = await indexedDB.databases()
  const target = list.find((d) => d.name === 'habitat-db')
  if (!target) return JSON.stringify({ version: null, stores: [], indexes: [], sessionIndexes: [] })
  const read = await new Promise((res) => {
    const req = indexedDB.open('habitat-db')
    req.onsuccess = () => {
      const db = req.result
      try {
        const widgetStore = db.transaction('homeWidgets').objectStore('homeWidgets')
        res({
          stores: Array.from(db.objectStoreNames),
          indexes: Array.from(db.transaction('messages').objectStore('messages').indexNames),
          sessionIndexes: Array.from(db.transaction('sessions').objectStore('sessions').indexNames),
          // ⚠️ kind 上的 & 前缀（唯一索引）到底生效没有，只能从 index 对象上读 ——
          //    光看索引名 / 数索引个数都分不出来，而这条唯一性正是「每种 Widget 至多一张」的保证所在（SPEC §1.4）
          //    （注意本段整体是一个模板字符串：**注释里也不能出现反引号**，否则模板会在这里被提前闭合）
          widgetKindUnique: widgetStore.index('kind').unique,
        })
      } finally {
        db.close()
      }
    }
    req.onerror = () => res({ stores: [], indexes: [], sessionIndexes: [], widgetKindUnique: false })
  })
  return JSON.stringify({ version: target.version ?? null, ...read })
})()`)
const dbState = JSON.parse(dbInfo)
// ⚠️ 只比「升到了 v9」分不出「v9 的 stores 写错了」，所以顺带验这次迁移该带来的东西
check('Dexie 已升到 v13（IndexedDB 版本 130；v13 = AI 伴学卡片）', dbState.version === 130, dbInfo)
check(
  'v3 的三元复合索引已建出',
  Array.isArray(dbState.indexes) && dbState.indexes.includes('[sessionId+createdAt+id]'),
  JSON.stringify(dbState.indexes),
)
check(
  'v8 带来 sessions.groupId 索引与 sessionGroups 表',
  Array.isArray(dbState.sessionIndexes) &&
    dbState.sessionIndexes.includes('groupId') &&
    Array.isArray(dbState.stores) &&
    dbState.stores.includes('sessionGroups'),
  JSON.stringify({ stores: dbState.stores, sessionIndexes: dbState.sessionIndexes }),
)
check(
  'v9 带来 homeWidgets 表，且 kind 是唯一索引',
  Array.isArray(dbState.stores) && dbState.stores.includes('homeWidgets') && dbState.widgetKindUnique === true,
  JSON.stringify({ stores: dbState.stores, widgetKindUnique: dbState.widgetKindUnique }),
)

/* ---------- 8. 虚拟列表：注入 200 条后只看可见区 ---------- */
const seeded = await evaluate(`(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('habitat-db')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const db = await open()
  const sessionId = location.pathname.split('/').pop()
  const now = Date.now()
  const tx = db.transaction('messages', 'readwrite')
  const store = tx.objectStore('messages')
  for (let i = 0; i < 200; i += 1) {
    store.put({
      id: 'load-' + i, type: 'chat-message', sessionId,
      role: i % 2 === 0 ? 'user' : 'assistant', status: 'done', replyToId: null,
      blocks: [{ kind: 'text', payload: { text: '压力测试 #' + i + ' ' + '填充内容。'.repeat((i % 6) + 1) }, order: 0 }],
      versionOf: null, candidates: [], recalledAt: null, editedAt: null,
      createdAt: now + i * 10, updatedAt: now + i * 10,
    })
  }
  await new Promise((res, rej) => { tx.oncomplete = () => res('ok'); tx.onerror = () => rej(tx.error) })
  db.close()
  return 'ok'
})()`)
await reloadAndWait(`document.body.innerText.includes('压力测试 #')`, '压力数据回填')
await sleep(800)
const stress = await evaluate(`(() => {
  const text = document.body.innerText
  const scroller = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 100)
  return {
    rendered: (text.match(/压力测试 #/g) ?? []).length,
    hasLast: text.includes('压力测试 #199'),
    scrollHeight: scroller ? scroller.scrollHeight : 0,
    clientHeight: scroller ? scroller.clientHeight : 0,
  }
})()`)
check(
  '虚拟列表只渲染可见部分',
  seeded === 'ok' && stress.rendered > 0 && stress.rendered < 40,
  `渲染 ${stress.rendered} 条（已加载 60 条中）`,
)
check('贴底可见最新一条', stress.hasLast, `scrollHeight=${stress.scrollHeight}`)
await shot('shot-chat-stress.png')

/** 造一条与 `ChatMessage` 字段对齐的消息（直接写库用） */
let seedSeq = 0
function seedMessage(id, role, blocks, extra = {}) {
  seedSeq += 1
  const base = Date.now() + seedSeq
  return {
    id,
    role,
    status: 'done',
    replyToId: null,
    blocks,
    versionOf: null,
    candidates: [],
    recalledAt: null,
    editedAt: null,
    createdAt: base,
    updatedAt: base,
    ...extra,
  }
}

/** 直接往某个会话写消息（绕过 UI 构造边界数据；会话 id 由调用方先取好） */
async function seedMessages(sessionId, items) {
  return evaluate(`(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('habitat-db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const db = await open()
    const tx = db.transaction('messages', 'readwrite')
    const store = tx.objectStore('messages')
    for (const m of ${JSON.stringify(items)}) {
      store.put(Object.assign({ type: 'chat-message' }, m, { sessionId: ${JSON.stringify(sessionId)} }))
    }
    await new Promise((res, rej) => { tx.oncomplete = () => res('ok'); tx.onerror = () => rej(tx.error) })
    db.close()
    return 'ok'
  })()`)
}

/** 写入可控会话，专门验排序与设置，不受前面真实对话时间影响。 */
async function seedSessions(items) {
  return evaluate(`(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('habitat-db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const tx = db.transaction('sessions', 'readwrite')
    const store = tx.objectStore('sessions')
    for (const item of ${JSON.stringify(items)}) store.put(item)
    await new Promise((res, rej) => { tx.oncomplete = () => res('ok'); tx.onerror = () => rej(tx.error) })
    db.close()
    return 'ok'
  })()`)
}

/** 回聊天列表再新建一个干净会话，返回新会话 id */
async function newSession(label) {
  const previous = await evaluate('location.pathname')
  await evaluate(
    `(() => { window.history.pushState({}, '', '/chat'); window.dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`,
  )
  await waitFor(`document.body.innerText.includes('新建')`, `${label}：回到列表`, 20000)
  await evaluate(
    `(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建')).click(); return 'ok' })()`,
  )
  await waitFor(
    `location.pathname.startsWith('/chat/') && location.pathname !== ${JSON.stringify(previous)}`,
    `${label}：新建会话`,
    20000,
  )
  return evaluate(`location.pathname.split('/').pop()`)
}

/** 找到消息滚动容器（虚拟列表那一层） */
const SCROLLER = `[...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 100)`

/* ---------- 9. 消息块按 kind 分发 ---------- */
// 拉高视口让十来条块消息一次全渲染出来（虚拟列表只渲染可视区，默认 600px 高会漏断言）
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 2400,
  deviceScaleFactor: 1,
  mobile: false,
})
const sessionBlocks = await newSession('块分发')
await seedMessages(sessionBlocks, [
  seedMessage('blk-order', 'assistant', [
    { kind: 'text', order: 1, payload: { text: '区块顺序-后半段' } },
    { kind: 'text', order: 0, payload: { text: '区块顺序-前半段' } },
  ]),
  seedMessage('blk-image', 'assistant', [
    {
      kind: 'image',
      order: 0,
      payload: {
        // 1×1 透明 gif，只为验证 <img> 被真渲染出来
        url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        alt: '示例图',
      },
    },
  ]),
  seedMessage('blk-audio', 'assistant', [
    {
      kind: 'audio',
      order: 0,
      // 空头 WAV（合法但没数据），只为验证 <audio> 被真渲染出来
      payload: {
        url: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
        transcript: '语音转写示例',
      },
    },
  ]),
  seedMessage('blk-file', 'assistant', [
    { kind: 'file', order: 0, payload: { url: 'blob:demo', name: '报告.pdf', size: 2048 } },
  ]),
  seedMessage('blk-tool', 'assistant', [
    {
      kind: 'tool-result',
      order: 0,
      payload: { toolName: 'mcp__demo__echo', ok: true, summary: '12ms', result: { echo: 'hi' } },
    },
  ]),
  seedMessage('blk-html', 'assistant', [
    { kind: 'html', order: 0, payload: { html: '<b>不该被直接注入</b><script>1</script>' } },
  ]),
  seedMessage('blk-widget', 'assistant', [
    { kind: 'widget', order: 0, payload: { title: '天气' } },
  ]),
  seedMessage('blk-tabgroup', 'assistant', [
    { kind: 'tab-group', order: 0, payload: { tabs: [{ label: '甲', blocks: [] }] } },
  ]),
  seedMessage('blk-unknown', 'assistant', [{ kind: 'hologram', order: 0, payload: { x: 1 } }]),
])
await reloadAndWait(`document.body.innerText.includes('区块顺序-前半段')`, '块消息回填')
await sleep(600)

const blocksText = await evaluate('document.body.innerText')
const blockDom = await evaluate(`JSON.stringify({
  image: document.querySelectorAll('img[alt="示例图"]').length,
  audio: document.querySelectorAll('audio').length,
  tool: document.querySelectorAll('details').length,
  rawBold: document.querySelectorAll('b').length,
  htmlFrame: (() => { const frame = document.querySelector('iframe[title="富内容预览"]'); return frame === null ? null : { sandbox: frame.getAttribute('sandbox'), srcdoc: frame.getAttribute('srcdoc') } })(),
  pre: [...document.querySelectorAll('pre')].map((p) => p.textContent).join('|'),
})`)
const dom = JSON.parse(blockDom)

check(
  'text 块按 order 升序渲染',
  blocksText.indexOf('区块顺序-前半段') >= 0 &&
    blocksText.indexOf('区块顺序-前半段') < blocksText.indexOf('区块顺序-后半段'),
  '',
)
check('image 块渲染成 <img>', dom.image === 1, `img=${String(dom.image)}`)
check('audio 块渲染成 <audio> + 转写', dom.audio === 1 && blocksText.includes('语音转写示例'), '')
check(
  'file 块给出文件名与体积',
  blocksText.includes('报告.pdf') && blocksText.includes('2.0 KB'),
  '',
)
check(
  'tool-result 块折叠展示工具名与结果',
  dom.tool === 1 && blocksText.includes('工具 mcp__demo__echo') && dom.pre.includes('"echo": "hi"'),
  '',
)
check(
  'html 块进入无权限 + CSP iframe，不注入主文档',
  dom.htmlFrame?.sandbox === '' && dom.htmlFrame.srcdoc.includes("default-src 'none'") && dom.rawBold === 0,
  JSON.stringify(dom.htmlFrame),
)
check(
  'widget / tab-group 已按协议渲染',
  blocksText.includes('天气') && blocksText.includes('甲'),
  '',
)
check(
  '未知 kind 降级占位而不是崩页',
  blocksText.includes('[hologram] 暂不支持渲染') && blocksText.includes('区块顺序-前半段'),
  '',
)
await shot('shot-chat-blocks.png')
await send('Emulation.clearDeviceMetricsOverride')

/* ---------- 10. 分页加载更早一页 ---------- */
const sessionPage = await newSession('分页')
const history = []
for (let i = 0; i < 130; i += 1) {
  history.push(
    seedMessage(`hist-${String(i).padStart(3, '0')}`, i % 2 === 0 ? 'user' : 'assistant', [
      { kind: 'text', order: 0, payload: { text: `历史 #${String(i).padStart(3, '0')}` } },
    ]),
  )
}
await seedMessages(sessionPage, history)
await reloadAndWait(`document.body.innerText.includes('历史 #129')`, '分页数据回填')
await sleep(800)

const top = () => evaluate(`${SCROLLER}.scrollTop = 0; 'ok'`)
const geom = () =>
  evaluate(`(() => {
    const el = ${SCROLLER}
    return { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, text: document.body.innerText }
  })()`)

const page0 = await geom()
// 上限按行高校准：换皮（第 3 批）后每条消息自带上下 padding，实测行高 ~97px，
// 一页 60 条 ≈ 5800px（旧皮肤 64px 时代上限是 5200）。两页会到 11500+，7500 依然分得开。
check(
  '首屏只加载一页（最旧的 #069 未进来）',
  page0.scrollHeight > 3000 && page0.scrollHeight < 7500 && !page0.text.includes('历史 #069'),
  `scrollHeight=${page0.scrollHeight}`,
)

// 滚到顶 → 自动加载更早一页；加载完位置应被锚点补偿顶下去（否则用户被弹走）
await top()
await sleep(1200)
const page1 = await geom()
check(
  '滚到顶自动加载更早一页',
  page1.scrollHeight > page0.scrollHeight * 1.5,
  `${page0.scrollHeight} → ${page1.scrollHeight}`,
)
check(
  '向上插入后滚动位置被锚定（没被弹到顶）',
  page1.scrollTop > 1000,
  `scrollTop=${page1.scrollTop}`,
)

await top()
await sleep(1200)
const page2 = await geom()
check('再滚到顶加载完剩余一页', page2.scrollHeight > page1.scrollHeight, `${page1.scrollHeight} → ${page2.scrollHeight}`)

await top()
await sleep(1200)
const page3 = await geom()
// 高度别拿等号比：先前按估值占位的项被实测后会微调总高，容差留给这个漂移；
// 但真要又插进一页（60 条 ≈ +3000px）就远超容差，断言依然有效。
// ⚠️ 别再拿「#009 也得在 innerText 里」当子句：虚拟列表只渲染
// 「scrollTop ± overscan」的窗口，#009 渲不渲染取决于 视口高 + 6×行高 的算术，
// 换皮后行高 64→96，263px 的滚动窗刚好盖不到它 —— 以前过纯属压线。
// 「加载到最早」的可靠判据是：总高稳定 + scrollTop=0 时第 0 项（#000）一定在渲染窗口里。
check(
  '到底后不再重复加载（已到最早）',
  page3.scrollHeight < page2.scrollHeight * 1.15 && page3.text.includes('历史 #000'),
  `${page2.scrollHeight} → ${page3.scrollHeight} / #000=${page3.text.includes('历史 #000')} scrollTop=${page3.scrollTop}`,
)
check('加载提示已收起', !page3.text.includes('正在加载更早的消息'))
await shot('shot-chat-paging.png')

/* ---------- 11. 换一个 / 重发 ---------- */
const sessionReroll = await newSession('换一个')
await type('换一个测试')
await clickSend()
await waitFor(`document.body.innerText.includes('流式回复')`, '首轮回复落地', 25000)
await waitIdle('首轮收尾')
const firstReply = await evaluate('document.body.innerText')
check('首轮回复没有版本导航（只有一版）', !firstReply.includes('1/1'), '')

await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '换一个')
  if (!btn) return 'missing'
  btn.click()
  return 'ok'
})()`)
await waitFor(`document.body.innerText.includes('2/2')`, '版本导航出现', 25000)
await waitIdle('换一个收尾')
const rerolled = await evaluate('document.body.innerText')
check('换一个后记下两个版本（2/2）', rerolled.includes('2/2'), '')
check('换一个后的正文是完整回复', rerolled.includes('收到，这是来自 mock 上游的 流式回复。'), '')
await shot('shot-chat-reroll.png')

await evaluate(`(() => {
  // 换装后版本切换是图标按钮（原来的 ‹ / › 文字没了），按 testid 前缀找
  const btn = document.querySelector('[data-testid^="version-prev-"]')
  if (!btn) return 'missing'
  btn.click()
  return 'ok'
})()`)
await waitFor(`document.body.innerText.includes('1/2')`, '切回上一版', 10000)
check('可以切回上一版（1/2）', true, '')
await reloadAndWait(`document.body.innerText.includes('1/2')`, '版本选择刷新后保持')
check('版本历史刷新后仍在', true, '')

// 重发：注入一条「问了但没得到回复」的用户消息（末条）
await seedMessages(sessionReroll, [
  seedMessage('resend-case', 'user', [
    { kind: 'text', order: 0, payload: { text: '这条没得到回复' } },
  ]),
])
await reloadAndWait(`document.body.innerText.includes('这条没得到回复')`, '未回复消息回填')
const hasResend = await evaluate(
  `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '重发')`,
)
check('末条用户消息无回复时给出「重发」出口', hasResend, '')
// 「流式回复」这几个字在上一轮就已存在，所以不能只等它出现 —— 数条数才能证明真的又跑了一轮
const REPLY_COUNT = `(document.body.innerText.match(/流式回复/g) ?? []).length`
const repliesBefore = await evaluate(REPLY_COUNT)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '重发')
  if (btn) btn.click()
  return 'ok'
})()`)
await waitFor(`${REPLY_COUNT} > ${repliesBefore}`, '重发拿到新回复', 25000)
await waitIdle('重发收尾')
const resent = await evaluate('document.body.innerText')
const repliesAfter = await evaluate(REPLY_COUNT)
check('重发后新增一条回复', repliesAfter === repliesBefore + 1, `${repliesBefore} → ${repliesAfter}`)
check(
  '重发完成后「重发」让位给「换一个」',
  !resent.includes('重发') && resent.includes('换一个'),
  '',
)

/* ---------- 12. 消息对象操作（SPEC §2.3） ---------- */

// 拉高视口：这一步要在同一条会话里比对多轮消息，虚拟列表默认只渲染可视区
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 1600,
  deviceScaleFactor: 1,
  mobile: false,
})

/** 按 `data-message-id` 精确定位一条消息的根节点 */
const BY_ID = (id) => `document.querySelector('[data-message-id="${id}"]')`
/**
 * 按气泡内文定位。⚠️ 只用于 UI 现场产生的消息（那时拿不到 id），且正文必须够独特 ——
 * `includes` 是子串匹配，'甲' 会同时命中 '甲和乙'。
 */
const BY_TEXT = (text) =>
  `[...document.querySelectorAll('[data-message-id]')].find((el) => (el.innerText ?? '').includes(${JSON.stringify(text)}))`
/**
 * 气泡本体（挂指针 / 右键处理的那一层）。
 * ⚠️ 事件必须派发到它身上：事件只会**往上冒**，派发在根节点上不会「往下」触发气泡的处理函数。
 */
const BUBBLE_OF = (rootExpr) => `${rootExpr}?.querySelector('.msg-bubble')`
/** 菜单项的 testid 白名单（`action-sheet` 与遮罩也以 action- 开头，得排掉） */
const MENU_ITEMS = `[...document.querySelectorAll('[data-testid]')]
  .filter((el) => /^action-(copy|edit|bookmark|artwork|album|multi|reroll|resend|regenerate|recall|restore|delete)$/.test(el.dataset.testid))
  .map((el) => el.innerText)`

/** 右键气泡 → 等菜单出来。比长按稳定（不受计时器抖动影响），但走的是同一套回调 */
async function openMenuAt(rootExpr, label) {
  const fired = await evaluate(`(() => {
    const bubble = ${BUBBLE_OF(rootExpr)}
    if (!bubble) return 'missing'
    bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    return 'ok'
  })()`)
  if (fired !== 'ok') throw new Error(`找不到气泡：${label}`)
  await waitFor(`document.querySelector('[data-testid="action-sheet"]') !== null`, `菜单打开：${label}`)
}

async function menuAction(id) {
  const clicked = await evaluate(`(() => {
    const btn = document.querySelector('[data-testid="action-${id}"]')
    if (!btn) return 'missing'
    btn.click()
    return 'ok'
  })()`)
  if (clicked !== 'ok') throw new Error(`菜单项不存在：${id}`)
  await sleep(250)
}

/** 点二次确认的「确认」，把确认语回传出来供断言 */
async function clickConfirm() {
  await waitFor(`document.querySelector('[data-testid="confirm-yes"]') !== null`, '二次确认条出现')
  const text = await evaluate(`document.querySelector('[data-testid="confirm-text"]').innerText`)
  await evaluate(`(() => { document.querySelector('[data-testid="confirm-yes"]').click(); return 'ok' })()`)
  await sleep(400)
  return text
}

/** 写入受控 textarea：必须走原生 setter + input 事件，直接赋值 React 收不到 */
/** 写入受控表单控件（input / textarea）：必须走原生 setter + input 事件，直接赋值 React 收不到 */
async function setField(selector, text) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'missing'
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value
  })()`)
}

const sessionOps = await newSession('对象操作')

/* 12.1 先造两条真消息（走真实发送链路，才能验到「编辑后上下文里是什么」） */
await type('第一句话')
await clickSend()
await waitFor(`document.body.innerText.includes('流式回复')`, '第一轮回复落地', 25000)
await waitIdle('第一轮收尾')

/* 12.2 长按打开菜单 —— 移动端主路径，不能只验右键 */
const longPress = await evaluate(`(async () => {
  const bubble = ${BUBBLE_OF(BY_TEXT('第一句话'))}
  if (!bubble) return 'missing'
  const r = bubble.getBoundingClientRect()
  bubble.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 8, clientY: r.top + 8 }),
  )
  await new Promise((res) => setTimeout(res, 900))
  return document.querySelector('[data-testid="action-sheet"]') !== null ? 'open' : 'closed'
})()`)
check('长按气泡打开消息菜单（移动端路径）', longPress === 'open', String(longPress))

const menuLabels = JSON.parse(await evaluate(`JSON.stringify(${MENU_ITEMS})`))
check(
  '菜单项随对象状态生成（非末条用户消息）',
  ['复制', '编辑', '收藏', '收录至作品', '多选', '从这条重新生成', '撤回', '删除'].every((label) =>
    menuLabels.includes(label),
  ) &&
    !menuLabels.includes('加入相册') &&
    !menuLabels.includes('重发') &&
    !menuLabels.includes('换一个'),
  menuLabels.join(' / '),
)
await evaluate(
  `(() => { document.querySelector('[data-testid="action-sheet-backdrop"]').click(); return 'ok' })()`,
)
await sleep(250)

/* 12.3 编辑：保留原版本、可切回、不改后续（SPEC §2.3.4） */
await openMenuAt(BY_TEXT('第一句话'), '第一句话')
await menuAction('edit')
await waitFor(`document.querySelector('[data-testid="edit-textarea"]') !== null`, '进入内联编辑')
const prefill = await evaluate(`document.querySelector('[data-testid="edit-textarea"]').value`)
check('编辑框预填当前正文', prefill === '第一句话', String(prefill))

await setField('[data-testid="edit-textarea"]', '第一句话（改过）')
await evaluate(`(() => { document.querySelector('[data-testid="edit-save"]').click(); return 'ok' })()`)
await waitFor(`document.body.innerText.includes('第一句话（改过）')`, '编辑后正文更新')

const editedState = await evaluate(`(() => {
  const text = document.body.innerText
  return {
    twoVersions: text.includes('2/2'),
    mark: text.includes('已编辑'),
    followed: text.includes('流式回复'),
  }
})()`)
check('编辑后版本链变 2 条（原版本被保留）', editedState.twoVersions, JSON.stringify(editedState))
check('编辑过的消息带可辨识标记', editedState.mark, '')
check('编辑不改动后续对话（后续回复仍在）', editedState.followed, '')

// 切回上一版：「原版本真的还在」的直接证据 —— 只看到 `2/2` 三个字说明不了这一点
await evaluate(
  `(() => { document.querySelector('[data-testid^="version-prev-"]').click(); return 'ok' })()`,
)
await waitFor(`document.body.innerText.includes('1/2')`, '切回编辑前的版本')
const backToOld = await evaluate(`document.body.innerText.includes('第一句话（改过）')`)
check('可切回编辑前的原版本', backToOld === false, `改后文本仍可见=${String(backToOld)}`)
await evaluate(
  `(() => { document.querySelector('[data-testid^="version-next-"]').click(); return 'ok' })()`,
)
await waitFor(`document.body.innerText.includes('第一句话（改过）')`, '切回编辑后的版本')

/* 12.4 撤回：留痕、不进上下文、可恢复（SPEC §2.3.5） */
await type('这句会被撤回')
const replyCountBeforeRecall = await evaluate(`(document.body.innerText.match(/流式回复/g) ?? []).length`)
await clickSend()
await waitFor(
  `(document.body.innerText.match(/流式回复/g) ?? []).length > ${replyCountBeforeRecall}`,
  '撤回目标那一轮拿到回复',
  25000,
)
await waitIdle('撤回轮收尾')

await openMenuAt(BY_TEXT('这句会被撤回'), '这句会被撤回')
await menuAction('recall')
const recallConfirm = await clickConfirm()
check(
  '撤回需二次确认且说明「不再进上下文」',
  recallConfirm.includes('撤回') && recallConfirm.includes('上下文'),
  recallConfirm,
)
await waitFor(`document.querySelector('[data-testid="recalled"]') !== null`, '撤回痕迹出现')
const recalledState = await evaluate(`(() => {
  const mark = document.querySelector('[data-testid="recalled"]')
  return {
    mark: mark ? mark.innerText : null,
    originalVisible: document.body.innerText.includes('这句会被撤回'),
  }
})()`)
check(
  '撤回留下「曾存在」痕迹且原文不再显示',
  recalledState.mark !== null &&
    recalledState.mark.includes('你撤回了一条消息') &&
    recalledState.originalVisible === false,
  JSON.stringify(recalledState),
)

/* 12.5 撤回不进模型上下文 —— 读 mock 上游的真实报文，这是该语义唯一的硬证据 */
await type('撤回之后的新问题')
const replyCountBeforeAsk = await evaluate(`(document.body.innerText.match(/流式回复/g) ?? []).length`)
await clickSend()
/**
 * 这里保留一条显式的「这一轮回复已落地」等待，而不是直接 `waitIdle`。
 * 理由是不抢跑：`waitIdle` 现在读的是库、已经可靠，但**它只保证「库里最后一条 assistant 已定性」**，
 * 而这条断言要读 mock 的 `__last-body` —— 必须确保这一轮真的发出去了。
 * 曾经的坑是判据写成「页面上有没有『发送』按钮」，那个条件在手指刚点下时就成立（按钮一直都在），
 * 于是紧接着读到的报文是**上一轮**的，上一轮里那句话当然还在，断言就成了假通过。
 */
await waitFor(
  `(document.body.innerText.match(/流式回复/g) ?? []).length > ${replyCountBeforeAsk}`,
  '撤回后新一轮拿到回复',
  25000,
)
await waitIdle('撤回后新一轮收尾')
const upstream = await lastUpstreamBody()
const sentHistory = JSON.stringify(upstream.body?.messages ?? [])
check('撤回的消息不进模型上下文（读 mock 真实报文）', !sentHistory.includes('这句会被撤回'), sentHistory.slice(0, 200))
check('编辑后的正文反而进了上下文', sentHistory.includes('第一句话（改过）'), '')
check('撤回不牵连其他历史', sentHistory.includes('撤回之后的新问题'), '')

/* 12.6 撤回可恢复（撤回不是销毁） */
await openMenuAt(BY_TEXT('撤回了一条消息'), '撤回态消息')
const recalledMenu = JSON.parse(await evaluate(`JSON.stringify(${MENU_ITEMS})`))
check(
  '撤回态菜单只剩「恢复」与「删除」',
  recalledMenu.join(' / ') === '恢复这条消息 / 删除',
  recalledMenu.join(' / '),
)
await menuAction('restore')
await waitFor(`document.body.innerText.includes('这句会被撤回')`, '恢复后正文回来')
const restoredState = await evaluate(`(() => ({
  originalVisible: document.body.innerText.includes('这句会被撤回'),
  markGone: document.querySelector('[data-testid="recalled"]') === null,
}))()`)
check(
  '撤回可恢复（原文回来、痕迹消失）',
  restoredState.originalVisible && restoredState.markGone,
  JSON.stringify(restoredState),
)

/* 12.7 删除 / 多选 / 复制 —— 用直接写库的消息，id 可控，定位不靠子串匹配 */
await seedMessages(sessionOps, [
  seedMessage('ops-del', 'assistant', [
    { kind: 'text', order: 0, payload: { text: '待删除的消息甲' } },
  ]),
  seedMessage('ops-del2', 'user', [
    { kind: 'text', order: 0, payload: { text: '待删除的消息乙' } },
  ]),
  seedMessage('ops-copy', 'assistant', [
    { kind: 'text', order: 0, payload: { text: '待复制的消息丙' } },
  ]),
])
await reloadAndWait(`document.body.innerText.includes('待复制的消息丙')`, '待操作消息回填')

// 复制：剪贴板写入在无头环境需要显式授权 + 焦点模拟，否则 Chromium 直接拒
await send('Page.bringToFront').catch(() => undefined)
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
await send('Browser.grantPermissions', {
  origin: APP,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
}).catch(() => undefined)
await openMenuAt(BY_ID('ops-copy'), 'ops-copy')
await menuAction('copy')
await waitFor(`document.body.innerText.includes('已复制')`, '复制反馈')
const clip = await evaluate(`(async () => {
  try {
    return { ok: true, text: await navigator.clipboard.readText() }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`)
check(
  '复制写入系统剪贴板且有明确反馈',
  clip.ok === true && clip.text === '待复制的消息丙',
  JSON.stringify(clip),
)

// 删除：物理删除 + 二次确认
await openMenuAt(BY_ID('ops-del'), 'ops-del')
await menuAction('delete')
const deleteConfirm = await clickConfirm()
check('删除需二次确认且说明不可恢复', deleteConfirm.includes('不可恢复'), deleteConfirm)
await waitFor(
  `document.body.innerText.includes('待删除的消息甲') === false`,
  '删除生效',
)
check('删除后消息从界面移除', true, '')

// 多选：点气泡勾选 → 批量删除（确认语必须说清条数）
await openMenuAt(BY_ID('ops-del2'), 'ops-del2')
await menuAction('multi')
await waitFor(`document.querySelector('[data-testid="select-bar"]') !== null`, '进入多选模式')
const selectOne = await evaluate(`document.querySelector('[data-testid="select-count"]').innerText`)
check('进入多选时自动选中发起的那条', selectOne.includes('1 项'), selectOne)
const pickedSecond = await evaluate(`(() => {
  const bubble = ${BUBBLE_OF(BY_ID('ops-copy'))}
  if (!bubble) return 'missing'
  bubble.click()
  return 'ok'
})()`)
await waitFor(
  `document.querySelector('[data-testid="select-count"]').innerText.includes('2 项')`,
  '勾选第二条',
)
check('点气泡即可勾选', pickedSecond === 'ok', String(pickedSecond))
await evaluate(
  `(() => { document.querySelector('[data-testid="select-delete"]').click(); return 'ok' })()`,
)
const batchConfirm = await clickConfirm()
check('批量删除的确认语说清条数', batchConfirm.includes('2 条'), batchConfirm)
await waitFor(
  `document.body.innerText.includes('待删除的消息乙') === false &&
   document.body.innerText.includes('待复制的消息丙') === false`,
  '批量删除生效',
)
const selectBarGone = await evaluate(`document.querySelector('[data-testid="select-bar"]') === null`)
check('批量删除后自动退出多选', selectBarGone, '')

/* 12.8 跨模块内容流转：原位收录、来源追溯、按类型出菜单、重复与失败反馈 */
const sessionFlow = await newSession('跨模块内容流转')
const GIF_1PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
await seedMessages(sessionFlow, [
  seedMessage('flow-text', 'assistant', [
    { kind: 'text', order: 0, payload: { text: '值得长期留下的跨模块内容' } },
  ]),
  seedMessage('flow-component', 'assistant', [
    { kind: 'widget', order: 0, payload: { title: '行程卡片', source: 'mock-component' } },
  ]),
  seedMessage('flow-image', 'assistant', [
    { kind: 'text', order: 0, payload: { text: '一张聊天图片' } },
    { kind: 'image', order: 1, payload: { url: GIF_1PX, alt: '一像素纪念照' } },
  ]),
  seedMessage('flow-bad-image', 'assistant', [
    { kind: 'image', order: 0, payload: { url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: '不支持的 SVG' } },
  ]),
])
await reloadAndWait(`document.body.innerText.includes('值得长期留下的跨模块内容')`, '跨模块消息回填')

await openMenuAt(BY_ID('flow-text'), 'flow-text')
const textFlowMenu = JSON.parse(await evaluate(`JSON.stringify(${MENU_ITEMS})`))
check(
  '普通消息显示收藏 / 作品，但不显示加入相册',
  textFlowMenu.includes('收藏') && textFlowMenu.includes('收录至作品') && !textFlowMenu.includes('加入相册'),
  textFlowMenu.join(' / '),
)
await menuAction('bookmark')
await waitFor(`document.body.innerText.includes('已加入收藏')`, '收藏成功反馈')
check('聊天消息可从原位加入收藏', true, '')

await openMenuAt(BY_ID('flow-text'), 'flow-text duplicate bookmark')
await menuAction('bookmark')
await waitFor(`document.body.innerText.includes('这条消息已经收藏过了')`, '重复收藏反馈')
check('重复收藏有明确反馈', true, '')

await openMenuAt(BY_ID('flow-text'), 'flow-text artwork')
await menuAction('artwork')
await waitFor(`document.body.innerText.includes('已收录至作品')`, '作品收录成功反馈')
check('聊天消息可从原位收录至作品', true, '')

await openMenuAt(BY_ID('flow-text'), 'flow-text duplicate artwork')
await menuAction('artwork')
await waitFor(`document.body.innerText.includes('这条消息已经收录到作品了')`, '重复作品反馈')
check('重复收录作品有明确反馈', true, '')

await openMenuAt(BY_ID('flow-component'), 'flow-component')
await menuAction('artwork')
await waitFor(`document.body.innerText.includes('已收录至作品')`, '组件收录成功反馈')
check('组件消息可收录至作品', true, '')

await openMenuAt(BY_ID('flow-image'), 'flow-image')
const imageFlowMenu = JSON.parse(await evaluate(`JSON.stringify(${MENU_ITEMS})`))
check('只有图片消息出现加入相册', imageFlowMenu.includes('加入相册'), imageFlowMenu.join(' / '))
await menuAction('album')
await waitFor(`document.body.innerText.includes('已加入相册 1 张')`, '相册收录成功反馈')
check('聊天图片可从原位加入相册', true, '')

await openMenuAt(BY_ID('flow-image'), 'flow-image duplicate photo')
await menuAction('album')
await waitFor(`document.body.innerText.includes('这张图片已经加入相册了')`, '重复图片反馈')
check('重复加入相册有明确反馈', true, '')

await openMenuAt(BY_ID('flow-bad-image'), 'flow-bad-image')
await menuAction('album')
await waitFor(`document.body.innerText.includes('聊天图片不是可收录的')`, '图片失败反馈')
check('不支持的聊天图片给出失败原因', true, '')

const flowStored = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('habitat-db')
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  const tx = db.transaction(['bookmarks', 'artworks', 'photos'], 'readonly')
  const one = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result ?? null); req.onerror = () => rej(req.error) })
  const bookmark = await one(tx.objectStore('bookmarks').index('[targetType+targetId]').get(['chat-message', 'flow-text']))
  const artwork = await one(tx.objectStore('artworks').get('artwork-chat-flow-text'))
  const component = await one(tx.objectStore('artworks').get('artwork-chat-flow-component'))
  const photo = await one(tx.objectStore('photos').get('photo-chat-flow-image-1'))
  db.close()
  return { bookmark, artwork, component, photo }
})()`)
check(
  '收藏保存消息快照与来源会话',
  flowStored.bookmark?.targetId === 'flow-text' &&
    flowStored.bookmark?.sourceId === 'flow-text' &&
    flowStored.bookmark?.sessionId === sessionFlow &&
    flowStored.bookmark?.note?.includes('值得长期留下'),
  JSON.stringify(flowStored.bookmark),
)
check(
  '作品保存稳定快照与来源信息',
  flowStored.artwork?.sourceId === 'flow-text' &&
    flowStored.artwork?.sessionId === sessionFlow &&
    flowStored.artwork?.description?.includes('值得长期留下'),
  JSON.stringify(flowStored.artwork),
)
check(
  '组件作品保存组件快照',
  flowStored.component?.description?.includes('[组件] 行程卡片') &&
    flowStored.component?.metadata?.sourceBlockKinds?.includes('widget'),
  JSON.stringify(flowStored.component),
)
check(
  '相册保存原图与消息 / block 来源',
  flowStored.photo?.sourceId === 'flow-image' &&
    flowStored.photo?.sessionId === sessionFlow &&
    flowStored.photo?.imageDataUrl?.startsWith('data:image/gif;base64,') &&
    flowStored.photo?.metadata?.sourceBlockOrder === 1,
  JSON.stringify(flowStored.photo),
)

await evaluate(`(() => { history.pushState({}, '', '/home/bookmarks'); dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`)
await waitFor(`document.querySelector('a[href*="message=flow-text"]') !== null`, '收藏中心显示消息来源')
const bookmarkSourceLink = await evaluate(`document.querySelector('a[href*="message=flow-text"]')?.getAttribute('href') ?? null`)
check('收藏中心可查看原聊天来源', bookmarkSourceLink?.includes(`/chat/${sessionFlow}`) === true, String(bookmarkSourceLink))

await evaluate(`(() => { history.pushState({}, '', '/home/works'); dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`)
await waitFor(`document.querySelector('a[href*="message=flow-component"]') !== null`, '作品中心显示组件来源')
const artworkSourceLink = await evaluate(`document.querySelector('a[href*="message=flow-component"]')?.getAttribute('href') ?? null`)
check('作品中心可查看原聊天来源', artworkSourceLink?.includes(`/chat/${sessionFlow}`) === true, String(artworkSourceLink))

await evaluate(`(() => { history.pushState({}, '', '/home/album'); dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`)
await waitFor(`document.querySelector('a[href*="message=flow-image"]') !== null`, '相册显示聊天图片来源')
const photoSourceLink = await evaluate(`document.querySelector('a[href*="message=flow-image"]')?.getAttribute('href') ?? null`)
check('相册可查看原聊天来源', photoSourceLink?.includes(`/chat/${sessionFlow}`) === true, String(photoSourceLink))

/* 12.9 P0 第三批 A：会话置顶 + 聊天设置入口（零 schema） */
await seedSessions([
  {
    id: 'pin-old', type: 'chat-session', title: '较早的验收会话', pinnedAt: null,
    remark: null, background: null, bubbleMode: 'chat', archivedAt: null,
    createdAt: 1000, updatedAt: 1000,
  },
  {
    id: 'pin-new', type: 'chat-session', title: '较新的验收会话', pinnedAt: null,
    remark: null, background: null, bubbleMode: 'chat', archivedAt: null,
    createdAt: 2000, updatedAt: 2000,
  },
])
await seedMessages('pin-new', [
  // 两条消息是刻意的：这条用户消息让「两侧头像」这一条断言在同一屏里就能验，
  // 不必靠滚动去凑（虚拟列表只渲染可视区，滚出来的状态很不稳）。
  seedMessage('settings-user', 'user', [
    { kind: 'text', order: 0, payload: { text: '只属于这段对话的问题' } },
  ], { createdAt: 2000, updatedAt: 2000 }),
  seedMessage('settings-ai', 'assistant', [
    { kind: 'text', order: 0, payload: { text: '设置模式验收消息' } },
  ], { createdAt: 2100, updatedAt: 2100, metadata: { reasoning: '先看看用户说了什么，然后组织一句简短的回复' } }),
])
await evaluate(`(() => { history.pushState({}, '', '/chat'); dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="session-row-pin-old"]') !== null`, '置顶验收会话进入列表')

/* 12.9.1 V2-B 第一切片：跨会话历史搜索、当前会话搜索与日期定位 */
await evaluate(`(() => { document.querySelector('[data-testid="chat-history-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-history-panel-all"]') !== null`, '聊天历史搜索面板')
await setField('[data-testid="chat-history-query-all"]', '设置模式验收消息')
await evaluate(`(() => { document.querySelector('[data-testid="chat-history-submit"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-search-result-settings-ai"]') !== null`, '跨会话搜索结果')
check('会话列表可搜索跨会话历史消息', (await evaluate(`document.querySelector('[data-testid="chat-search-result-settings-ai"]')?.innerText.includes('较新的验收会话') === true`)) === true, '')
await evaluate(`(() => { document.querySelector('[data-testid="chat-search-result-settings-ai"]').click(); return 'ok' })()`)
await waitFor(`location.search.includes('focus=settings-ai') && document.querySelector('[data-testid="chat-bubble-settings-ai"]') !== null`, '搜索结果定位原消息')
check('搜索结果进入原会话并定位命中消息', (await evaluate(`document.querySelector('[data-testid="chat-bubble-settings-ai"]')?.style.boxShadow.includes('var(--accent-strong)') === true`)) === true, '')

await evaluate(`(() => { document.querySelector('[data-testid="chat-history-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-history-panel-session"]') !== null && document.querySelector('[data-testid^="chat-day-"]') !== null`, '当前会话时间线')
await setField('[data-testid="chat-history-query-session"]', '只属于这段对话的问题')
await evaluate(`(() => { document.querySelector('[data-testid="chat-history-submit"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-search-result-settings-user"]') !== null`, '当前会话搜索结果')
check('聊天窗口只搜索当前会话', (await evaluate(`document.querySelectorAll('[data-testid^="chat-search-result-"]').length === 1 && document.body.innerText.includes('只属于这段对话的问题')`)) === true, '')
const firstDayButton = await evaluate(`document.querySelector('[data-testid^="chat-day-"]')?.getAttribute('data-testid') ?? null`)
if (firstDayButton !== null) {
  await evaluate(`(() => { document.querySelector('[data-testid="${firstDayButton}"]').click(); return 'ok' })()`)
  await waitFor(`location.search.includes('focus=') && document.querySelector('[data-testid="chat-bubble-settings-user"]') !== null`, '日期跳转原消息')
  check('当前会话时间线可跳到指定日期首条消息', true, firstDayButton)
}

const relativePinOrder = async () => evaluate(`(() => {
  const ids = [...document.querySelectorAll('[data-testid^="session-row-"]')].map((el) => el.dataset.testid)
  return { old: ids.indexOf('session-row-pin-old'), newer: ids.indexOf('session-row-pin-new'), first: ids[0] }
})()`)
const beforePinOrder = await relativePinOrder()
check('普通会话保持消息活跃时间倒序', beforePinOrder.newer < beforePinOrder.old, JSON.stringify(beforePinOrder))

await evaluate(`(() => { document.querySelector('[data-testid="session-menu-pin-old"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-pin"]') !== null`, '会话行「⋯」菜单打开')
await evaluate(`(() => { document.querySelector('[data-testid="action-pin"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid^="session-row-"]')?.dataset.testid === 'session-row-pin-old'`, '置顶会话移到顶部')
const pinnedState = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const value = await new Promise((res, rej) => { const r = db.transaction('sessions').objectStore('sessions').get('pin-old'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  db.close(); return value
})()`)
check('置顶即时重排并持久化时间戳', typeof pinnedState?.pinnedAt === 'number' && pinnedState.updatedAt === 1000, JSON.stringify(pinnedState))

await evaluate(`(() => { document.querySelector('[data-testid="session-menu-pin-old"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-pin"]') !== null`, '已置顶会话的菜单打开')
const pinnedMenuLabel = await evaluate(`document.querySelector('[data-testid="action-pin"]').innerText.trim()`)
check('已置顶会话的菜单改为「取消置顶」', pinnedMenuLabel === '取消置顶', pinnedMenuLabel)
await evaluate(`(() => { document.querySelector('[data-testid="action-pin"]').click(); return 'ok' })()`)
// ⚠️ 不能等「行内 ⋯ 又出现了」——菜单开着时列表并未卸载，条件会瞬间成立（假通过）。
// 等轻提示才说明这次操作真的落地了。
await waitFor(`document.body.innerText.includes('已取消置顶')`, '取消置顶落地')
const afterUnpinOrder = await relativePinOrder()
const unpinnedState = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const value = await new Promise((res, rej) => { const r = db.transaction('sessions').objectStore('sessions').get('pin-old'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  db.close(); return value
})()`)
check('取消置顶后回到原活跃顺序', afterUnpinOrder.newer < afterUnpinOrder.old && unpinnedState?.pinnedAt === null, JSON.stringify({ afterUnpinOrder, unpinnedState }))

await evaluate(`(() => { history.pushState({}, '', '/chat/pin-new'); dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`)
await waitFor(`document.body.innerText.includes('设置模式验收消息')`, '进入设置验收会话')
const settingsEntry = await evaluate(`(() => ({
  hasEntry: document.querySelector('[data-testid="chat-settings-open"]') !== null,
  hasGroup: document.body.innerText.includes('会话分组'),
}))()`)
check('顶栏提供聊天设置入口且不混入会话分组', settingsEntry.hasEntry && !settingsEntry.hasGroup, JSON.stringify(settingsEntry))

await evaluate(`(() => { document.querySelector('[data-testid="chat-settings-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-settings-sheet"]') !== null`, '聊天设置面板打开')
const defaultSettings = await evaluate(`(() => ({
  remark: document.querySelector('[data-testid="chat-setting-remark"]')?.value,
  background: document.querySelector('[data-testid="chat-setting-background"]')?.value,
  bubbleMode: document.querySelector('[data-testid="chat-setting-bubble-mode"]')?.value,
}))()`)
check('聊天设置读取当前会话默认值', defaultSettings.remark === '' && defaultSettings.background === '' && defaultSettings.bubbleMode === 'chat', JSON.stringify(defaultSettings))

await setField('[data-testid="chat-setting-remark"]', '只属于这段对话的备注')
await evaluate(`(() => {
  const setSelect = (selector, value) => {
    const el = document.querySelector(selector)
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  setSelect('[data-testid="chat-setting-background"]', '#edf4f1')
  setSelect('[data-testid="chat-setting-bubble-mode"]', 'native')
  document.querySelector('[data-testid="chat-settings-save"]').click()
  return 'ok'
})()`)
await waitFor(`document.body.innerText.includes('聊天设置已保存')`, '聊天设置保存反馈')

const savedSettings = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const tx = db.transaction('sessions')
  const session = await new Promise((res, rej) => { const r = tx.objectStore('sessions').get('pin-new'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const version = db.version
  db.close()
  return { session, version }
})()`)
check(
  '会话设置持久化且不刷新消息活跃时间',
  savedSettings.session?.remark === '只属于这段对话的备注' &&
    savedSettings.session?.background === '#edf4f1' &&
    savedSettings.session?.bubbleMode === 'native' &&
    savedSettings.session?.updatedAt === 2000,
  JSON.stringify(savedSettings),
)
check('会话设置不牵动 schema（v13 = AI 伴学卡片）', savedSettings.version === 130, String(savedSettings.version))

const appliedSettings = await evaluate(`(() => {
  const area = document.querySelector('[data-testid="chat-message-area"]')
  const bubble = document.querySelector('[data-message-id="settings-ai"] [data-bubble-mode]')
  return {
    background: area ? getComputedStyle(area).backgroundColor : null,
    bubbleMode: bubble?.dataset.bubbleMode ?? null,
    bubbleBackground: bubble ? getComputedStyle(bubble).backgroundColor : null,
  }
})()`)
check('会话背景保存后立即生效', appliedSettings.background === 'rgb(237, 244, 241)', JSON.stringify(appliedSettings))
check('AI 原生气泡模式保存后立即生效', appliedSettings.bubbleMode === 'native' && appliedSettings.bubbleBackground === 'rgba(0, 0, 0, 0)', JSON.stringify(appliedSettings))

await evaluate(`(() => { document.querySelector('[data-testid="chat-settings-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-settings-sheet"]') !== null`, '重新打开聊天设置')
const reopenedSettings = await evaluate(`(() => ({
  remark: document.querySelector('[data-testid="chat-setting-remark"]')?.value,
  background: document.querySelector('[data-testid="chat-setting-background"]')?.value,
  bubbleMode: document.querySelector('[data-testid="chat-setting-bubble-mode"]')?.value,
}))()`)
check('重新打开设置可回读已保存值', reopenedSettings.remark === '只属于这段对话的备注' && reopenedSettings.background === '#edf4f1' && reopenedSettings.bubbleMode === 'native', JSON.stringify(reopenedSettings))

await send('Emulation.clearDeviceMetricsOverride')

/* 12.10 P0 收尾：会话分组（SPEC §2.1.3，Dexie v8） */

/** 页面上现存的分区（id + 名称）—— 按名称定位，不靠「数了几个」，也不靠脚本自己记变量 */
const listGroups = () =>
  evaluate(`(() => [...document.querySelectorAll('[data-testid^="group-section-"]')]
    .map((el) => {
      const id = el.dataset.testid.replace('group-section-', '')
      const nameEl = document.querySelector('[data-testid="group-name-' + id + '"]')
      return { id, name: nameEl ? nameEl.innerText.trim() : '' }
    }))()`)
/** 等某个名称的分区出现，并返回它的 id */
async function waitGroupNamed(name) {
  await waitFor(`[...document.querySelectorAll('[data-testid^="group-name-"]')].some((el) => el.innerText.trim() === ${JSON.stringify(name)})`, `分区出现：${name}`)
  return (await listGroups()).find((g) => g.name === name)?.id ?? ''
}

/** 只取「分区标题 + 本节两条验收会话行」，用来判 DOM 顺序 = 这条会话落在哪个分区里 */
const listOrder = () =>
  evaluate(`(() => [...document.querySelectorAll(
    '[data-testid="session-row-group-a"], [data-testid="session-row-group-b"], [data-testid="pinned-section"], [data-testid="unassigned-section"], [data-testid^="group-section-"]'
  )].map((el) => el.dataset.testid))()`)

const readRow = (table, id) =>
  evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const store = db.transaction(${JSON.stringify(table)}).objectStore(${JSON.stringify(table)})
    const value = await new Promise((res, rej) => { const r = store.get(${JSON.stringify(id)}); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    return value
  })()`)
const readSession = (id) => readRow('sessions', id)
const readGroup = (id) => readRow('sessionGroups', id)

/** 上一条轻提示消失后再做下一个动作 —— 提示还在会让下一步的等待条件瞬间成立（假通过） */
async function waitToastGone() {
  await waitFor(`document.querySelector('[data-testid="list-toast"]') === null`, '上一条提示消失', 8000)
}

async function openRowMenu(id) {
  await evaluate(`(() => { document.querySelector('[data-testid="session-menu-${id}"]').click(); return 'ok' })()`)
  await waitFor(`document.querySelector('[data-testid="action-sheet"]') !== null`, `会话行菜单打开：${id}`)
}

async function openGroupMenu(id) {
  await evaluate(`(() => { document.querySelector('[data-testid="group-menu-${id}"]').click(); return 'ok' })()`)
  await waitFor(`document.querySelector('[data-testid="action-sheet"]') !== null`, `分组菜单打开：${id}`)
}

/** 当前菜单项文案（排掉同前缀的菜单容器与遮罩） */
const sheetItems = () =>
  evaluate(`(() => [...document.querySelectorAll('[data-testid^="action-"]')]
    .filter((el) => el.dataset.testid !== 'action-sheet' && el.dataset.testid !== 'action-sheet-backdrop')
    .map((el) => el.innerText.trim()))()`)

await seedSessions([
  {
    id: 'group-a', type: 'chat-session', title: '分组验收会话 A', pinnedAt: null, groupId: null,
    remark: null, background: null, bubbleMode: 'chat', archivedAt: null,
    createdAt: 3000, updatedAt: 3000,
  },
  {
    id: 'group-b', type: 'chat-session', title: '分组验收会话 B', pinnedAt: null, groupId: null,
    remark: null, background: null, bubbleMode: 'chat', archivedAt: null,
    createdAt: 3100, updatedAt: 3100,
  },
])
await evaluate(`(() => { history.pushState({}, '', '/chat'); dispatchEvent(new PopStateEvent('popstate')); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="session-row-group-a"]') !== null`, '分组验收会话进入列表')

/* 12.10.1 创建分组 */
await evaluate(`(() => { document.querySelector('[data-testid="create-group"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, '分组命名弹层打开')
const emptyNameDisabled = await evaluate(`document.querySelector('[data-testid="name-sheet-save"]').disabled`)
check('分组名为空时不能保存', emptyNameDisabled === true, String(emptyNameDisabled))
await setField('[data-testid="name-sheet-input"]', '工作')
await evaluate(`(() => { document.querySelector('[data-testid="name-sheet-save"]').click(); return 'ok' })()`)
await waitFor(`document.body.innerText.includes('已创建分组「工作」')`, '创建分组反馈')
const workGroup = await waitGroupNamed('工作')
check('创建分组后列表出现「工作」分区', workGroup !== '', JSON.stringify(await listGroups()))
const workGroupRow = await readGroup(workGroup)
check(
  '分组落库（名称 / 类型 / 默认展开）',
  workGroupRow?.name === '工作' && workGroupRow?.type === 'session-group' && workGroupRow?.collapsed === false,
  JSON.stringify(workGroupRow),
)

/* 12.10.2 未分组会话的菜单项 */
await waitToastGone()
await openRowMenu('group-a')
const ungroupedItems = await sheetItems()
check(
  '未分组会话菜单：置顶 / 移入分组 / 删除，且不给「移出分组」',
  ungroupedItems.includes('置顶会话') &&
    ungroupedItems.includes('移入分组') &&
    ungroupedItems.includes('删除会话') &&
    !ungroupedItems.includes('移出分组'),
  JSON.stringify(ungroupedItems),
)

/* 12.10.3 移入分组 */
await menuAction('move')
await waitFor(`document.querySelector('[data-testid="action-group:${workGroup}"]') !== null`, '选组菜单列出目标分组')
await menuAction(`group:${workGroup}`)
await waitFor(`document.body.innerText.includes('已移入「工作」')`, '移入分组反馈')
const movedOrder = await listOrder()
check(
  '会话落进所属分区（DOM 顺序夹在该分区与未分组区之间）',
  movedOrder.indexOf(`group-section-${workGroup}`) > -1 &&
    movedOrder.indexOf(`group-section-${workGroup}`) < movedOrder.indexOf('session-row-group-a') &&
    movedOrder.indexOf('session-row-group-a') < movedOrder.indexOf('unassigned-section'),
  JSON.stringify(movedOrder),
)
const workCount = await evaluate(`document.querySelector('[data-testid="group-count-${workGroup}"]').innerText.trim()`)
check('分区计数跟随会话数', workCount === '1', workCount)
const storedA = await readSession('group-a')
check('移入分组落库且不刷新消息活跃时间', storedA?.groupId === workGroup && storedA?.updatedAt === 3000, JSON.stringify(storedA))

/* 12.10.4 折叠 / 展开 + 刷新保持 */
await waitToastGone()
await evaluate(`(() => { document.querySelector('[data-testid="group-toggle-${workGroup}"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="session-row-group-a"]') === null`, '折叠后组内会话不再渲染')
const collapsedRow = await readGroup(workGroup)
check('折叠状态落库（不是只活在界面里）', collapsedRow?.collapsed === true, JSON.stringify(collapsedRow))

await reloadAndWait(`document.querySelector('[data-testid="create-group"]') !== null`, '刷新后回到会话列表')
const afterReload = await evaluate(`(() => ({
  group: document.querySelector('[data-testid="group-section-${workGroup}"]') !== null,
  row: document.querySelector('[data-testid="session-row-group-a"]') !== null,
}))()`)
check('刷新后分组与折叠状态都保持', afterReload.group === true && afterReload.row === false, JSON.stringify(afterReload))

await evaluate(`(() => { document.querySelector('[data-testid="group-toggle-${workGroup}"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="session-row-group-a"]') !== null`, '展开后组内会话回来')

/* 12.10.5 置顶跨分组浮到最顶（SPEC §2.1.2 定的优先级） */
await waitToastGone()
await openRowMenu('group-a')
await menuAction('pin')
await waitFor(`document.querySelector('[data-testid="pinned-section"]') !== null`, '出现置顶区')
const pinnedOrder = await listOrder()
check(
  '置顶会话浮到最顶并离开原分区',
  pinnedOrder[0] === 'pinned-section' &&
    pinnedOrder.indexOf('session-row-group-a') === 1 &&
    pinnedOrder.indexOf(`group-section-${workGroup}`) > 1,
  JSON.stringify(pinnedOrder),
)
const pinnedWorkCount = await evaluate(`document.querySelector('[data-testid="group-count-${workGroup}"]').innerText.trim()`)
check('置顶后原分区计数归零', pinnedWorkCount === '0', pinnedWorkCount)

/* 12.10.6 取消置顶 → 回落原分组（groupId 没被改写，所以是显示上的浮动） */
await waitToastGone()
await openRowMenu('group-a')
const pinnedMenu = await sheetItems()
check(
  '已置顶且已分组的会话菜单：取消置顶 + 移出分组',
  pinnedMenu.includes('取消置顶') && pinnedMenu.includes('移出分组'),
  JSON.stringify(pinnedMenu),
)
await menuAction('pin')
await waitFor(`document.querySelector('[data-testid="pinned-section"]') === null`, '取消置顶后置顶区消失')
const fallbackOrder = await listOrder()
check(
  '取消置顶后回落到原分组',
  fallbackOrder.indexOf(`group-section-${workGroup}`) < fallbackOrder.indexOf('session-row-group-a'),
  JSON.stringify(fallbackOrder),
)

/* 12.10.7 移出分组 */
await waitToastGone()
await openRowMenu('group-a')
await menuAction('ungroup')
await waitFor(`document.body.innerText.includes('已移出分组')`, '移出分组反馈')
const ungroupedOrder = await listOrder()
check(
  '移出分组后落进未分组区',
  ungroupedOrder.indexOf('unassigned-section') < ungroupedOrder.indexOf('session-row-group-a'),
  JSON.stringify(ungroupedOrder),
)

/* 12.10.8 重命名分组 */
await waitToastGone()
await evaluate(`(() => { document.querySelector('[data-testid="create-group"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, '再次打开分组命名弹层')
await setField('[data-testid="name-sheet-input"]', '归档')
await evaluate(`(() => { document.querySelector('[data-testid="name-sheet-save"]').click(); return 'ok' })()`)
const archiveGroup = await waitGroupNamed('归档')

await waitToastGone()
await openGroupMenu(workGroup)
await menuAction('rename-group')
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, '重命名弹层打开')
const namePrefill = await evaluate(`document.querySelector('[data-testid="name-sheet-input"]').value`)
check('重命名弹层预填当前名称', namePrefill === '工作', String(namePrefill))
await setField('[data-testid="name-sheet-input"]', '生活')
await evaluate(`(() => { document.querySelector('[data-testid="name-sheet-save"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="group-name-${workGroup}"]').innerText.trim() === '生活'`, '分区标题更新')
const renamedGroup = await readGroup(workGroup)
check('重命名落库', renamedGroup?.name === '生活', JSON.stringify(renamedGroup))

/* 12.10.9 删除分组（非空）：确认语必须说清几条会话回到未分组，且会话本身不能丢 */
await waitToastGone()
await openRowMenu('group-b')
await menuAction('move')
await waitFor(`document.querySelector('[data-testid="action-group:${archiveGroup}"]') !== null`, '选组菜单列出第二个分组')
await menuAction(`group:${archiveGroup}`)
await waitFor(`document.querySelector('[data-testid="group-count-${archiveGroup}"]').innerText.trim() === '1'`, '会话进入第二个分组')

await waitToastGone()
await openGroupMenu(archiveGroup)
await menuAction('delete-group')
await waitFor(`document.querySelector('[data-testid="group-confirm-${archiveGroup}"]') !== null`, '删除分组需要二次确认')
const deleteConfirmText = await evaluate(`document.querySelector('[data-testid="group-confirm-${archiveGroup}"]').innerText.trim()`)
check('删组确认语说清会有几条会话回到未分组', deleteConfirmText.includes('1 个会话回到未分组'), deleteConfirmText)
await evaluate(`(() => { document.querySelector('[data-testid="group-confirm-${archiveGroup}"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="group-section-${archiveGroup}"]') === null`, '分组已删除')
await waitFor(`document.body.innerText.includes('已删除分组，1 个会话回到未分组')`, '删除分组反馈')
const survivorRows = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const store = db.transaction('sessions').objectStore('sessions')
  const get = (id) => new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const a = await get('group-a')
  const b = await get('group-b')
  db.close()
  return { a, b }
})()`)
check(
  '删分组不删会话，组内会话回到未分组',
  survivorRows.a !== undefined && survivorRows.b !== undefined && survivorRows.b?.groupId === null,
  JSON.stringify(survivorRows),
)

/* 12.10.10 删除分组（空）：确认语不带条数 */
await waitToastGone()
await openGroupMenu(workGroup)
await menuAction('delete-group')
await waitFor(`document.querySelector('[data-testid="group-confirm-${workGroup}"]') !== null`, '空分组同样要二次确认')
const emptyDeleteText = await evaluate(`document.querySelector('[data-testid="group-confirm-${workGroup}"]').innerText.trim()`)
check('空分组的确认语不带条数', emptyDeleteText === '确认删除？', emptyDeleteText)
await evaluate(`(() => { document.querySelector('[data-testid="group-confirm-${workGroup}"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="group-section-${workGroup}"]') === null`, '空分组已删除')
await waitFor(`document.body.innerText.includes('已删除分组')`, '空分组删除反馈')

/* 12.10.11 脏引用兜底：groupId 指向不存在的分组时，会话不能消失 */
await waitToastGone()
await evaluate(`(() => { document.querySelector('[data-testid="create-group"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, '重建一个分组用于兜底验收')
await setField('[data-testid="name-sheet-input"]', '临时')
await evaluate(`(() => { document.querySelector('[data-testid="name-sheet-save"]').click(); return 'ok' })()`)
const lonelyGroup = await waitGroupNamed('临时')

await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const store = db.transaction('sessions', 'readwrite').objectStore('sessions')
  const row = await new Promise((res, rej) => { const r = store.get('group-a'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  await new Promise((res, rej) => { const r = store.put({ ...row, groupId: 'ghost-group-不存在的分组' }); r.onsuccess = () => res('ok'); r.onerror = () => rej(r.error) })
  db.close()
  return 'ok'
})()`)
await reloadAndWait(`document.querySelector('[data-testid="session-row-group-a"]') !== null`, '脏引用会话仍渲染')
const ghostOrder = await listOrder()
check(
  'groupId 指向不存在分组时落进未分组兜底区（会话不消失）',
  ghostOrder.indexOf('session-row-group-a') > ghostOrder.indexOf('unassigned-section'),
  JSON.stringify(ghostOrder),
)

/* 12.10.12 没有分组时，列表回到平铺（不用分组的人不该看到分组的痕迹） */
await waitToastGone()
await openGroupMenu(lonelyGroup)
await menuAction('delete-group')
await waitFor(`document.querySelector('[data-testid="group-confirm-${lonelyGroup}"]') !== null`, '删除最后一个分组需二次确认')
await evaluate(`(() => { document.querySelector('[data-testid="group-confirm-${lonelyGroup}"]').click(); return 'ok' })()`)
await waitFor(`document.querySelectorAll('[data-testid^="group-section-"]').length === 0`, '分组全部删除')
const flatState = await evaluate(`(() => ({
  unassigned: document.querySelector('[data-testid="unassigned-section"]') !== null,
  pinned: document.querySelector('[data-testid="pinned-section"]') !== null,
  rows: document.querySelectorAll('[data-testid^="session-row-"]').length,
}))()`)
check(
  '没有分组时列表回到平铺（不渲染任何分区标题）',
  flatState.unassigned === false && flatState.pinned === false && flatState.rows >= 2,
  JSON.stringify(flatState),
)

/* ---------- 13. 输入区：快捷操作栏 + 请求回复拆开（SPEC §2.4） ---------- */
// 全新会话 —— 本节按「未回复条数」断言，不能被前面留下的会话与消息污染
const composerSession = await newSession('输入区验收会话')

const rolesOf = (rows) => rows.map((m) => m.role).join(',')

const quickBar = await evaluate(`(() => {
  const bar = document.querySelector('[data-testid="quick-bar"]')
  return {
    bar: bar !== null,
    voice: document.querySelector('[data-testid="quick-voice"]') !== null,
    emoji: document.querySelector('[data-testid="quick-emoji"]') !== null,
    more: document.querySelector('[data-testid="quick-more"]') !== null,
    reply: document.querySelector('[data-testid="request-reply"]') !== null,
  }
})()`)
check(
  '输入框下方有快捷操作栏：语音条 / 表情包 / 更多 / 请求回复',
  quickBar.bar && quickBar.voice && quickBar.emoji && quickBar.more && quickBar.reply,
  JSON.stringify(quickBar),
)

const replyIdle = await evaluate(`(() => {
  const btn = document.querySelector('[data-testid="request-reply"]')
  return {
    disabled: btn.disabled,
    hint: document.querySelector('[data-testid="unreplied-hint"]') !== null,
  }
})()`)
check(
  '没有待回复消息时「请求回复」不可用、也不显示提示条',
  replyIdle.disabled === true && replyIdle.hint === false,
  JSON.stringify(replyIdle),
)

// 先走一遍默认路径：确认「拆开」没有把原来的一步发送改坏
await type('第一条：正常发送')
await clickSend()
await waitIdle('第一条正常发送收尾')
const afterFirst = await readMessages(composerSession)
check(
  '主按钮「发送」仍是一步拿到回复（默认行为未被改变）',
  afterFirst.length === 2 && rolesOf(afterFirst) === 'user,assistant',
  rolesOf(afterFirst),
)
const upstreamAfterFirst = await lastUpstreamBody()

/* --- 只发送：不请求回复 --- */
await type('第二条：只发送')
await evaluate(`(() => { document.querySelector('[data-testid="quick-more"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-sheet"]') !== null`, '「更多功能」菜单打开')
const moreItems = await sheetItems()
check(
  '「更多功能」菜单含只发送 / 插入当前时间 / 清空输入',
  moreItems.some((t) => t.includes('只发送，不请求回复')) &&
    moreItems.some((t) => t.includes('插入当前时间')) &&
    moreItems.some((t) => t.includes('清空输入')),
  JSON.stringify(moreItems),
)
await evaluate(`(() => { document.querySelector('[data-testid="action-silent-send"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="toast"]') !== null`, '只发送的轻提示')
const silentToast = await evaluate(`document.querySelector('[data-testid="toast"]').innerText.trim()`)
// 给「万一真的偷偷发了请求」留出到达 mock 的时间：断言「没请求」必须等够，否则是假通过
await sleep(900)
const upstreamAfterSilent = await lastUpstreamBody()
check('「只发送」给出明确反馈', silentToast.includes('未请求回复'), silentToast)
check(
  '「只发送」确实没有触发模型调用（上游报文一字未变）',
  JSON.stringify(upstreamAfterSilent) === JSON.stringify(upstreamAfterFirst),
  '',
)

await waitFor(
  `document.querySelector('[data-testid="unreplied-hint"]') !== null`,
  '待回复提示条出现',
)
const hint1 = await evaluate(`document.querySelector('[data-testid="unreplied-hint"]').innerText.trim()`)
const reply1 = await evaluate(`(() => {
  const btn = document.querySelector('[data-testid="request-reply"]')
  return { disabled: btn.disabled, label: btn.innerText.trim() }
})()`)
const afterSilent1 = await readMessages(composerSession)
check('「只发送」只落用户消息，不产生回复草稿', rolesOf(afterSilent1) === 'user,assistant,user', rolesOf(afterSilent1))
check('待回复提示条写清条数', hint1.includes('1 条消息还没请求回复'), hint1)
check(
  '「请求回复」随待回复消息变为可用并显示条数',
  reply1.disabled === false && reply1.label.includes('(1)'),
  JSON.stringify(reply1),
)

/* --- 连续只发送两条，再一次性请求回复 --- */
await type('第三条：也只发送')
await evaluate(`(() => { document.querySelector('[data-testid="quick-more"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-sheet"]') !== null`, '再次打开「更多功能」')
await waitFor(`document.querySelector('[data-testid="action-silent-send"]') !== null`, '有内容时才出现「只发送」')
await evaluate(`(() => { document.querySelector('[data-testid="action-silent-send"]').click(); return 'ok' })()`)
await waitFor(
  `document.querySelector('[data-testid="unreplied-hint"]').innerText.includes('2 条消息还没请求回复')`,
  '待回复累积到 2 条',
)
const hint2 = await evaluate(`document.querySelector('[data-testid="unreplied-hint"]').innerText.trim()`)
check('多条未回复时提示条累计条数', hint2.includes('2 条消息还没请求回复'), hint2)

await evaluate(`(() => { document.querySelector('[data-testid="request-reply"]').click(); return 'ok' })()`)
await waitIdle('「请求回复」收尾')
const afterReply = await readMessages(composerSession)
check(
  '一次「请求回复」只补一条回复（处理整批而不是逐条补）',
  rolesOf(afterReply) === 'user,assistant,user,user,assistant',
  rolesOf(afterReply),
)
const upstreamAfterReply = JSON.stringify(await lastUpstreamBody())
check(
  '两条未回复消息一起进了这一轮上下文',
  upstreamAfterReply.includes('第二条：只发送') && upstreamAfterReply.includes('第三条：也只发送'),
  '',
)
const replyAfter = await evaluate(`(() => {
  const btn = document.querySelector('[data-testid="request-reply"]')
  return {
    disabled: btn.disabled,
    hint: document.querySelector('[data-testid="unreplied-hint"]') !== null,
  }
})()`)
check(
  '回复落地后提示条消失、「请求回复」回到不可用',
  replyAfter.hint === false && replyAfter.disabled === true,
  JSON.stringify(replyAfter),
)

/* --- 「更多」的菜单项按状态增减，不是渲染出来再置灰 --- */
await evaluate(`(() => { document.querySelector('[data-testid="quick-more"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-sheet"]') !== null`, '空输入时打开「更多功能」')
const emptyMore = await sheetItems()
check(
  '输入框为空时「只发送」「清空输入」不出现',
  !emptyMore.some((t) => t.includes('只发送')) &&
    !emptyMore.some((t) => t.includes('清空输入')) &&
    emptyMore.some((t) => t.includes('插入当前时间')),
  JSON.stringify(emptyMore),
)
await evaluate(`(() => { document.querySelector('[data-testid="action-insert-time"]').click(); return 'ok' })()`)
const timeDraft = await evaluate(`document.querySelector('[data-testid="composer"]').value`)
check('「插入当前时间」写进输入框', /^\d{2}:\d{2}$/.test(timeDraft.trim()), timeDraft)

await evaluate(`(() => { document.querySelector('[data-testid="quick-more"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-clear-draft"]') !== null`, '有内容时出现「清空输入」')
await evaluate(`(() => { document.querySelector('[data-testid="action-clear-draft"]').click(); return 'ok' })()`)
const clearedDraft = await evaluate(`document.querySelector('[data-testid="composer"]').value`)
check('「清空输入」把输入框清空', clearedDraft === '', JSON.stringify(clearedDraft))

/* --- 表情包：插入光标处，不是一律追加到末尾 --- */
await evaluate(`(() => { document.querySelector('[data-testid="quick-emoji"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="emoji-panel"]') !== null`, '表情面板展开')
const emojiState = await evaluate(`(() => {
  const els = [...document.querySelectorAll('[data-testid="emoji-option"]')]
  return { count: els.length, first: els[0]?.innerText.trim() ?? '', second: els[1]?.innerText.trim() ?? '' }
})()`)
check('表情面板展开且有一屏可选表情', emojiState.count >= 24, JSON.stringify(emojiState))
await evaluate(`(() => { document.querySelectorAll('[data-testid="emoji-option"]')[0].click(); return 'ok' })()`)
await evaluate(`(() => { document.querySelectorAll('[data-testid="emoji-option"]')[1].click(); return 'ok' })()`)
await sleep(400)
const emojiDraft = await evaluate(`document.querySelector('[data-testid="composer"]').value`)
check(
  '连续点两个表情按顺序插入（光标落在插入内容之后）',
  emojiDraft === emojiState.first + emojiState.second,
  `${JSON.stringify(emojiDraft)} vs ${JSON.stringify(emojiState.first + emojiState.second)}`,
)
await evaluate(`(() => { document.querySelector('[data-testid="quick-emoji"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="emoji-panel"]') === null`, '表情面板收起')

/* --- 语音条：真录一段真发出去（无头 Edge 带假麦克风跑） --- */
const beforeVoice = await readMessages(composerSession)
const assistantsBeforeVoice = beforeVoice.filter((m) => m.role === 'assistant').length

await evaluate(`(() => { document.querySelector('[data-testid="quick-voice"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="voice-recording"]') !== null`, '进入录音态', 15000)
await sleep(1600)
const voiceTime = await evaluate(`document.querySelector('[data-testid="voice-time"]').innerText.trim()`)
check('录音中显示实时计时', /录音中\s*0:0[1-9]/.test(voiceTime), voiceTime)
await shot('shot-chat-recording.png')

await evaluate(`(() => { document.querySelector('[data-testid="voice-send"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="voice-preview"]') !== null`, '录音预览出现')
const previewState = await evaluate(`(() => ({
  audio: document.querySelector('[data-testid="voice-preview"] audio') !== null,
  rerecord: document.querySelector('[data-testid="voice-rerecord"]') !== null,
  send: document.querySelector('[data-testid="voice-preview-send"]') !== null,
}))()`)
check('录音停止后可试听、重录或发送', previewState.audio && previewState.rerecord && previewState.send, JSON.stringify(previewState))
await evaluate(`(() => { document.querySelector('[data-testid="voice-preview-send"]').click(); return 'ok' })()`)
{
  const deadline = Date.now() + 30000
  let completed = false
  while (Date.now() < deadline) {
    const rows = await readMessages(composerSession)
    if (rows.filter((m) => m.role === 'assistant').length === assistantsBeforeVoice + 1 && rows.at(-1)?.status === 'done') { completed = true; break }
    await sleep(200)
  }
  if (!completed) throw new Error('等待超时：语音条发完并拿到回复')
}
const afterVoice = await readMessages(composerSession)
const voiceMessage = afterVoice.find((m) => m.blocks.some((b) => b.kind === 'audio'))
const voiceBlock = voiceMessage?.blocks.find((b) => b.kind === 'audio')
check(
  '语音条落成一条用户消息，音频以 data URL 保存',
  voiceMessage !== undefined &&
    voiceMessage.role === 'user' &&
    typeof voiceBlock?.payload.url === 'string' &&
    voiceBlock.payload.url.startsWith('data:audio/'),
  typeof voiceBlock?.payload.url === 'string' ? voiceBlock.payload.url.slice(0, 22) : 'missing',
)
check(
  '语音条保存了实测时长（≥1 秒）',
  typeof voiceBlock?.payload.durationMs === 'number' && voiceBlock.payload.durationMs >= 1000,
  String(voiceBlock?.payload.durationMs),
)
check(
  '语音条走与文本相同的一步发送链路（默认请求回复）',
  afterVoice.filter((m) => m.role === 'assistant').length === assistantsBeforeVoice + 1,
  `${assistantsBeforeVoice} → ${afterVoice.filter((m) => m.role === 'assistant').length}`,
)
const voiceUpstream = JSON.stringify(await lastUpstreamBody())
check(
  '语音条以真实转写进入上下文（不是空气泡）',
  voiceUpstream.includes('这是 mock 转写文本。'),
  '',
)
check('语音条保存真实转写', voiceBlock?.payload.transcript === '这是 mock 转写文本。', String(voiceBlock?.payload.transcript))
check(
  '气泡上显示语音时长',
  await evaluate(`document.querySelector('[data-testid="audio-duration"]') !== null`),
  '',
)
/**
 * ⚠️ 量的是**真实渲染宽度**，不是「元素在不在」—— 播放器第一版就真的被压成约 40px 的窄条
 * （气泡是收缩宽度块，`w-full` 在这种上下文里解成极小值），而「元素存在」断言照样全绿。
 */
const audioBox = await evaluate(`(() => {
  const el = document.querySelector('[data-testid="chat-message-area"] audio')
  if (el === null) return { found: false }
  const r = el.getBoundingClientRect()
  const bubble = el.closest('[data-message-id]')?.getBoundingClientRect() ?? null
  return { found: true, width: Math.round(r.width), height: Math.round(r.height), bubbleWidth: bubble ? Math.round(bubble.width) : null }
})()`)
check(
  '语音条播放器有正常宽度（没有被收缩容器压扁）',
  audioBox.found === true && audioBox.width >= 180 && audioBox.height >= 20,
  JSON.stringify(audioBox),
)
/**
 * ⚠️ 时长文字的**颜色**也要验：块视图最早只服务 AI 侧（浅底深字），
 * 挪到用户侧（深底反白）之后，硬编码旧令牌名（当年是 `--color-text-dim`）会变成深底上的深字 —— 等于看不见。
 * 判据是「和气泡自己的文字色一致」，而不是「不等于某个具体色值」。
 */
const durationStyle = await evaluate(`(() => {
  const el = document.querySelector('[data-testid="audio-duration"]')
  if (el === null) return { found: false }
  const bubbleEl = el.closest('[data-message-id]')?.querySelector('[data-bubble-mode]') ?? null
  return {
    found: true,
    text: el.innerText.trim(),
    color: getComputedStyle(el).color,
    bubbleColor: bubbleEl === null ? null : getComputedStyle(bubbleEl).color,
  }
})()`)
check(
  '语音条时长文字可读（继承气泡文字色，不是硬编码的次要色）',
  durationStyle.found === true &&
    durationStyle.text !== '' &&
    durationStyle.bubbleColor !== null &&
    durationStyle.color === durationStyle.bubbleColor,
  JSON.stringify(durationStyle),
)
await shot('shot-chat-voice.png')

/* --- 取消录音：什么也不该留下 --- */
await evaluate(`(() => { document.querySelector('[data-testid="quick-voice"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="voice-recording"]') !== null`, '再次进入录音态', 15000)
await sleep(900)
await evaluate(`(() => { document.querySelector('[data-testid="voice-cancel"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="voice-recording"]') === null`, '录音条消失')
await sleep(900)
const afterCancel = await readMessages(composerSession)
check(
  '取消录音不产生任何消息、也不残留输入区状态',
  afterCancel.length === afterVoice.length,
  `${afterVoice.length} → ${afterCancel.length}`,
)

/* --- 图片：选择文件后经视觉模型描述，再走普通消息链路 --- */
const assistantsBeforeImage = afterCancel.filter((m) => m.role === 'assistant').length
await evaluate(`(() => {
  const input = document.querySelector('[data-testid="image-input"]')
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0))
  const transfer = new DataTransfer()
  transfer.items.add(new File([bytes], 'phase5.png', { type: 'image/png' }))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`)
{
  const deadline = Date.now() + 30000
  let completed = false
  while (Date.now() < deadline) {
    const rows = await readMessages(composerSession)
    const imageMessage = rows.find((m) => m.role === 'user' && m.blocks.some((b) => b.kind === 'image' && b.payload.alt === '一张用于验收的图片'))
    if (imageMessage !== undefined && rows.filter((m) => m.role === 'assistant').length === assistantsBeforeImage + 1 && rows.at(-1)?.status === 'done') { completed = true; break }
    await sleep(200)
  }
  check('聊天图片保存视觉描述并一步请求回复', completed, '')
}

/* --- 图片生成：产物是普通 image block，后续对象操作自然复用 --- */
await evaluate(`(() => { document.querySelector('[data-testid="quick-more"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="action-generate-image"]') !== null`, '生成图片入口')
await evaluate(`(() => { document.querySelector('[data-testid="action-generate-image"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="image-prompt"] input') !== null`, '图片提示输入出现')
await setField('[data-testid="image-prompt"] input', '一片叶子')
await evaluate(`(() => { document.querySelector('[data-testid="image-prompt"] button').click(); return 'ok' })()`)
await waitFor(`document.body.innerText.includes('图片已生成')`, '图片生成完成')
const generatedRows = await readMessages(composerSession)
const generatedMessage = generatedRows.find((m) => m.role === 'assistant' && m.blocks.some((b) => b.kind === 'image' && b.payload.alt === '一片叶子'))
check('生成图片落成普通 assistant image block', generatedMessage !== undefined, '')

/* --- Mini Terminal：无 MCP 时必须是真空态，而不是演示工具 --- */
await evaluate(`(() => { document.querySelector('[data-testid="mini-terminal-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="mini-terminal"]')?.innerText.includes('没有可用工具')`, 'Mini Terminal 空态')
const terminalText = await evaluate(`document.querySelector('[data-testid="mini-terminal"]').innerText`)
check('Mini Terminal 无可用 MCP 时显示诊断指引', terminalText.includes('检查 MCP Server 状态'), terminalText)
await evaluate(`(() => { document.querySelector('[aria-label="关闭工具面板"]').click(); return 'ok' })()`)

/* ---------- 13. 头像 / 昵称显示开关（SPEC §9.1.3，全局显示偏好，三个独立开关） ---------- */
await send('Page.navigate', { url: `${APP}/chat/pin-new` })
await waitFor(`document.querySelector('[data-testid="chat-settings-open"]') !== null`, '回到设置验收会话')
// 先把这条偏好清掉再刷新 —— 否则验到的是上一轮留下的状态，而不是「默认是显示」
await evaluate(`(() => { localStorage.removeItem('habitat-chat-display'); return 'ok' })()`)
await reloadAndWait(`document.querySelector('[data-testid="chat-settings-open"]') !== null`, '清掉显示偏好后重新进入会话')

await evaluate(`(() => { document.querySelector('[data-testid="chat-settings-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-setting-companion-avatar"]') !== null`, '聊天设置里的小栖头像开关')

const avatarOn = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('[data-testid="message-avatar"]')]
  const companion = document.querySelector('[data-testid="chat-setting-companion-avatar"]')
  const user = document.querySelector('[data-testid="chat-setting-user-avatar"]')
  const nickname = document.querySelector('[data-testid="chat-setting-nickname"]')
  return {
    count: nodes.length,
    roles: [...new Set(nodes.map((n) => n.dataset.avatarRole))].sort().join(','),
    // 头像必须在气泡的**外侧**：小栖在左（before）、用户在右（after）
    sides: nodes.map((node) => {
      const row = node.closest('[data-message-id]')
      if (row === null) return 'no-row'
      const bubble = row.querySelector('[data-bubble-mode]')
      if (bubble === null) return 'no-bubble'
      const ordered = [...row.querySelectorAll('[data-testid="message-avatar"], [data-bubble-mode]')]
      return node.dataset.avatarRole + ':' + (ordered.indexOf(node) < ordered.indexOf(bubble) ? 'before' : 'after')
    }).sort().join(','),
    companionLabel: companion?.textContent.trim(),
    userLabel: user?.textContent.trim(),
    nicknameLabel: nickname?.textContent.trim(),
    hint: nickname?.closest('.mt-4')?.innerText ?? '',
  }
})()`)
check('默认两侧都显示头像（用户侧与小栖侧各一）', avatarOn.count >= 2 && avatarOn.roles === 'companion,user', JSON.stringify(avatarOn))
check('头像挂在气泡外侧（小栖在左、用户在右）', avatarOn.sides === 'companion:before,user:after', avatarOn.sides)
check('三个开关初值：两侧头像显示、昵称隐藏', avatarOn.companionLabel === '显示' && avatarOn.userLabel === '显示' && avatarOn.nicknameLabel === '隐藏', JSON.stringify(avatarOn))
check('开关明说影响所有会话', avatarOn.hint.includes('影响所有会话'), avatarOn.hint)
check('昵称默认关闭时不渲染昵称行', (await evaluate(`document.querySelectorAll('[data-testid="msg-nick"]').length`)) === 0, '')

// 独立性：只关小栖侧，用户侧头像必须还在
await evaluate(`(() => { document.querySelector('[data-testid="chat-setting-companion-avatar"]').click(); return 'ok' })()`)
const companionOnlyOff = await evaluate(`(() => ({
  companion: document.querySelectorAll('[data-testid="message-avatar"][data-avatar-role="companion"]').length,
  user: document.querySelectorAll('[data-testid="message-avatar"][data-avatar-role="user"]').length,
}))()`)
check('关掉小栖头像后用户侧不受牵连', companionOnlyOff.companion === 0 && companionOnlyOff.user > 0, JSON.stringify(companionOnlyOff))

// 再关用户侧 → 两边都没了
await evaluate(`(() => { document.querySelector('[data-testid="chat-setting-user-avatar"]').click(); return 'ok' })()`)
check('两侧开关都关后头像立即消失', (await evaluate(`document.querySelectorAll('[data-testid="message-avatar"]').length`)) === 0, '')

// 昵称开关：打开即出现，且默认称呼是 小栖 / 北北
await evaluate(`(() => { document.querySelector('[data-testid="chat-setting-nickname"]').click(); return 'ok' })()`)
const nickShown = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('[data-testid="msg-nick"]')]
  return { count: nodes.length, names: [...new Set(nodes.map((n) => n.textContent.trim()))].sort().join(',') }
})()`)
check('打开昵称开关后气泡上方出现称呼', nickShown.count >= 2 && nickShown.names === '北北,小栖', JSON.stringify(nickShown))

await evaluate(`(() => { document.querySelector('[aria-label="关闭聊天设置"]').click(); return 'ok' })()`)
await reloadAndWait(`document.querySelector('[data-testid="chat-settings-open"]') !== null`, '刷新回到会话')
const prefsAfterReload = await evaluate(`(() => ({
  avatars: document.querySelectorAll('[data-testid="message-avatar"]').length,
  nick: document.querySelectorAll('[data-testid="msg-nick"]').length,
  stored: localStorage.getItem('habitat-chat-display') ?? '',
}))()`)
check('三个开关刷新后仍然记住', prefsAfterReload.avatars === 0 && prefsAfterReload.nick >= 2
  && prefsAfterReload.stored.includes('"showCompanionAvatar":false')
  && prefsAfterReload.stored.includes('"showUserAvatar":false')
  && prefsAfterReload.stored.includes('"showNickname":true'), JSON.stringify(prefsAfterReload))

const storeNames = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('habitat-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const names = [...db.objectStoreNames]; db.close(); return names
})()`)
check('显示偏好不落 Dexie（它是偏好不是数据，不进备份）', !storeNames.includes('chatDisplay'), storeNames.join(','))

/* 收尾：恢复默认（两侧头像显示、昵称隐藏）—— 别把「隐藏」留给后面的截图与下一次运行 */
await evaluate(`(() => { document.querySelector('[data-testid="chat-settings-open"]').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="chat-setting-companion-avatar"]') !== null`, '重新打开聊天设置')
await evaluate(`(() => {
  document.querySelector('[data-testid="chat-setting-companion-avatar"]').click()
  document.querySelector('[data-testid="chat-setting-user-avatar"]').click()
  document.querySelector('[data-testid="chat-setting-nickname"]').click()
  return 'ok'
})()`)
const restored = await evaluate(`(() => ({
  avatars: document.querySelectorAll('[data-testid="message-avatar"]').length,
  nick: document.querySelectorAll('[data-testid="msg-nick"]').length,
}))()`)
check('恢复默认后头像回显、昵称收起', restored.avatars >= 2 && restored.nick === 0, JSON.stringify(restored))
await evaluate(`(() => { document.querySelector('[aria-label="关闭聊天设置"]').click(); return 'ok' })()`)

/* ---------- 13.5 思绪折叠卡（SPEC §2.3.6，Phase 7A） ---------- */
const reasoningCard = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-testid="reasoning-card"]')]
  const last = cards[cards.length - 1]
  if (last === undefined) return { present: false }
  return {
    present: true,
    toggleText: last.querySelector('[data-testid="reasoning-toggle"]')?.textContent.trim(),
    contentVisible: last.querySelector('[data-testid="reasoning-content"]') !== null,
    expanded: last.querySelector('[data-testid="reasoning-toggle"]')?.getAttribute('aria-expanded'),
  }
})()`)
check('有 reasoning 的 AI 消息渲染思绪折叠卡（默认收起）', reasoningCard.present === true
  && reasoningCard.contentVisible === false && reasoningCard.expanded === 'false', JSON.stringify(reasoningCard))
check('折叠卡语义明确（「思绪」而非正文）', reasoningCard.toggleText === '看它的思绪', reasoningCard.toggleText ?? '')

if (reasoningCard.present === true) {
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="reasoning-card"]')]
    cards[cards.length - 1].querySelector('[data-testid="reasoning-toggle"]').click()
    return 'ok'
  })()`)
  const expanded = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="reasoning-card"]')]
    const last = cards[cards.length - 1]
    const content = last?.querySelector('[data-testid="reasoning-content"]')
    return { text: content?.textContent ?? '', length: content?.textContent.length ?? 0 }
  })()`)
  check('点开能看到完整思绪文本（mock 思维链拼进来）', expanded.length > 0 && expanded.text.includes('先看看用户说了什么'), `length=${expanded.length} text=${expanded.text.slice(0, 40)}`)
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="reasoning-card"]')]
    cards[cards.length - 1].querySelector('[data-testid="reasoning-toggle"]').click()
    return 'ok'
  })()`)
  const collapsed = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="reasoning-card"]')]
    return cards[cards.length - 1]?.querySelector('[data-testid="reasoning-content"]') === null
  })()`)
  check('再点收起后内容不渲染', collapsed === true, JSON.stringify(collapsed))
}

/* ---------- 14. 控制台 ---------- */
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 汇总：通过 ${results.length - failed.length} / ${results.length} ===`)
ws.close()
process.exit(failed.length === 0 ? 0 : 1)
