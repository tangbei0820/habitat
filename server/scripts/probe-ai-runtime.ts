/**
 * Phase 6.5 · AI Runtime Integration 验收（P0：能力注册 / 运行时上下文 / 工具绑定 / 工具认知）
 *
 * 前置：
 *   1) cd server && MOCK_MCP_PORT=3333 npm run dev:mock-mcp
 *   2) cd server && npm run dev:mock-openai            # mock 上游 :3334
 *   3) cd server && MCP_NOCTURNE_URL=http://127.0.0.1:3333/mcp PORT=3100 \
 *        HABITAT_DB_PATH=./data/probe-runtime.db npm run dev
 *   4) cd server && PROBE_SERVER=http://127.0.0.1:3100 npx tsx scripts/probe-ai-runtime.ts
 *
 * 覆盖北北验收清单里 P0 的四条：
 *   · 能力：AI 能列出**真实**可用能力；不声称拥有未启用能力
 *   · 工具：调用成功后，**下一轮**（同一轮内的续跑）AI 知道自己刚调了什么；失败也能正确收到
 *   · 状态：摘要可读，任何地方都不出现 `[object Object]`
 *   · 认知：工具调用的**结果**确实回到了模型上下文（不是只发给前端看一眼）
 *
 * ⚠️ 本脚本自己新建一个临时 LLM 方案并在结束时删掉，可重复运行。
 * 退出码非 0 表示有断言失败。
 */
import type { CapabilitySnapshot } from '@shared/capabilities'
import type { ApiProfilePublic, BodyStateSnapshot } from '@shared/types'
import type { ChatToolCallPayload } from '@shared/events'
import { describeState, describeValue } from '@shared/state-summary'
import { ToolCallAccumulator } from '../src/lib/tool-call-accumulator.js'
import { buildBoundTools, toLlmTools } from '../src/capabilities/tools.js'

const BASE = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3100'
const MOCK_OPENAI = process.env.PROBE_MOCK_OPENAI ?? 'http://127.0.0.1:3334'
const MOCK_BASE_URL = process.env.PROBE_BASE_URL ?? `${MOCK_OPENAI}/v1`
const SECRET = 'sk-probe-runtime'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  const suffix = detail === '' ? '' : `  ${detail}`
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${suffix}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${suffix}`)
  }
}

/* ================================================================= 1. 纯逻辑 */

console.log('\n[1] 工具调用分片累加器（不依赖服务）')

const accumulator = new ToolCallAccumulator()
// 上游真实下发次序：先 id+name，参数切成三段
accumulator.push([{ index: 0, id: 'call_1', name: 'memory_search', argumentsDelta: '{"qu' }])
accumulator.push([{ index: 0, argumentsDelta: 'ery":' }])
accumulator.push([{ index: 0, argumentsDelta: '"北北"}' }])
// 并行调用：另一个 index 交错到达，且**先给 name 后给 id**（真实上游顺序不保证）
accumulator.push([{ index: 1, name: 'tools_list', argumentsDelta: '{}' }])
accumulator.push([{ index: 1, id: 'call_2' }])
// 残缺分片：只有参数、没有 name —— 应当被丢弃，而不是产出一个「空名工具调用」
accumulator.push([{ index: 2, argumentsDelta: '{}' }])

const calls = accumulator.finish()
check('按 index 分桶，且按序号升序', calls.map((call) => call.id).join(',') === 'call_1,call_2', calls.map((call) => call.id).join(','))
check('参数分片拼回完整 JSON', calls[0]?.arguments === '{"query":"北北"}', calls[0]?.arguments ?? '')
check('后到的 id 能补上（不依赖到达顺序）', calls[1]?.name === 'tools_list' && calls[1]?.arguments === '{}')
check('没有 name 的分片被丢弃', calls.length === 2, `长度=${calls.length}`)

console.log('\n[2] 状态可读化（raw → normalized → 人类可读）')

const emptyState = describeState(null)
check('无状态时 available=false 且文案可读', !emptyState.available && emptyState.headline.includes('没有可用状态'))

const nested: BodyStateSnapshot = {
  state: {
    energy: 62,
    fatigue_delta: 0,
    mood: '有些疲倦',
    // 故意塞进「直接渲染会变 [object Object]」的结构
    inner: { a: 1, b: { c: 2 } },
    tags: ['tender', 'quiet'],
    flag: true,
  },
  stateCard: '现在有点疲倦，\n想安静一会儿。',
  payload: {},
  settledAt: 1_700_000_000_000,
}
const described = describeState(nested)
check('优先用状态卡首行做 headline', described.headline === '现在有点疲倦，', described.headline)
check('每个字段的值都是字符串', described.fields.every((field) => typeof field.value === 'string'))
check(
  '整个摘要里不含 [object Object]',
  !JSON.stringify(described).includes('[object Object]'),
  JSON.stringify(described).slice(0, 80),
)
check('已知字段有中文名', described.fields.find((field) => field.key === 'energy')?.label === '精力')
check('嵌套对象被压成一行而不是原样透出', describeValue({ inner: { a: 1 } }).includes('inner='))
check('未知字段原样透出，不隐藏', described.fields.some((field) => field.key === 'inner'))

console.log('\n[3] 工具绑定只收「真能用」的')

const synthetic: CapabilitySnapshot[] = [
  { id: 'memory.read', module: 'memory', label: '读取记忆', summary: '', modelHint: '', enabled: true, autonomy: 'autonomous', toolName: 'memory_read' },
  { id: 'memory.search', module: 'memory', label: '搜索记忆', summary: '', modelHint: '', enabled: true, autonomy: 'autonomous', toolName: 'memory_search' },
  // 已声明但依赖缺失 → 不该出现在给模型的工具表里
  { id: 'memory.write', module: 'memory', label: '写入记忆', summary: '', modelHint: '', enabled: false, autonomy: 'unavailable', reason: '只读接入' },
  // 需确认的能力 → 确认卡协议落地前也不能给模型
  { id: 'diary.create', module: 'diary', label: '写日记', summary: '', modelHint: '', enabled: true, autonomy: 'confirm' },
]
const bound = buildBoundTools(synthetic)
check('只绑定 enabled 且有工具名的能力', bound.map((tool) => tool.name).join(',') === 'memory_read,memory_search', bound.map((tool) => tool.name).join(','))
check('未启用能力不进工具表', !bound.some((tool) => tool.capabilityId === 'memory.write'))
check('需确认的能力也不进工具表（闸门朝「关」）', !bound.some((tool) => tool.capabilityId === 'diary.create'))

const llmTools = toLlmTools(bound) as Array<{ type: string; function: { name: string; parameters: unknown } }>
check('转成 OpenAI 协议形状', llmTools.every((tool) => tool.type === 'function' && typeof tool.function.name === 'string'))
check('工具表里带来源（卡片要用）', bound.every((tool) => tool.source !== ''))

/* ================================================================= 2. 服务端 */

interface ResponseData {
  status: number
  body: unknown
}
async function request(path: string, init?: RequestInit): Promise<ResponseData> {
  const response = await fetch(`${BASE}${path}`, init)
  const raw = await response.text()
  let body: unknown = raw
  try {
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    /* 保留原文供失败信息 */
  }
  return { status: response.status, body }
}
const json = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

/** 发一轮聊天，把 SSE 拆成 `{ event, data }` 列表 */
async function chat(message: string, profileId: string): Promise<{ status: number; frames: Array<{ event: string; data: unknown }>; raw: string }> {
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId, messages: [{ role: 'user', content: message }] }),
  })
  const raw = await response.text()
  const frames: Array<{ event: string; data: unknown }> = []
  for (const block of raw.split(/\r?\n\r?\n/)) {
    let event = ''
    const dataLines: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (event === '' || dataLines.length === 0) continue
    try {
      frames.push({ event, data: JSON.parse(dataLines.join('\n')) })
    } catch {
      /* 忽略解析不了的帧 */
    }
  }
  return { status: response.status, frames, raw }
}

const framesOf = (frames: Array<{ event: string; data: unknown }>, event: string): unknown[] =>
  frames.filter((frame) => frame.event === event).map((frame) => frame.data)
const assistantText = (frames: Array<{ event: string; data: unknown }>): string =>
  framesOf(frames, 'chat-delta').map((data) => (data as { content?: string }).content ?? '').join('')

console.log('\n[4] 能力快照（GET /api/capabilities）')

const capabilitiesRes = await request('/api/capabilities')
const snapshot = (capabilitiesRes.body as { capabilities?: CapabilitySnapshot[] })?.capabilities ?? []
check('能力面可读', capabilitiesRes.status === 200 && snapshot.length > 0, `共 ${snapshot.length} 项`)
check(
  '每项都有 id / 自主级别 / 可用性',
  snapshot.every((item) => typeof item.id === 'string' && typeof item.autonomy === 'string' && typeof item.enabled === 'boolean'),
)
check(
  '不可用的能力必须给出原因（不许静默）',
  snapshot.filter((item) => !item.enabled).every((item) => typeof item.reason === 'string' && item.reason !== ''),
)
check(
  '启用的能力必须有工具名（否则模型无从调用）',
  snapshot.filter((item) => item.enabled).every((item) => typeof item.toolName === 'string' && item.toolName !== ''),
)
const enabledIds = snapshot.filter((item) => item.enabled).map((item) => item.id)
console.log(`    当前可用：${enabledIds.join(', ') || '（无）'}`)
console.log(`    当前不可用：${snapshot.filter((item) => !item.enabled).map((item) => `${item.id}(${item.reason ?? ''})`).join('; ') || '（无）'}`)
check('本阶段写类能力一律不可用（不伪造）', !snapshot.some((item) => item.enabled && (item.id === 'diary.create' || item.id === 'messageboard.write' || item.id === 'memory.write')))
check('只读能力在 mock 环境下可用', enabledIds.includes('memory.read') && enabledIds.includes('memory.search') && enabledIds.includes('tools.list'))

console.log('\n[5] 建一个指向 mock 上游的临时方案')

let profileId: string | null = null
const created = await request('/api/providers', json('POST', { name: 'runtime 验收', baseUrl: MOCK_BASE_URL, modelMap: { chat: 'mock-chat-small' } }))
if (created.status === 201) {
  profileId = (created.body as ApiProfilePublic).id
  await request(`/api/providers/${encodeURIComponent(profileId)}/secret`, json('PUT', { secret: SECRET }))
}
check('临时方案就绪', profileId !== null, `status=${created.status}`)

if (profileId === null) {
  console.log('\n（方案建不出来，跳过链路验收；请检查 server / mock 上游是否都起来了）')
} else {
  console.log('\n[6] 工具调用闭环：成功后模型能看到结果')

  const success = await chat('你好 [[tool:memory_search]] 帮我查一下', profileId)
  check('聊天流 200', success.status === 200, `status=${success.status}`)
  check('没有流内错误', framesOf(success.frames, 'chat-error').length === 0, JSON.stringify(framesOf(success.frames, 'chat-error')))
  const toolFrames = framesOf(success.frames, 'tool-call') as ChatToolCallPayload[]
  check('收到 tool-call 帧', toolFrames.length === 1, `帧数=${toolFrames.length}`)
  const first = toolFrames[0]
  check('卡片带来源与动作（不是内部工具名）', first?.source === 'Nocturne' && first?.label === '搜索记忆', `${first?.source} · ${first?.label}`)
  check('工具执行成功', first?.ok === true, first?.summary ?? '')
  check('参数已解析（不是半截 JSON 报错）', !(first?.summary ?? '').includes('不是合法 JSON'), first?.summary ?? '')
  check('帧里不含 [object Object]', !JSON.stringify(toolFrames).includes('[object Object]'))
  check('完成帧存在', framesOf(success.frames, 'chat-done').length === 1)

  // 关键：工具结果必须**进了模型上下文**，否则续跑轮读不到它
  const followUpText = assistantText(success.frames)
  check(
    '续跑轮的正文引用了工具返回（证明结果回灌成功）',
    followUpText.includes('mock 续跑') && followUpText.includes('工具返回'),
    followUpText.slice(0, 90),
  )

  console.log('\n[7] 协议一致性：assistant.tool_calls 确实原样回传了')

  // mock 上游对「tool 消息前面没有带 tool_calls 的 assistant」会直接 400。
  // 上面那一轮没有 chat-error，本身就说明协议是合法的；这里再直接查报文坐实。
  const mockRes = await fetch(`${MOCK_OPENAI}/__last-body`)
  const mockBody = (await mockRes.json()) as { body: { messages?: Array<Record<string, unknown>> } | null }
  const sent = mockBody.body?.messages ?? []
  const assistantWithCalls = sent.find((message) => message.role === 'assistant' && Array.isArray(message.tool_calls))
  const toolMessage = sent.find((message) => message.role === 'tool')
  check('续跑请求里 assistant 带回了 tool_calls', assistantWithCalls !== undefined, `messages=${sent.length}`)
  check('续跑请求里带着 role=tool 的结果消息', toolMessage !== undefined)
  check('tool 消息带 tool_call_id', typeof toolMessage?.tool_call_id === 'string' && toolMessage?.tool_call_id !== '')
  check('tool 结果正文非空（模型读得到内容）', typeof toolMessage?.content === 'string' && (toolMessage?.content as string).length > 0)

  console.log('\n[8] 工具失败：模型收到的是「失败」而不是异常')

  const failed = await chat('试试不存在的能力 [[tool:not_a_real_tool]]', profileId)
  const failedFrames = framesOf(failed.frames, 'tool-call') as ChatToolCallPayload[]
  check('失败也走 tool-call 帧（不是 chat-error）', failedFrames.length === 1, `帧数=${failedFrames.length}`)
  check('帧标记为未成功', failedFrames[0]?.ok === false, failedFrames[0]?.summary ?? '')
  check('失败说明面向用户可读', (failedFrames[0]?.detail ?? '').includes('当前可用清单'), failedFrames[0]?.detail ?? '')
  check('整轮仍然正常收口', framesOf(failed.frames, 'chat-done').length === 1)
  const failedText = assistantText(failed.frames)
  check('模型知道自己失败了（续跑文案体现）', failedText.includes('没成功'), failedText.slice(0, 90))

  console.log('\n[9] 回归：不带标记的普通聊天不受影响')

  const plain = await chat('就是普通聊一句', profileId)
  check('普通聊天正常收口', plain.status === 200 && framesOf(plain.frames, 'chat-done').length === 1)
  check('普通聊天不产生工具调用', framesOf(plain.frames, 'tool-call').length === 0)

  console.log('\n[10] 自我认知：AI 能列出自己真实可用的能力')

  const listed = (await chat('我能做什么？ [[tool:tools_list]]', profileId)).frames
  const listFrame = (framesOf(listed, 'tool-call') as ChatToolCallPayload[])[0]
  check('tools_list 可被调用', listFrame?.ok === true, listFrame?.summary ?? '')
  check('清单条数 = 能力总数', (listFrame?.summary ?? '').includes(String(snapshot.length)), listFrame?.summary ?? '')
  check(
    '清单里写明了不可用项与原因（不含糊）',
    (listFrame?.detail ?? '').includes('不可用：'),
    (listFrame?.detail ?? '').slice(0, 60),
  )

  console.log('\n[11] 状态摘要可读（P0-5）；Eventide 未配时如实说没有')

  const stateFrame = (framesOf((await chat('我现在什么状态？ [[tool:state_read]]', profileId)).frames, 'tool-call') as ChatToolCallPayload[])[0]
  if (enabledIds.includes('state.read')) {
    check('state_read 可被调用', stateFrame?.ok === true, stateFrame?.summary ?? '')
    check('摘要可读（不是原始 JSON 也不是空）', (stateFrame?.detail ?? '').length > 0, (stateFrame?.detail ?? '').slice(0, 70))
    check('摘要里没有 [object Object]', !JSON.stringify(stateFrame).includes('[object Object]'))
  } else {
    // 本轮没起 Eventide：能力快照里就该没有 state.read，调用它必须**明确说不可用**
    check('未配置 Eventide 时 state_read 不在工具表里', stateFrame?.ok === false, stateFrame?.summary ?? '')
    check('且明确说了不可用（不静默）', (stateFrame?.detail ?? '').includes('当前可用清单'), (stateFrame?.detail ?? '').slice(0, 70))
  }

  await request(`/api/providers/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
}

console.log(`\n=== Phase 6.5 · AI Runtime P0 验收：${passed} passed / ${failed} failed ===`)
if (failed > 0) process.exitCode = 1
