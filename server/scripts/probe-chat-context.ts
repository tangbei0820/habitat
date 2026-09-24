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

/**
 * 服务端自己注入的 system 段（Phase 6.5 起不止状态卡）。
 *
 * ⚠️ 2026-09-24 更新：原先这里断言的是「persona → 状态卡 → 对话」这种**绝对下标**，
 * 而 Phase 6.5 在状态卡之前插入了恒定规则段与能力清单段 —— 那是**设计变更**，不是回归。
 * 断言改成「按名字认出注入段、只看剩下那部分的顺序」，这样以后再加一段也不用改这条。
 */
const INJECTED_NAMES = ['runtime_rules', 'runtime_capabilities', 'nocturne_memory', 'eventide_state']
const isInjected = (message: UpstreamMessage): boolean =>
  typeof message.name === 'string' && INJECTED_NAMES.includes(message.name)

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
const conversation = messages.filter((message) => !isInjected(message))

if (EXPECT === 'injected') {
  check('恰好注入一张状态卡', cards.length === 1, `cards=${cards.length}`)
  check('状态卡使用 system 角色', cards[0]?.role === 'system')
  check('状态卡正文来自 Eventide', typeof cards[0]?.content === 'string' && cards[0].content.includes('<ephemeral_state'))
  check('人格仍在最前（最高优先级）', messages[0]?.content === '你是小栖。')

  // 恒定两段（Phase 6.5）：规则 + 能力清单。它们在状态卡**之前** ——
  // 能力清单必须早于任何工具调用，否则模型决定要不要调工具时还不知道有什么。
  const names = messages.map((message) => message.name)
  check('注入了运行规则段', names.includes('runtime_rules'))
  check('注入了能力清单段', names.includes('runtime_capabilities'))
  check(
    '顺序：规则 → 能力 → 状态卡',
    names.indexOf('runtime_rules') < names.indexOf('runtime_capabilities') &&
      names.indexOf('runtime_capabilities') < names.indexOf('eventide_state'),
    names.filter(Boolean).join(' → '),
  )
  const capabilityCard = messages.find((message) => message.name === 'runtime_capabilities')
  check(
    '能力清单非空且是「当前可用能力」那一节',
    typeof capabilityCard?.content === 'string' && capabilityCard.content.includes('# 当前可用能力'),
  )
  check(
    '能力清单不含任何未启用的能力（不伪造）',
    !String(capabilityCard?.content).includes('diary.create') &&
      !String(capabilityCard?.content).includes('messageboard.write'),
  )

  check('对话部分与原始历史逐条一致', conversation.length === original.length && conversation.every((message, index) => message.role === original[index]?.role && message.content === original[index]?.content))
  const current = await fetch(`${SERVER}/api/state`).then((item) => item.json()) as { snapshot?: { stateCard?: unknown } | null }
  check('聊天前 tick 已持久化快照', typeof current.snapshot?.stateCard === 'string')
} else {
  check('降级时不注入伪状态卡', cards.length === 0, `cards=${cards.length}`)
  // 恒定段（规则 / 能力清单）**不受 Eventide 影响**，降级时依然在 —— 只清理掉状态卡
  check('降级时对话部分仍原样送达', conversation.length === original.length && conversation.every((message, index) => message.role === original[index]?.role && message.content === original[index]?.content))
}

console.log(`\n=== Chat context probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
