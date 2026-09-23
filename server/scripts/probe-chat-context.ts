/** Phase 3B 切片二：验证 habitat-server 真正送给 mock LLM 的 Eventide 状态卡。 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')
const MOCK = (process.env.PROBE_MOCK_ROOT ?? 'http://127.0.0.1:3334').replace(/\/+$/, '')
const EXPECT = process.env.EXPECT_EVENTIDE ?? 'injected'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

interface MockBody { body: { messages?: unknown } | null }
interface UpstreamMessage { role?: unknown; name?: unknown; content?: unknown }

console.log(`\n=== Chat context probe（expect=${EXPECT}）===`)
const original = [
  { role: 'system', content: '你是小栖。' },
  { role: 'user', content: '今天感觉怎么样？' },
]
const response = await fetch(`${SERVER}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: original }),
})
const stream = await response.text()
check('聊天 SSE 正常完成', response.ok && stream.includes('event: chat-done'), `status=${response.status}`)

const mockResponse = await fetch(`${MOCK}/__last-body`)
const mockBody = await mockResponse.json() as MockBody
const messages = Array.isArray(mockBody.body?.messages) ? mockBody.body.messages as UpstreamMessage[] : []
const cards = messages.filter((message) => message.name === 'eventide_state')

if (EXPECT === 'injected') {
  check('恰好注入一张状态卡', cards.length === 1, `cards=${cards.length}`)
  check('状态卡使用 system 角色', cards[0]?.role === 'system')
  check('状态卡正文来自 Eventide', typeof cards[0]?.content === 'string' && cards[0].content.includes('<ephemeral_state'))
  check('顺序是 persona → 状态卡 → 对话', messages[0]?.content === '你是小栖。' && messages[1]?.name === 'eventide_state' && messages[2]?.role === 'user')
  check('原始历史内容未被改写', messages.filter((message) => message.name !== 'eventide_state').map(({ role, content }) => ({ role, content })).every((item, index) => item.role === original[index]?.role && item.content === original[index]?.content))
  const current = await fetch(`${SERVER}/api/state`).then((item) => item.json()) as { snapshot?: { stateCard?: unknown } | null }
  check('聊天前 tick 已持久化快照', typeof current.snapshot?.stateCard === 'string')
} else {
  check('降级时不注入伪状态卡', cards.length === 0, `cards=${cards.length}`)
  check('降级时原始历史原样送达', messages.length === original.length && messages.every((message, index) => message.role === original[index]?.role && message.content === original[index]?.content))
}

console.log(`\n=== Chat context probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
