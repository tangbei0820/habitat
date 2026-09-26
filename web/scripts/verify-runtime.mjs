/**
 * Phase 7A · Runtime Surfaces 前端验收（Prompt / 世界书 / Nocturne 记忆页 / Eventide 状态页）。
 *
 * 前置：habitat-server(3100，无 Nocturne / 无 Eventide sidecar) + Vite + CDP Edge。
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）、VERIFY_API（默认同 VERIFY_APP）。
 *
 * ⚠️ 服务器没接 Nocturne / Eventide —— 这**正是**要验的两种诚实状态：
 *    记忆页显示「未配置」且不崩、Eventide 页显示「还没有快照」。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const API = process.env.VERIFY_API ?? APP
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })
const results = []
const consoleLogs = []
function check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` → ${detail}` : ''}`) }

const targets = await (await fetch(`${CDP}/json/new?url=${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
if (!targets.webSocketDebuggerUrl) throw new Error(`开专用 tab 失败：${JSON.stringify(targets)}`)
const ws = new WebSocket(targets.webSocketDebuggerUrl)
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
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
    throw new Error(`页面执行异常：${detail}`)
  }
  return result.result.value
}
async function waitFor(expression, label, timeout = 20000) {
  const ok = await evaluate(`(async()=>{const end=Date.now()+${timeout};while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,150))}return false})()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}
async function navigate(path, waitExpr, label) {
  await send('Page.navigate', { url: `${APP}${path}` })
  await waitFor(waitExpr, label)
}
/** 等世界书页所有操作按钮退出 disabled（busy 复位）—— 否则下一次点击会被静默吞掉 */
async function waitForIdle(label = '操作按钮恢复可用') {
  await waitFor(`[...document.querySelectorAll('[data-testid="wb-item"] button')].every((b) => !b.disabled)`, label)
}
/** 清掉本脚本创建的条目（按 id），不留垃圾给别的脚本与下一轮 */
const createdIds = []
async function cleanupEntries() {
  for (const entryId of createdIds) {
    await fetch(`${API}/api/worldbook/${entryId}`, { method: 'DELETE' }).catch(() => {})
  }
  await fetch(`${API}/api/prompt/persona`, { method: 'DELETE' }).catch(() => {})
}

await send('Runtime.enable')
await send('Page.enable')
await new Promise((resolve) => setTimeout(resolve, 600))
consoleLogs.length = 0

try {
  /* ============ 1. 设置页 · 人格 Prompt ============ */
  await navigate('/setting', `document.querySelector('[data-testid="prompt-group"]') !== null`, '设置页出 Prompt 区')

  const personaRow = await evaluate(`document.querySelector('[data-testid="prompt-group"]').parentElement.innerText`)
  check('人格区显示未自定义初值', personaRow.includes('未自定义'), personaRow.slice(0, 80))

  await evaluate(`document.querySelector('[data-testid="persona-edit-open"]').click()`)
  await waitFor(`document.querySelector('[data-testid="persona-input"]') !== null`, '人格编辑器展开')
  await evaluate(`
    (() => {
      const input = document.querySelector('[data-testid="persona-input"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '你住在海边小镇，喜欢收集贝壳。')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await evaluate(`document.querySelector('[data-testid="persona-save"]').click()`)
  await waitFor(`document.querySelector('[data-testid="prompt-group"]').parentElement.innerText.includes('已自定义')`, '保存后显示已自定义')

  // 服务端真值比对：保存必须真的落到 server（Runtime 在服务端读它）
  const viewSaved = await (await fetch(`${API}/api/prompt/view`)).json()
  check('人格保存已落服务端', viewSaved.persona.customized === true && viewSaved.persona.content.includes('海边小镇'), JSON.stringify(viewSaved.persona).slice(0, 120))
  check('view 的 blocks 里 persona 标记为 custom', viewSaved.blocks.some((b) => b.name === 'persona' && b.source === 'custom'), '')
  check('view 含内置运行规则块（只读透明）', viewSaved.blocks.some((b) => b.name === 'runtime_rules' && b.source === 'builtin' && b.content.includes('运行环境')), '')

  await evaluate(`document.querySelector('[data-testid="prompt-view-open"]').click()`)
  await waitFor(`document.querySelector('[data-testid="prompt-blocks"]') !== null`, '本轮 Prompt 查看展开')
  const blockNames = await evaluate(`[...document.querySelectorAll('[data-testid^="prompt-block-"]')].map((n) => n.dataset.testid.replace('prompt-block-',''))`)
  check('查看面板按注入序列出全部块', ['persona', 'runtime_rules', 'runtime_capabilities', 'nocturne_memory', 'runtime_events', 'eventide_state'].every((n) => blockNames.includes(n)), JSON.stringify(blockNames))

  await evaluate(`document.querySelector('[data-testid="prompt-view-open"]').click()`)
  await evaluate(`document.querySelector('[data-testid="persona-edit-open"]').click()`)
  await waitFor(`document.querySelector('[data-testid="persona-reset"]') !== null`, '已自定义时出现恢复默认')
  await evaluate(`document.querySelector('[data-testid="persona-reset"]').click()`)
  await waitFor(`document.querySelector('[data-testid="prompt-group"]').parentElement.innerText.includes('未自定义')`, '恢复默认后回到未自定义')
  const viewCleared = await (await fetch(`${API}/api/prompt/view`)).json()
  check('恢复默认已清空服务端人格', viewCleared.persona.customized === false, '')

  /* ============ 2. 世界书管理页 ============ */
  await evaluate(`document.querySelector('[data-testid="worldbook-open"]').click()`)
  await waitFor(`location.pathname === '/setting/worldbook'`, '路由进入世界书页')
  await waitFor(`document.querySelector('[data-testid="worldbook-list"]') !== null`, '世界书列表挂载')

  const emptyText = await evaluate(`document.querySelector('[data-testid="worldbook-empty"]')?.innerText ?? ''`)
  check('无条目时显示诚实空态', emptyText.includes('还没有任何条目'), emptyText)

  // keyword 无关键词 → 服务端拒收，页面显示错误且不产生条目
  await evaluate(`document.querySelector('[data-testid="wb-create"]').click()`)
  await waitFor(`document.querySelector('[data-testid="wb-form"]') !== null`, '表单展开')
  for (const [testid, value] of [['wb-input-title', '死条目'], ['wb-input-content', '这条不该被保存']]) {
    await evaluate(`
      (() => {
        const input = document.querySelector('[data-testid="${testid}"]')
        // ⚠️ content 是 textarea：value setter 必须取对原型，取错原生方法会 Illegal invocation
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
        setter.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()
    `)
  }
  await evaluate(`document.querySelector('[data-testid="wb-save"]').click()`)
  await waitFor(`document.querySelector('[data-testid="worldbook-error"]') !== null`, 'keyword 无关键词的报错出现')
  const rejectText = await evaluate(`document.querySelector('[data-testid="worldbook-error"]').innerText`)
  check('keyword 无关键词被拒收且说明原因', rejectText.includes('触发关键词'), rejectText)
  await evaluate(`document.querySelector('[data-testid="wb-cancel"]').click()`)

  // 建一条 always
  async function fillForm({ title, content, keys = null, mode = 'always', sort = '0' }) {
    await evaluate(`document.querySelector('[data-testid="wb-create"]').click()`)
    await waitFor(`document.querySelector('[data-testid="wb-form"]') !== null`, '表单展开')
    for (const [testid, value] of [['wb-input-title', title], ['wb-input-content', content], ...(keys !== null ? [['wb-input-keys', keys]] : [])]) {
      await evaluate(`
        (() => {
          const input = document.querySelector('[data-testid="${testid}"]')
          // ⚠️ content 是 textarea：value setter 必须取对原型，取错原生方法会 Illegal invocation
          const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
          const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
          setter.call(input, ${JSON.stringify(value)})
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()
      `)
    }
    await evaluate(`document.querySelector('[data-testid="wb-mode-${mode}"]').click()`)
    await evaluate(`
      (() => {
        const input = document.querySelector('[data-testid="wb-input-sort"]')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, ${JSON.stringify(sort)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()
    `)
    await evaluate(`document.querySelector('[data-testid="wb-save"]').click()`)
    await waitFor(`document.querySelector('[data-testid="wb-form"]') === null`, '保存后表单收起')
    await waitForIdle()
  }

  await fillForm({ title: '世界设定', content: '这个世界魔法是公开的。', mode: 'always', sort: '1' })
  await waitFor(`document.querySelectorAll('[data-testid="wb-item"]').length === 1`, 'always 条目入列')
  const created = await (await fetch(`${API}/api/worldbook`)).json()
  check('条目真实落到服务端', created.entries.length === 1 && created.entries[0].mode === 'always', JSON.stringify(created.entries.map((e) => e.title)))
  createdIds.push(created.entries[0].id)

  await fillForm({ title: '猫设定', content: '小栖养了一只叫年糕的猫。', keys: '猫、年糕', mode: 'keyword', sort: '2' })
  await waitFor(`document.querySelectorAll('[data-testid="wb-item"]').length === 2`, 'keyword 条目入列')
  const created2 = await (await fetch(`${API}/api/worldbook`)).json()
  const catEntry = created2.entries.find((e) => e.title === '猫设定')
  check('keyword 条目带触发词落服务端', catEntry !== undefined && JSON.stringify(catEntry.keys) === JSON.stringify(['猫', '年糕']), JSON.stringify(catEntry?.keys))
  createdIds.push(catEntry.id)

  // 启停
  await evaluate(`
    (() => {
      const items = [...document.querySelectorAll('[data-testid="wb-item"]')]
      const cat = items.find((n) => n.querySelector('[data-testid="wb-title"]').innerText.includes('猫设定'))
      cat.querySelector('[data-testid="wb-toggle"]').click()
      return true
    })()
  `)
  await waitFor(
    `(async () => { const r = await (await fetch('${API}/api/worldbook')).json(); return r.entries.find((e) => e.title === '猫设定')?.enabled === false })()`,
    '停用落到服务端',
  )
  // ⚠️ 服务端状态先于页面 busy 解除可见 —— 忙等里点禁用按钮会被静默吞掉。
  //    先等页面所有操作按钮回到可用（busy 复位），再做下一步点击。
  await waitFor(`[...document.querySelectorAll('[data-testid="wb-item"] button')].every((b) => !b.disabled)`, '页面操作按钮恢复可用')

  // 编辑
  await evaluate(`
    (() => {
      const items = [...document.querySelectorAll('[data-testid="wb-item"]')]
      const cat = items.find((n) => n.querySelector('[data-testid="wb-title"]').innerText.includes('猫设定'))
      cat.querySelector('[data-testid="wb-edit"]').click()
      return true
    })()
  `)
  await waitFor(`document.querySelector('[data-testid="wb-form"]') !== null`, '编辑表单展开')
  await evaluate(`
    (() => {
      const input = document.querySelector('[data-testid="wb-input-content"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '小栖养了一只叫汤圆的猫。')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await evaluate(`document.querySelector('[data-testid="wb-save"]').click()`)
  await waitFor(`document.querySelector('[data-testid="wb-form"]') === null`, '编辑保存收起')
  const edited = await (await fetch(`${API}/api/worldbook`)).json()
  check('编辑真实生效', edited.entries.some((e) => e.content.includes('汤圆')), '')

  // 删除
  await evaluate(`
    (() => {
      const items = [...document.querySelectorAll('[data-testid="wb-item"]')]
      const cat = items.find((n) => n.querySelector('[data-testid="wb-title"]').innerText.includes('猫设定'))
      cat.querySelector('[data-testid="wb-delete"]').click()
      return true
    })()
  `)
  await waitFor(`document.querySelectorAll('[data-testid="wb-item"]').length === 1`, '删除后只剩一条')
  await waitForIdle()
  const afterDelete = await (await fetch(`${API}/api/worldbook`)).json()
  check('删除已落服务端', afterDelete.entries.length === 1 && afterDelete.entries[0].title === '世界设定', '')

  /* ============ 3. 记忆页（Nocturne 未配置的诚实态） ============ */
  await navigate('/llm', `document.querySelector('[data-testid="llm-summary"]') !== null`, '档案页出结果')
  const memoryCard = await evaluate(`(() => { const n = document.querySelector('[data-testid="llm-module-memory"]'); return n ? { tag: n.tagName, href: n.getAttribute('href') } : null })()`)
  check('记忆模块卡现在可点且指向 /llm/memory', memoryCard !== null && memoryCard.tag === 'A' && memoryCard.href === '/llm/memory', JSON.stringify(memoryCard))
  await evaluate(`document.querySelector('[data-testid="llm-module-memory"]').click()`)
  await waitFor(`location.pathname === '/llm/memory'`, '进入记忆页')
  await waitFor(`document.querySelector('[data-testid="memory-health"]') !== null`, '健康卡挂载')
  const healthText = await evaluate(`document.querySelector('[data-testid="memory-health"]').innerText`)
  check('Nocturne 未配置时诚实显示', healthText.includes('未配置'), healthText.slice(0, 80))
  await waitFor(`document.querySelector('[data-testid="memory-boot-hint"]') !== null`, '未配置的记忆全文提示出现')
  const bootHint = await evaluate(`document.querySelector('[data-testid="memory-boot-hint"]').innerText`)
  check('未配置时给降级说明（不发必败请求）', bootHint.includes('未就绪') && bootHint.includes('不影响聊天'), bootHint.slice(0, 80))
  // 搜索：未就绪时点击给可读反馈，不打接口
  await evaluate(`
    (() => {
      const input = document.querySelector('[data-testid="memory-search-input"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '海边')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await evaluate(`document.querySelector('[data-testid="memory-search-run"]').click()`)
  await waitFor(`document.querySelector('[data-testid="memory-search-error"]') !== null`, '搜索给出可读反馈')
  const searchErr = await evaluate(`document.querySelector('[data-testid="memory-search-error"]').innerText`)
  check('搜索在未配置下说明原因', searchErr.includes('未就绪'), searchErr)

  /* ============ 4. Eventide 状态页（无 sidecar 的诚实态） ============ */
  await navigate('/life?tab=runtime', `document.body.innerText.includes('habitat-server')`, '运行视图挂载')
  await waitFor(`document.querySelector('[data-testid="eventide-open"]') !== null`, '状态详情入口出现')
  await evaluate(`document.querySelector('[data-testid="eventide-open"]').click()`)
  await waitFor(`location.pathname === '/life/eventide'`, '进入 Eventide 页')
  await waitFor(`document.querySelector('[data-testid="eventide-empty"]') !== null || document.querySelector('[data-testid="eventide-summary"]') !== null`, 'Eventide 页出结果')
  const eventideState = await evaluate(`(() => ({ empty: document.querySelector('[data-testid="eventide-empty"]')?.innerText ?? null }))()`)
  check('无 sidecar 时显示诚实空态', eventideState.empty !== null && eventideState.empty.includes('还没有任何状态快照'), JSON.stringify(eventideState))
} finally {
  await cleanupEntries()
  try {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${OUT}/verify-runtime.png`, Buffer.from(screenshot.data, 'base64'))
  } catch { /* 截图失败不影响验收结论 */ }
  try { await fetch(`${CDP}/json/close/${targets.id}`) } catch { /* 收尾 tab */ }
  ws.close()
}

const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

const passed = results.filter((result) => result.ok).length
console.log(`\nRuntime Surfaces：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
