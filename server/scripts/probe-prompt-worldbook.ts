/**
 * Phase 7A · Prompt / 世界书注入链路验收。
 *
 * 与 probe-chat-context 同一套打法：真发一轮对话，从 mock 上游的 `__last-body`
 * 抓服务端**实际**送出的 messages —— 管理页长得再对，注入错了也是错的。
 *
 * 运行环境（同流水线组一）：server(3237) + mock(3334)，均带独立库文件。
 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')
const MOCK = (process.env.PROBE_MOCK_ROOT ?? 'http://127.0.0.1:3334').replace(/\/+$/, '')

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

interface MockBody { body: { messages?: unknown } | null }
interface UpstreamMessage { role?: unknown; name?: unknown; content?: unknown }

async function chat(userText: string): Promise<UpstreamMessage[]> {
  const response = await fetch(`${SERVER}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: '你是小栖。' }, { role: 'user', content: userText }] }),
  })
  await response.text()
  if (!response.ok) throw new Error(`chat HTTP ${response.status}`)
  const mockResponse = await fetch(`${MOCK}/__last-body`)
  const mockBody = (await mockResponse.json()) as MockBody
  return Array.isArray(mockBody.body?.messages) ? (mockBody.body.messages as UpstreamMessage[]) : []
}

async function json(path: string, method: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${SERVER}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, data: text === '' ? null : JSON.parse(text) }
}

// 世界书选择器单测（纯函数直测，不经 HTTP）
{
  console.log('\n=== 0. selectWorldbookEntries 单测 ===')
  const { selectWorldbookEntries } = await import('../src/context/chat-context.js')
  const entry = (over: Partial<Parameters<typeof selectWorldbookEntries>[0][number]>): any => ({
    id: 'e', title: 't', content: 'c', keys: [], mode: 'always', enabled: true, sortOrder: 0, createdAt: 1, updatedAt: 1, ...over,
  })
  const one = selectWorldbookEntries([entry({})], '随便聊聊')
  check('always 条目无视对话内容恒定命中', one.picked.length === 1 && one.dropped === 0)
  const kw = selectWorldbookEntries([entry({ mode: 'keyword', keys: ['猫'] })], '我家猫今天拆家')
  check('keyword 命中', kw.picked.length === 1)
  const kwMiss = selectWorldbookEntries([entry({ mode: 'keyword', keys: ['猫'] })], '今天天气不错')
  check('keyword 未命中不注入', kwMiss.picked.length === 0)
  const caseIns = selectWorldbookEntries([entry({ mode: 'keyword', keys: ['NOCTURNE'] })], '聊聊 nocturne 记忆')
  check('匹配大小写不敏感', caseIns.picked.length === 1)
  const disabled = selectWorldbookEntries([entry({ enabled: false })], '随便')
  check('停用条目不注入', disabled.picked.length === 0)
  const order = selectWorldbookEntries(
    [entry({ id: 'b', sortOrder: 2, content: 'B'.repeat(10) }), entry({ id: 'a', sortOrder: 1, content: 'A'.repeat(10) })],
    'x',
  )
  check('按 sortOrder 排序', order.picked.map((e) => e.id).join('') === 'ab')
  const budget = selectWorldbookEntries(
    [entry({ sortOrder: 1, content: 'x'.repeat(100) }), entry({ sortOrder: 2, content: 'y'.repeat(100) })],
    'x',
    150,
  )
  check('预算内整条装入、装不下整条丢弃', budget.picked.length === 1 && budget.dropped === 1, `picked=${budget.picked.length} dropped=${budget.dropped}`)
  check('丢弃有标注', budget.text.includes('另有 1 条命中条目因注入预算被整体丢弃'))
}

// 1. 初始状态：未自定义
{
  console.log('\n=== 1. 初始：未自定义 ===')
  await json('/api/prompt/persona', 'DELETE')
  const view = await json('/api/prompt/view', 'GET')
  check('view 可读', view.status === 200)
  check('persona 未自定义', view.data.persona.customized === false && view.data.persona.content === '')
  const names = view.data.blocks.map((b: any) => b.name)
  check('view 含内置规则与能力清单', names.includes('runtime_rules') && names.includes('runtime_capabilities'))
  check('未自定义时 view 不含 persona 块', !names.includes('persona'))
  const builtinOnly = view.data.blocks.every((b: any) => b.source === 'builtin' || b.name === 'worldbook')
  check('除世界书外均为内置块', builtinOnly)
}

// 2. 保存人格 → 注入最前
{
  console.log('\n=== 2. 人格注入 ===')
  const saved = await json('/api/prompt/persona', 'PUT', { content: '你住在海边小镇，喜欢收集贝壳。' })
  check('保存成功且回显', saved.status === 200 && saved.data.customized === true)
  const messages = await chat('在吗')
  const personaIdx = messages.findIndex((m) => m.name === 'persona')
  const rulesIdx = messages.findIndex((m) => m.name === 'runtime_rules')
  check('注入 persona 块', personaIdx !== -1)
  check('内容正确', messages[personaIdx]?.content === '你住在海边小镇，喜欢收集贝壳。')
  check('位于 runtime_rules 之前', personaIdx !== -1 && rulesIdx !== -1 && personaIdx < rulesIdx)
  check('仍在原有 system 消息之后（不抢前端人格）', messages[0]?.name === undefined && messages[0]?.content === '你是小栖。')
  const view = await json('/api/prompt/view', 'GET')
  check('view 显示已自定义', view.data.persona.customized === true)
  check('view 含 persona 块且标记 custom', view.data.blocks.some((b: any) => b.name === 'persona' && b.source === 'custom'))
}

// 3. 世界书
{
  console.log('\n=== 3. 世界书 ===')
  const kwEmpty = await json('/api/worldbook', 'POST', { title: '死条目', content: 'x', keys: [], mode: 'keyword' })
  check('keyword 无关键词被拒收', kwEmpty.status === 400, `status=${kwEmpty.status}`)
  const always = await json('/api/worldbook', 'POST', {
    title: '世界设定', content: '这个世界魔法是公开的。', keys: [], mode: 'always', sortOrder: 1,
  })
  check('always 条目创建成功', always.status === 201, `status=${always.status}`)
  const cat = await json('/api/worldbook', 'POST', {
    title: '猫设定', content: '小栖养了一只叫年糕的猫。', keys: ['猫', '年糕'], mode: 'keyword', sortOrder: 2,
  })
  check('keyword 条目创建成功', cat.status === 201)

  let messages = await chat('今天天气怎么样')
  let wb = messages.find((m) => m.name === 'worldbook')
  check('未命中时仍注入 always 条目', typeof wb?.content === 'string' && wb.content.includes('魔法是公开的'))
  check('未命中的 keyword 条目不出现', typeof wb?.content !== 'string' || !wb.content.includes('年糕'))

  messages = await chat('说说你家猫')
  wb = messages.find((m) => m.name === 'worldbook')
  check('命中后 keyword 条目注入', typeof wb?.content === 'string' && wb.content.includes('年糕'))
  const personaIdx = messages.findIndex((m) => m.name === 'persona')
  const wbIdx = messages.findIndex((m) => m.name === 'worldbook')
  const rulesIdx = messages.findIndex((m) => m.name === 'runtime_rules')
  check('注入序：persona → worldbook → runtime_rules', personaIdx < wbIdx && wbIdx < rulesIdx)

  const toggled = await json(`/api/worldbook/${cat.data.id}`, 'PUT', { enabled: false })
  check('停用生效', toggled.status === 200 && toggled.data.enabled === false)
  messages = await chat('说说你家猫')
  wb = messages.find((m) => m.name === 'worldbook')
  check('停用后不再注入', typeof wb?.content !== 'string' || !wb.content.includes('年糕'))

  const list = await json('/api/worldbook', 'GET')
  check('列表按 sortOrder 排序', list.data.entries.map((e: any) => e.title).join(',') === '世界设定,猫设定')

  const removed = await json(`/api/worldbook/${cat.data.id}`, 'DELETE')
  check('删除成功', removed.status === 200)
  const gone = await json(`/api/worldbook/${cat.data.id}`, 'GET')
  check('删除后 404', gone.status === 404)
}

// 4. 恢复默认
{
  console.log('\n=== 4. 恢复默认 ===')
  const cleared = await json('/api/prompt/persona', 'DELETE')
  check('清空成功', cleared.status === 200 && cleared.data.customized === false)
  const messages = await chat('在吗')
  check('清空后不注入 persona', !messages.some((m) => m.name === 'persona'))
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`)
if (failed > 0) process.exit(1)
