/**
 * 聊天链路前端验收（无头 Edge + CDP 裸驱动）
 *
 * 覆盖：新建会话 → 发送 → 流式渲染 → 中止 → 刷新持久化 → 虚拟列表 → 控制台异常。
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
  await waitFor(`document.querySelector('textarea') !== null`, '输入框出现')
  await evaluate(`(() => { document.querySelector('textarea').focus(); return 'ok' })()`)
  await sleep(200)
  await send('Input.insertText', { text })
  await sleep(450)
}

async function sendButtonState() {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发送')
    const ta = document.querySelector('textarea')
    return { found: btn !== undefined, disabled: btn ? btn.disabled : null, draft: ta ? ta.value : null }
  })()`)
}

/** 等这一轮真正收尾：按钮从「停止」回到「发送」才算完（收到末个 delta ≠ 已收尾） */
async function waitIdle(label) {
  await waitFor(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '发送')`,
    label,
    25000,
  )
}

/** reload 之后旧 DOM 还在，直接轮询会被它骗过 —— 先等新文档进入，再等条件 */
async function reloadAndWait(expression, label, timeout = 25000) {
  await send('Page.reload')
  await sleep(2000)
  await waitFor(expression, label, timeout)
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
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发送')
  if (btn) btn.click()
  return 'ok'
})()`)

/* ---------- 3. 流式中途截图（抓光标与「停止」按钮） ---------- */
await sleep(400)
const midText = await evaluate('document.body.innerText')
const midHasStop = await evaluate(
  `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '停止')`,
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
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发送')
  if (btn) btn.click()
  return 'ok'
})()`)
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
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '停止')
  if (!btn) return 'missing'
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
  if (!target) return JSON.stringify({ version: null, indexes: [] })
  const indexes = await new Promise((res) => {
    const req = indexedDB.open('habitat-db')
    req.onsuccess = () => {
      const db = req.result
      try {
        const store = db.transaction('messages').objectStore('messages')
        res(Array.from(store.indexNames))
      } finally {
        db.close()
      }
    }
    req.onerror = () => res([])
  })
  return JSON.stringify({ version: target.version ?? null, indexes })
})()`)
const dbState = JSON.parse(dbInfo)
check('Dexie 当前为 v5（IndexedDB 版本 50）', dbState.version === 50, dbInfo)
check(
  'v3 的三元复合索引已建出',
  Array.isArray(dbState.indexes) && dbState.indexes.includes('[sessionId+createdAt+id]'),
  JSON.stringify(dbState.indexes),
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
  'html 块只给占位、不注入原文（防 XSS）',
  blocksText.includes('[html] 沙箱渲染未接入') && dom.rawBold === 0,
  `rawBold=${String(dom.rawBold)}`,
)
check(
  'widget / tab-group 明确标注未启用',
  blocksText.includes('[widget] Phase 5 接入') && blocksText.includes('[tab-group] Phase 5 接入'),
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
check(
  '首屏只加载一页（最旧的 #069 未进来）',
  page0.scrollHeight > 3000 && page0.scrollHeight < 5200 && !page0.text.includes('历史 #069'),
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
// 但真要又插进一页（60 条 ≈ +3000px）就远超容差，断言依然有效
check(
  '到底后不再重复加载（已到最早）',
  page3.scrollHeight < page2.scrollHeight * 1.15 &&
    page3.text.includes('历史 #000') &&
    page3.text.includes('历史 #009'),
  `${page2.scrollHeight} → ${page3.scrollHeight}`,
)
check('加载提示已收起', !page3.text.includes('正在加载更早的消息'))
await shot('shot-chat-paging.png')

/* ---------- 11. 换一个 / 重发 ---------- */
const sessionReroll = await newSession('换一个')
await type('换一个测试')
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发送')
  if (btn) btn.click()
  return 'ok'
})()`)
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
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '‹')
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

/* ---------- 12. 控制台 ---------- */
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 汇总：通过 ${results.length - failed.length} / ${results.length} ===`)
ws.close()
process.exit(failed.length === 0 ? 0 : 1)
