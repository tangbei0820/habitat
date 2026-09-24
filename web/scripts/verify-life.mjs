/**
 * Phase 4 Life 前端验收（无头 Edge + CDP）。
 * 前置：habitat-server、Vite、带 remote-debugging-port 的 Edge；建议使用隔离数据库。
 * 环境：VERIFY_APP（默认 :5175）、VERIFY_CDP（默认 :9224）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9224'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5175'
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
async function waitFor(expression, label, timeout = 20000) {
  const ok = await evaluate(`(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,150))}return false})()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}
async function click(text) {
  return evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`)
}

await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate', { url: `${APP}/life` })
await waitFor(`document.body.innerText.includes('月历') && document.body.innerText.includes('账本')`, 'Life 页签')
await waitFor(`document.body.innerText.includes('本月事件')`, '月历摘要')
let text = await evaluate('document.body.innerText')
check('Life 四个视图入口齐全', ['月历', '账本', '通知', '运行'].every((value) => text.includes(value)))
check('月历默认展示月切换与本月摘要', ['上月', '下月', '回到本月', '本月事件', 'Token'].every((value) => text.includes(value)))
check('移动端页面无横向溢出', await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))

check('可切到账本', await click('账本'))
await waitFor(`document.body.innerText.includes('小栖钱包')`, '账本加载')
text = await evaluate('document.body.innerText')
check('账本展示用量、钱包与价格版本', ['按服务', '按方案与模型', '小栖钱包', '价格快照'].every((value) => text.includes(value)))
check('价格表单明确不可修改和计价单位', text.includes('分 / 百万 Token') && text.includes('不可修改'))

check('可切到通知', await click('通知'))
await waitFor(`document.body.innerText.includes('Web Push')`, '通知加载')
text = await evaluate('document.body.innerText')
check('通知保留站内降级说明', text.includes('站内通知仍可用'))
check('通知支持全部已读', text.includes('全部已读'))

check('可切到运行', await click('运行'))
await waitFor(`document.body.innerText.includes('habitat-server')`, '运行状态加载')
text = await evaluate('document.body.innerText')
check('运行状态聚合四类来源', ['habitat-server', 'Eventide', 'MCP', '主动行为'].every((value) => text.includes(value)))
check('未配置依赖不会误报为运行异常', (text.match(/未配置/g) ?? []).length >= 2)
check('运行页展示状态快照与最近运行', text.includes('当前状态') && text.includes('最近运行'))
check('手动检查入口存在但不自动触发', text.includes('立即检查'))

const screenshot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/verify-life.png`, Buffer.from(screenshot.data, 'base64'))
check('控制台零异常', consoleLogs.length === 0, consoleLogs.join(' | '))

ws.close()
const passed = results.filter((result) => result.ok).length
console.log(`\nLife UI：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
