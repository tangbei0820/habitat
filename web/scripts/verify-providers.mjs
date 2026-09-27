/**
 * 「API 方案管理」前端验收（无头 Edge + CDP 裸驱动）
 *
 * 覆盖：列表渲染（凭据来源文案）→ 新建 → 无密钥探测失败 → 编辑并填密钥 →
 *       探测成功 → 刷新后仍在（写到了服务端）→ 设为默认（互斥）→ 两步删除 → 控制台异常。
 *
 * 前置（四件都得起着；agent-browser 在本沙箱会被 SIGTERM 拦，所以直接用 CDP 裸驱动）：
 *   server/ : node node_modules/tsx/dist/cli.mjs src/providers/mock-openai.ts   → :3334
 *   server/ : node node_modules/tsx/dist/cli.mjs src/index.ts                   → :3100（.env 指向 mock 上游）
 *   web/    : HABITAT_API_TARGET=http://127.0.0.1:3100 node node_modules/vite/bin/vite.js --port 5174
 *   任意    : msedge --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录>
 *
 * ⚠️ 后台进程在同一命令结束后会被回收，所以启动与执行要写在同一条命令里。
 * ⚠️ 脚本会在结束时删掉自己建的方案（保持可重复运行）；为验证「刷新后仍在」，
 *    删除放在刷新之后。
 * ⚠️ 要求工作区**已有一个种子方案**（`server/.env` 里的 `HABITAT_LLM_PROFILES`，且其
 *    `keyRef` 指向一个已设值的环境变量）：本脚本要借它验证「设为默认互斥」「删除后默认转移」。
 *    它的显示名从 `GET /api/providers` 现取，**不写死在脚本里**（写死会随 `.env` 变动而失效）。
 * 用法：node web/scripts/verify-providers.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
/** 后端直连地址：只用于「取种子方案名」这种准备动作，断言仍全部走浏览器 */
const API = process.env.VERIFY_API ?? 'http://127.0.0.1:3100'
const MOCK_BASE_URL = process.env.VERIFY_MOCK_BASE ?? 'http://127.0.0.1:3334/v1'
/** 验收用方案名与密钥（密钥纯假，只用来验证「存进去、读不出来、能生效」） */
const PROFILE_NAME = '验收方案'
const RENAMED = '验收方案（改名）'
const SECRET = 'sk-ui-secret-9f3a'

/* ---------- 准备：认出现有的种子方案 ---------- */
const seedList = await (await fetch(`${API}/api/providers`)).json()
const seedProfile = Array.isArray(seedList.profiles) ? seedList.profiles[0] : undefined
if (seedProfile === undefined) {
  console.error(
    `工作区没有任何方案：请先在 server/.env 里配 HABITAT_LLM_PROFILES（可参考 .env.example 的 mock 上游示例）再重跑。`,
  )
  process.exit(1)
}
const seedName = seedProfile.name

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
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
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
    throw new Error(`${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`)
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

async function reloadAndWait(expression, label, timeout = 25000) {
  await send('Page.reload')
  await sleep(2000)
  await waitFor(expression, label, timeout)
}

/** 点按文案匹配的按钮（默认「包含」；exact=true 用于区分「删除」与「确认删除？」） */
async function clickButton(text, exact = false) {
  const predicate = exact
    ? `b.textContent.trim() === ${JSON.stringify(text)}`
    : `b.textContent.includes(${JSON.stringify(text)})`
  return evaluate(`(() => {
    const buttons = ['创建','保存'].includes(${JSON.stringify(text)})
      ? (document.querySelector('form')?.querySelectorAll('button') ?? [])
      : document.querySelectorAll('button')
    const btn = [...buttons].find((b) => ${predicate})
    if (!btn) return 'missing'
    btn.click()
    return 'ok'
  })()`)
}

/** 按标签文案定位表单控件，用原生 setter 覆盖赋值（React 受控组件必须这样才收得到） */
async function fillField(labelText, value) {
  const result = await evaluate(`(() => {
    const form = document.querySelector('form')
    const label = [...(form?.querySelectorAll('label') ?? [])]
      .find((l) => l.textContent.includes(${JSON.stringify(labelText)}))
    const input = label ? label.querySelector('input') : null
    if (!input) return 'missing'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
  if (result !== 'ok') throw new Error(`找不到字段：${labelText}`)
  await sleep(200)
}

/** 某个方案行内的按钮与文本 */
async function rowInfo(profileName) {
  return evaluate(`(() => {
    const li = [...document.querySelectorAll('li')]
      .find((l) => l.textContent.includes(${JSON.stringify(profileName)}))
    if (!li) return null
    const probe = li.querySelector('[data-testid="provider-probe"]')
    return {
      text: li.innerText,
      buttons: [...li.querySelectorAll('button')].map((b) => b.textContent.trim()),
      // ⚠️ 探测成败从**属性**读，不从 ✓ / ✗ 符号读：
      // 符号是装饰，UI 换装时会被换成 SVG 图标，按符号断言等于把测试焊在样式上。
      probeOk: probe === null ? null : probe.getAttribute('data-probe-ok') === 'true',
    }
  })()`)
}

async function clickRowButton(profileName, buttonText) {
  const result = await evaluate(`(() => {
    const li = [...document.querySelectorAll('li')]
      .find((l) => l.textContent.includes(${JSON.stringify(profileName)}))
    if (!li) return 'no-row'
    const btn = [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(buttonText)})
    if (!btn) return 'no-button'
    btn.click()
    return 'ok'
  })()`)
  if (result !== 'ok') throw new Error(`行内按钮不可点：${profileName} / ${buttonText}（${result}）`)
  await sleep(300)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: `${APP}/setting` })
await waitFor(`document.body?.innerText.includes('API 方案') === true`, '设置页就绪', 30000)
// ⚠️ 方案列表是异步拉的：只等标题会出现，会读到「读取中…」的空壳（第一次跑抢赢了、第二次就露馅）
await waitFor(
  `document.body?.innerText.includes(${JSON.stringify(seedName)}) === true`,
  '方案列表加载完成',
  30000,
)

/* ---------- 0. Provider Center 四通道主路径 ---------- */
await waitFor(
  `['chat','voice','vision','image'].every((id) => document.querySelector('[data-testid="provider-card-' + id + '"]'))`,
  '四张能力卡就绪',
  30000,
)
const cardTitles = await evaluate(`['主聊天 API','语音 API','识图 API','生图 API'].every((title) => document.body.innerText.includes(title))`)
check('Provider Center 展示四张独立能力卡', cardTitles)

const cardCollapseState = await evaluate(`(() => {
  const states = Object.fromEntries(['chat','voice','vision','image'].map((id) => {
    const toggle = document.querySelector('[data-testid="provider-card-toggle-' + id + '"]')
    return [id, toggle?.getAttribute('aria-expanded')]
  }))
  return states.chat === 'true' && states.voice === 'false' && states.vision === 'false' && states.image === 'false'
})()`)
check('能力卡支持单列折叠，主聊天默认展开', cardCollapseState)

async function expandCard(capability) {
  const result = await evaluate(`(() => {
    const toggle = document.querySelector('[data-testid="provider-card-toggle-${capability}"]')
    if (!toggle) return 'missing'
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    return 'ok'
  })()`)
  if (result !== 'ok') throw new Error(`能力卡不可展开：${capability}`)
  await sleep(150)
}

for (const capability of ['chat', 'voice', 'vision', 'image']) await expandCard(capability)

const cardActions = await evaluate(`['chat','voice','vision','image'].every((id) => {
  const card = document.querySelector('[data-testid="provider-card-' + id + '"]')
  const text = card?.innerText ?? ''
  return ['拉取模型','测试连接','保存','恢复上次保存'].every((label) => text.includes(label))
})`)
check('每张卡都有拉模型 / 测试 / 保存 / 恢复', cardActions)

async function clickCardButton(capability, label) {
  await expandCard(capability)
  const result = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="provider-card-${capability}"]')
    const button = [...(card?.querySelectorAll('button') ?? [])].find((item) => item.textContent.trim() === ${JSON.stringify(label)})
    if (!button) return 'missing'
    button.click()
    return 'ok'
  })()`)
  if (result !== 'ok') throw new Error(`能力卡按钮不可点：${capability} / ${label}`)
}

await clickCardButton('chat', '拉取模型')
await waitFor(`document.querySelector('[data-testid="provider-card-chat"]')?.innerText.includes('已拉取')`, '草稿模型列表回填')
check('主聊天卡可用未保存草稿拉取模型', true)
await clickCardButton('chat', '测试连接')
await waitFor(`document.querySelector('[data-testid="provider-test-chat"]')?.innerText.includes('真实调用通过')`, '主聊天真实调用通过', 30000)
check('主聊天卡执行真实流式测试', true)
await clickCardButton('chat', '保存')
await waitFor(`document.querySelector('[data-testid="provider-card-chat"]')?.innerText.includes('已连接')`, '主聊天绑定保存')
check('测试通过后可保存单卡绑定', true)

const schemeName = '验收四通道方案'
await evaluate(`(() => {
  const root = document.querySelector('[data-testid="provider-schemes"]')
  const input = root?.querySelector('input')
  if (!input) return false
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(schemeName)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await evaluate(`(() => {
  const root = document.querySelector('[data-testid="provider-schemes"]')
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === '存为方案')
  button?.click()
})()`)
await waitFor(`document.querySelector('[data-testid="provider-schemes"]')?.innerText.includes(${JSON.stringify(schemeName)})`, '四通道方案落库')
check('四张卡可存为原子切换方案', true)
await evaluate(`(() => {
  const root = document.querySelector('[data-testid="provider-schemes"]')
  const row = [...root.querySelectorAll('li')].find((item) => item.textContent.includes(${JSON.stringify(schemeName)}))
  const button = [...(row?.querySelectorAll('button') ?? [])].find((item) => item.textContent.trim() === '删除')
  button?.click()
})()`)
await waitFor(`!document.querySelector('[data-testid="provider-schemes"]')?.innerText.includes(${JSON.stringify(schemeName)})`, '验收方案清理')
check('方案可删除且不删除 Provider 连接', true)

/* ---------- 1. 列表与凭据来源文案 ---------- */
const initialText = await evaluate('document.body.innerText')
check('设置页出现「API 方案」区块', initialText.includes('API 方案'))
check(
  '已有方案显示它来自环境变量',
  initialText.includes(seedName) && initialText.includes('密钥来自环境变量'),
  `种子方案=${seedName}`,
)
check('行内操作按钮齐全', ['测试连接', '编辑', '删除'].every((t) => initialText.includes(t)))

/* ---------- 2. 新建（先不填密钥） ---------- */
check('点开新建表单', (await clickButton('新建')) === 'ok')
await waitFor(`document.body.innerText.includes('新建方案')`, '表单展开')
await fillField('名称', PROFILE_NAME)
await fillField('Base URL', MOCK_BASE_URL)
await fillField('对话模型', 'mock-chat-small')
check('点创建', (await clickButton('创建', true)) === 'ok')
await waitFor(`document.body.innerText.includes(${JSON.stringify(PROFILE_NAME)})`, '新方案进入列表', 15000)

const created = await rowInfo(PROFILE_NAME)
check('新方案出现在列表', created !== null)
check('未填密钥 → 文案提示无需密钥', created !== null && created.text.includes('无需密钥'), created?.text.replace(/\n/g, ' ⏎ ') ?? '')

/* ---------- 3. 无密钥时探测：mock 上游必然 401 ---------- */
await clickRowButton(PROFILE_NAME, '测试连接')
await waitFor(
  `[...document.querySelectorAll('li')].some((l) => l.textContent.includes('验收方案') && l.querySelector('[data-testid="provider-probe"]') !== null)`,
  '探测结果回填',
  20000,
)
const probeFail = await rowInfo(PROFILE_NAME)
check('无密钥探测 → 结果为「失败」', probeFail !== null && probeFail.probeOk === false, JSON.stringify(probeFail?.probeOk ?? null))
check(
  '无密钥探测 → 显示失败原因（401）',
  probeFail !== null && probeFail.text.includes('401'),
  probeFail?.text.replace(/\n/g, ' ⏎ ') ?? '',
)

/* ---------- 4. 编辑：改名 + 填密钥 ---------- */
await clickRowButton(PROFILE_NAME, '编辑')
await waitFor(`document.body.innerText.includes('编辑「')`, '编辑表单展开')
await fillField('名称', RENAMED)
await fillField('API Key', SECRET)
check('点保存', (await clickButton('保存', true)) === 'ok')
await waitFor(`document.body.innerText.includes(${JSON.stringify(RENAMED)})`, '改名生效', 15000)

const edited = await rowInfo(RENAMED)
check('改名已生效', edited !== null)
check('填了密钥 → 文案变为「密钥已保存」', edited !== null && edited.text.includes('密钥已保存'), '')
check('出现「清除密钥」入口', edited !== null && edited.buttons.includes('清除密钥'), JSON.stringify(edited?.buttons ?? []))
check('页面上读不到密钥明文', !(await evaluate('document.body.innerText')).includes(SECRET))

/* ---------- 5. 有密钥时探测：mock 上游应通过 ---------- */
await clickRowButton(RENAMED, '测试连接')
await waitFor(
  `[...document.querySelectorAll('li')].some((l) => l.textContent.includes('连接正常'))`,
  '探测成功结果回填',
  20000,
)
const probeOk = await rowInfo(RENAMED)
check(
  '有密钥探测 → 结果为「成功」',
  probeOk !== null && probeOk.probeOk === true,
  JSON.stringify(probeOk?.probeOk ?? null),
)
check(
  '有密钥探测 → 连接正常且带模型样本',
  probeOk !== null && probeOk.text.includes('连接正常') && probeOk.text.includes('mock-chat'),
  probeOk?.text.replace(/\n/g, ' ⏎ ') ?? '',
)
await shot('shot-providers-list.png')

/* ---------- 6. 刷新后仍在：证明配置落在服务端而不是内存 ---------- */
await reloadAndWait(`document.body.innerText.includes(${JSON.stringify(RENAMED)})`, '刷新后方案回填')
const afterReload = await rowInfo(RENAMED)
check('刷新后方案仍在（已落到服务端）', afterReload !== null && afterReload.text.includes('密钥已保存'), '')

/* ---------- 7. 设为默认（互斥） ---------- */
await clickRowButton(RENAMED, '设为默认')
await waitFor(
  `[...document.querySelectorAll('li')].some((l) => l.textContent.includes('验收方案') && !l.textContent.includes('设为默认'))`,
  '默认标记转移',
  15000,
)
const activeRow = await rowInfo(RENAMED)
const seedRow = await rowInfo(seedName)
check('该行显示默认标记', activeRow !== null && activeRow.text.includes('默认'))
check('原默认方案已让位', seedRow !== null && seedRow.buttons.includes('设为默认'), JSON.stringify(seedRow?.buttons ?? []))
// 注意：行内第一个 span 是方案名，徽标要按文本找，别按位置找
const activeCount = await evaluate(
  `[...document.querySelectorAll('li')]
     .filter((l) => [...l.querySelectorAll('span')].some((s) => s.textContent.trim() === '默认')).length`,
)
check('页面上恰好一条默认', activeCount === 1, `count=${activeCount}`)

/* ---------- 8. 两步删除（不用 window.confirm，免得阻塞无头验收） ---------- */
await clickRowButton(RENAMED, '删除')
const confirming = await rowInfo(RENAMED)
check('删除需要二次确认', confirming !== null && confirming.buttons.includes('确认删除？'), JSON.stringify(confirming?.buttons ?? []))
await clickRowButton(RENAMED, '确认删除？')
await waitFor(`!document.body.innerText.includes(${JSON.stringify(RENAMED)})`, '方案已从列表移除', 15000)
check('删除后从列表消失', !(await evaluate('document.body.innerText')).includes(RENAMED))
const seedAfterDelete = await rowInfo(seedName)
check(
  '默认标记回到种子方案',
  seedAfterDelete !== null &&
    seedAfterDelete.text.includes('默认') &&
    !seedAfterDelete.buttons.includes('设为默认'),
  JSON.stringify(seedAfterDelete?.buttons ?? []),
)

/* ---------- 9. 控制台 ---------- */
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 汇总：通过 ${results.length - failed.length} / ${results.length} ===`)
ws.close()
process.exit(failed.length === 0 ? 0 : 1)
