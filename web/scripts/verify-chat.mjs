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

/* ---------- 7. IndexedDB 版本 ---------- */
const dbInfo = await evaluate(`(async () => JSON.stringify(await indexedDB.databases()))()`)
// Dexie 把声明的版本号 ×10 用作 IndexedDB 版本，所以 v2 → 20
check('Dexie 已升到 v2', dbInfo.includes('"version":20'), dbInfo)

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

/* ---------- 9. 控制台 ---------- */
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 汇总：通过 ${results.length - failed.length} / ${results.length} ===`)
ws.close()
process.exit(failed.length === 0 ? 0 : 1)
