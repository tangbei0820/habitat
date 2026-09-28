/**
 * Phase 6 · 导入导出增强验收（无头 Edge + CDP 裸驱动）
 *
 * 覆盖三件新增的东西：
 *   ① 单会话导出（Markdown / JSON）—— 入口在聊天设置面板里
 *   ② 「上次导出」记录与久未导出提醒
 *   ③ 导入前的覆盖警告（导入是整体替换，不可逆）
 *
 * 前置（与 run-front-verify.sh 组一相同）：
 *   server:3100（.env 指向 mock 上游）+ mock:3334 + vite:5174 + 无头 Edge:9222
 * 环境变量：VERIFY_CDP（默认 :9222）、VERIFY_APP（默认 :5174）
 * 用法：node web/scripts/verify-export.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })
/** 塞给文件选择框的假备份：只验「选完之后有没有警告」，不会被真正导入，所以内容随意 */
const FAKE_BACKUP = `${OUT}/fake-backup.json`
writeFileSync(FAKE_BACKUP, JSON.stringify({ format: 'habitat-backup', version: 8, sessions: [], messages: [] }))

const results = []
const consoleLogs = []
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
      consoleLogs.push(`[${type}] ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`)
    }
  } else if (message.method === 'Runtime.exceptionThrown') {
    consoleLogs.push(`[exception] ${message.params.exceptionDetails.text}`)
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
  const ok = await evaluate(
    `(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){try{if(await (${expression}))return true}catch{}await new Promise(r=>setTimeout(r,150))}return false})()`,
  )
  if (!ok) throw new Error(`等待超时：${label}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function clickSelector(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'ok' })()`)
}
async function clickContains(text) {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button')].find((x) => (x.textContent ?? '').includes(${JSON.stringify(text)}))
    if (!el) return 'missing'
    el.click()
    return 'ok'
  })()`)
}
async function textOf(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? null : el.innerText })()`)
}
async function exists(selector) {
  return evaluate(`document.querySelector(${JSON.stringify(selector)}) !== null`)
}
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

await send('Runtime.enable')
await send('Page.enable')
await send('DOM.enable')
await send('Network.enable')
// 前置条件：本脚本整条链路都要求联网（要真发消息、要拉方案列表）。
// 归位后立刻确认一次，免得真断网时把锅算到本脚本要验的功能头上。
// 不需要去「恢复」网络：实测 CDP 会话一断开，上一会话设的断网覆盖就自动失效，
// 重连后 navigator.onLine 本来就是 true（开 Network 域只是为了读状态、留个把柄）。
check('开工前浏览器处于联网状态', (await evaluate('navigator.onLine')) === true, String(await evaluate('navigator.onLine')))
// 导出会真的触发浏览器下载；指到工程内的临时目录，别落到用户自己的下载文件夹
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: false })
  .catch(() => undefined)

// ⚠️ Runtime.enable 会把**上一个 CDP 会话**留下的 console 消息重放一遍（已实测确认）。
//    后果很隐蔽：同一条流水线上前一支脚本（verify-offline 断网阶段）打过的
//    console.error 会被本脚本原样收走，于是「控制台零异常」必然误报成 FAIL ——
//    而它跟本脚本要验的导入导出毫无关系。
//    等重放投递完再清空，让这条断言只对本脚本自己的运行负责。
await sleep(600)
consoleLogs.length = 0

// ⚠️ 直达 /chat：根路径在「本次会话还没进过」时会先落到欢迎页，等不到聊天列表。
//    以前这里导航到根路径能过，是因为上游 verify-shell 恰好留下了「已进入」标记 ——
//    那属于隐性依赖脚本执行顺序，单跑或换顺序就会挂。
await send('Page.navigate', { url: `${APP}/chat` })
await waitFor('document.body.innerText.includes("新建")', '聊天列表挂载')
// 本条验收要证明「从未做过全量备份」时的初始状态；不能继承人工使用或上一轮验收留下的设备级时间戳。
await evaluate(`localStorage.removeItem('habitat:last-export-at')`)

/* ---------- 一、造一段真对话（导出要有内容，才能验到条数） ---------- */
await clickContains('新建')
await waitFor('location.pathname.startsWith("/chat/") && location.pathname.length > 6', '进入会话窗口')
// ⚠️ 新建会话是异步的：路由变了不等于输入框已挂载。少了这一步，setValue 会**静默**
//    返回 'missing' → 草稿是空的 → 发送按钮一直禁用 → 后面的等待白等 30 秒才超时，
//    而且报错信息完全指不到真正的原因。所以既等挂载，也断言写入结果。
await waitFor('document.querySelector(\'[data-testid="composer"]\') !== null', '输入框就绪')
const typed = await setValue('[data-testid="composer"]', '导出验收用的消息')
check('输入框可写入草稿', typed === '导出验收用的消息', String(typed))
await clickSelector('[data-testid="send"]')
// 分两步等：先确认「发」这个动作真的发生了（用户消息落地），再等上游回复。
// 合成一步的话，超时了也分不清是没发出去还是 mock 上游慢。
await waitFor('document.body.innerText.includes("导出验收用的消息")', '用户消息落地')
await waitFor('document.body.innerText.includes("流式回复")', 'AI 回复落地', 30000)
check('已备好一段两轮的对话', (await evaluate('document.querySelectorAll("[data-message-id]").length')) >= 2)

/* ---------- 二、单会话导出（聊天设置面板里） ---------- */
// ⚠️ 顶栏按钮换皮后是纯图标（无文案），别按「设置」两个字找 —— 按图标按钮的 testid 点
await clickSelector('[data-testid="chat-settings-open"]')
await waitFor('document.querySelector(\'[data-testid="chat-settings-sheet"]\') !== null', '聊天设置打开')
check('聊天设置里有「导出这段对话」', (await textOf('[data-testid="chat-settings-sheet"]')).includes('导出这段对话'))
check('提供 Markdown 与 JSON 两种导出', await exists('[data-testid="chat-export-markdown"]') && await exists('[data-testid="chat-export-json"]'))

await clickSelector('[data-testid="chat-export-markdown"]')
await waitFor('document.querySelector(\'[data-testid="chat-export-message"]\') !== null', 'Markdown 导出结果', 10000)
const mdMessage = await textOf('[data-testid="chat-export-message"]')
check('导出 Markdown 给出成功回执', mdMessage.includes('已导出'), mdMessage)
check('回执里带上消息条数（不是空话）', /共 \d+ 条消息/.test(mdMessage), mdMessage)

await clickSelector('[data-testid="chat-export-json"]')
await waitFor(`document.querySelector('[data-testid="chat-export-message"]').innerText.includes("已导出")`, 'JSON 导出结果', 10000)
check('导出 JSON 同样给出成功回执', (await textOf('[data-testid="chat-export-message"]')).includes('已导出'))

await clickSelector('[aria-label="关闭聊天设置"]')
await waitFor('document.querySelector(\'[data-testid="chat-settings-sheet"]\') === null', '关闭聊天设置')

/* ---------- 三、备份区块：上次导出与久未导出提醒 ---------- */
// 会话窗口是沉浸式的（隐藏底部导航），先回列表才点得到 Setting
await clickSelector('a[href="/chat"]')
await waitFor('location.pathname === "/chat"', '回列表')
await clickSelector('a[href="/setting"]')
await waitFor('location.pathname === "/setting"', '设置页打开')
await waitFor('document.querySelector(\'[data-testid="backup-last-export"]\') !== null', '备份区块渲染')

const beforeText = await textOf('[data-testid="backup-last-export"]')
// ⚠️ 单会话导出**不该**算作「备份过了」—— 它不含日记/相册/账本，拿它当备份是错觉
check('单会话导出不更新「上次导出备份」', beforeText.includes('还没有导出过备份'), beforeText)
check('本地有数据但从未备份时给出提醒', await exists('[data-testid="backup-stale-hint"]'))

await clickSelector('[data-testid="backup-export"]')
await waitFor(`document.querySelector('[data-testid="backup-last-export"]').innerText.includes("今天")`, '导出后记录时间', 10000)
check('导出备份后记下「上次导出：今天」', true, await textOf('[data-testid="backup-last-export"]'))
await sleep(400)
check('刚导出过就不再提醒', (await exists('[data-testid="backup-stale-hint"]')) === false)

/* ---------- 三b、备份 v10：第 6 批两张表必须进备份（T-046） ---------- */
// 走 db 层直接种一行时长 + 一条任务，再 exportAll → importAll 往返，证明「进得去也回得来」。
// 不走 UI 下载按钮：那是浏览器下载目录的事，断言不到内容。
{
  const roundtrip = await evaluate(`(async () => {
    const dbm = await import('/src/db/db.ts')
    const backupLib = await import('/src/lib/backup.ts')
    const now = Date.now()
    await dbm.db.listenSessions.put({ id: 'music:2026-09-25', kind: 'music', dayKey: '2026-09-25', seconds: 95, updatedAt: now, createdAt: now })
    await dbm.db.studyTasks.put({ id: 'task-verify-roundtrip', dayKey: '2026-09-25', label: '验收往返任务', done: false, createdAt: now })
    await dbm.db.studyCards.put({ id: 'study-card-verify-roundtrip', type: 'study-card', subject: '英语', front: 'hello', back: '你好', example: 'Hello there.', hint: '打招呼', source: 'ai', dueOn: '2026-09-25', intervalDays: 1, ease: 2.5, repetitions: 0, lastReviewedAt: null, createdAt: now, updatedAt: now })
    const backup = await backupLib.exportAll()
    const exported = { version: backup.version, listen: backup.listenSessions.length, tasks: backup.studyTasks.length, cards: backup.studyCards.length }
    await backupLib.importAll(backup)
    const listenRow = await dbm.db.listenSessions.get('music:2026-09-25')
    const taskRow = await dbm.db.studyTasks.get('task-verify-roundtrip')
    const cardRow = await dbm.db.studyCards.get('study-card-verify-roundtrip')
    const msgCount = await dbm.db.messages.count()
    return { ...exported, listenOk: listenRow !== undefined && listenRow.seconds === 95, taskOk: taskRow !== undefined && taskRow.label === '验收往返任务', cardOk: cardRow !== undefined && cardRow.front === 'hello', msgCount }
  })()`)
  check('备份格式已升 v13', roundtrip.version === 13, `v${roundtrip.version}`)
  check('一起听时长进了备份', roundtrip.listen >= 1 && roundtrip.listenOk, `listenSessions ${roundtrip.listen} 条`)
  check('学习任务进了备份', roundtrip.tasks >= 1 && roundtrip.taskOk, `studyTasks ${roundtrip.tasks} 条`)
  check('AI 伴学卡片进了备份', roundtrip.cards >= 1 && roundtrip.cardOk, `studyCards ${roundtrip.cards} 条`)
  check('v11 往返导入不丢既有数据（消息还在）', roundtrip.msgCount >= 2, `${roundtrip.msgCount} 条消息`)
}

/* ---------- 四、导入前的覆盖警告 ---------- */
// ⚠️ 设置页有多个 input[type=file]（身份区头像上传 + 备份导入），必须点名备份这一个
const doc = await send('DOM.getDocument')
const queried = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type="file"][data-testid="backup-import-file"]' })
if (queried.nodeId === 0) throw new Error('找不到备份文件选择框')
await send('DOM.setFileInputFiles', { nodeId: queried.nodeId, files: [FAKE_BACKUP] })

await waitFor('document.querySelector(\'[data-testid="backup-import-warning"]\') !== null', '覆盖警告出现', 10000)
const warnText = await textOf('[data-testid="backup-import-warning"]')
check('选中备份文件后出现覆盖警告', true)
check('警告说明「整体覆盖」且不可撤销', warnText.includes('整体覆盖') && warnText.includes('不可撤销'), warnText.replace(/\n/g, ' '))
check('警告旁直接给了「先导出一份」的入口', warnText.includes('先导出一份'))

await clickSelector('[data-testid="backup-import-cancel"]')
await waitFor('document.querySelector(\'[data-testid="backup-import-warning"]\') === null', '取消后警告消失', 8000)
check('取消选择后警告一并收起', true)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/verify-export.png`, Buffer.from(shot.data, 'base64'))

check('控制台零异常', consoleLogs.length === 0, consoleLogs.slice(0, 4).join(' | '))

ws.close()
const passed = results.filter((result) => result.ok).length
console.log(`\n导入导出增强：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
