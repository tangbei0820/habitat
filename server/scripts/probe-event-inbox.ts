/**
 * Phase 6.5 · P1（Event Inbox / 日记权限）+ Phase 7B（写类自主化）验收。
 *
 * 要验的不是「接口通不通」，而是**三条不能破的边界**：
 *
 * 1. **自主执行真的落库** —— Phase 7B 起日记三能力与留言板是 `autonomous`：
 *    模型一调用就真写，作者是 companion、日记默认私密、留言不推送打扰。
 * 2. **决策只能做一次** —— 同一条权限事件点两下不能出现两种结果。
 * 3. **用户不能替 AI 决定** —— 「北北想看某篇私密日记」必须由 AI 自己答应。
 *    这条破了，日记的「私密」就只是个说法。
 *
 * ⚠️ 历史：P1 时写类走 `confirm` 确认卡（挂起 → 北北点允许 → 才执行）。
 * 7B 自主化后**新**确认事件不再产生，确认协议作为基础设施保留（`memory.write` 落地时用）；
 * 本探针相应把「挂起/批准/拒绝」的覆盖挪到仍然活跃的 `diary_access_request` 路径上。
 *
 * 另外还要验「模型真的能调这些工具」—— 光有工具定义不算，得从聊天流里调通。
 *
 * 跑法（需要 mock 上游 :3334 + server :3239，见 `.workbuddy/run-p1-probe.sh`）：
 *   PROBE_SERVER=http://127.0.0.1:3239 PROBE_MOCK=http://127.0.0.1:3334 \
 *     npx tsx scripts/probe-event-inbox.ts
 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3239').replace(/\/+$/, '')
const MOCK = (process.env.PROBE_MOCK ?? 'http://127.0.0.1:3334').replace(/\/+$/, '')
const SECRET = process.env.PROBE_MOCK_SECRET ?? 'sk-mock'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`)
  }
}

interface DiaryView {
  id: string
  title: string
  content: string | null
  entryDate: string
  author: string
  visibility: string
  readable: boolean
  editable: boolean
}

interface MomentView {
  id: string
  content: string
  author: string
}

interface RuntimeEventView {
  id: string
  kind: string
  decider: string
  status: string
  title: string
  detail: string
  result: string | null
  resultDelivered: boolean
  capabilityId: string | null
  targetId: string | null
}

interface ToolCallFrame {
  id: string
  name: string
  capabilityId: string
  label: string
  source: string
  ok: boolean
  summary: string
  detail?: string
  eventId?: string
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  // ⚠️ 只在**真的有 body** 时才声明 JSON：给没有 body 的请求带 `content-type: application/json`
  //    会让 Fastify 去解析空 body 并抛错，最后以 500 收场（T-036 踩过）。
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${SERVER}${path}`, { ...init, headers })
  const text = await res.text()
  let body: unknown = null
  if (text !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: res.status, body }
}

const post = (payload?: unknown): RequestInit =>
  payload === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(payload) }

/** 发一轮聊天，把 SSE 拆成 `{ event, data }` 列表 */
async function chat(message: string, profileId: string): Promise<{ status: number; frames: Array<{ event: string; data: unknown }> }> {
  const res = await fetch(`${SERVER}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId, messages: [{ role: 'user', content: message }] }),
  })
  const raw = await res.text()
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
      /* 解析不了的帧忽略 */
    }
  }
  return { status: res.status, frames }
}

const toolCallsOf = (frames: Array<{ event: string; data: unknown }>): ToolCallFrame[] =>
  frames.filter((frame) => frame.event === 'tool-call').map((frame) => frame.data as ToolCallFrame)

async function diaries(): Promise<DiaryView[]> {
  return ((await req('/api/diary')).body as { items: DiaryView[] }).items
}
async function moments(): Promise<MomentView[]> {
  return ((await req('/api/moments')).body as { items: MomentView[] }).items
}
async function events(query = ''): Promise<RuntimeEventView[]> {
  return ((await req(`/api/inbox${query}`)).body as { events: RuntimeEventView[] }).events
}
const getEvent = async (id: string): Promise<RuntimeEventView> => (await req(`/api/inbox/${id}`)).body as RuntimeEventView

/** 拿 mock 上游收到的最后一个请求体 —— 用来验「上下文里到底注入了什么」 */
async function lastSentMessages(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${MOCK}/__last-body`)
  const body = (await res.json()) as { body: { messages?: Array<Record<string, unknown>> } | null }
  return body.body?.messages ?? []
}
const systemBlocksOf = (messages: Array<Record<string, unknown>>): string =>
  messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')

/* ------------------------------------------------------------------ 0. 准备 */
console.log('\n[0] 环境自检')

const health = await req('/api/health')
check('server 可达', health.status === 200, `status=${health.status}`)

let profileId: string | null = null
const created = await req('/api/providers', {
  method: 'POST',
  body: JSON.stringify({ name: '事件收件箱验收', baseUrl: `${MOCK}/v1`, modelMap: { chat: 'mock-chat-small' } }),
})
if (created.status === 201) {
  profileId = (created.body as { id: string }).id
  await req(`/api/providers/${encodeURIComponent(profileId)}/secret`, { method: 'PUT', body: JSON.stringify({ secret: SECRET }) })
}
check('临时方案就绪', profileId !== null, `status=${created.status}`)
if (profileId === null) {
  console.log('\n（方案建不出来，后续链路无法验收；检查 mock 上游是否起来）')
  console.log(`\n=== 事件收件箱验收：${passed} passed / ${failed} failed ===`)
  process.exitCode = 1
} else {

/* ------------------------------------------------- 1. 模型写日记 → 自主执行，立即落库 */
console.log('\n[1] autonomous 写类：一调用就真写（Phase 7B）')

const beforeCount = (await diaries()).length
const asked = await chat(
  '[[tool:diary_create {"title":"验收·小栖的日记","content":"今天和北北一起把事件收件箱验了一遍。","entryDate":"2026-09-24"}]]',
  profileId,
)
check('聊天流 200', asked.status === 200, `status=${asked.status}`)

const writeFrames = toolCallsOf(asked.frames)
check('收到 tool-call 帧', writeFrames.length === 1, `帧数=${writeFrames.length}`)
const writeFrame = writeFrames[0]
check('调用成功（ok=true）', writeFrame?.ok === true)
check('卡片文案说的是「写了」而不是「等待确认」', (writeFrame?.summary ?? '').includes('写了'), `summary=${writeFrame?.summary ?? ''}`)
check('自主执行不再挂确认事件（帧里没有 eventId）', writeFrame?.eventId === undefined, `eventId=${writeFrame?.eventId ?? '(无)'}`)

const afterWrite = await diaries()
const written = afterWrite.find((item) => item.title === '验收·小栖的日记')
check('★ 日记立即写进去了', written !== undefined && afterWrite.length === beforeCount + 1, `before=${beforeCount} after=${afterWrite.length}`)
check('作者是 companion（AI 写的）', written?.author === 'companion', `author=${written?.author ?? ''}`)
check('新写的日记是私密的（开放是另一件事）', written?.visibility === 'private', `visibility=${written?.visibility ?? ''}`)
check('北北现在还读不到正文', written?.readable === false && written?.content === null, `readable=${String(written?.readable)}`)
check('北北也改不了它', written?.editable === false)
check('收件箱里没有新的待确认事件', (await events('?decider=user&status=pending')).every((item) => item.capabilityId !== 'diary.create'))

/* ------------------------------------------------- 2. 留言板同样自主执行 */
console.log('\n[2] messageboard_write：直接上板，不推送不打扰')

const momentsBefore = (await moments()).length
const wroteMoment = await chat('[[tool:messageboard_write {"content":"验收·自主留言"}]]', profileId)
const momentFrame = toolCallsOf(wroteMoment.frames)[0]
check('调用成功', momentFrame?.ok === true, `summary=${momentFrame?.summary ?? ''}`)
check('★ 留言真的上板了', (await moments()).length === momentsBefore + 1, `before=${momentsBefore}`)
check('收件箱里没有留言的确认事件', (await events('?decider=user&status=pending')).every((item) => item.capabilityId !== 'messageboard.write'))

/* ------------------------------------------------- 3. 参数不合法 → 失败回灌，不写半个字 */
console.log('\n[3] 参数不合法：当场回灌，不落库')

const countAfterGood = (await diaries()).length
const pendingBefore = (await events('?status=pending')).length
const bad = await chat('[[tool:diary_create]]', profileId)
const badFrame = toolCallsOf(bad.frames)[0]
check('回灌的是失败（ok=false）', badFrame?.ok === false)
check('没有产生事件', (await events('?status=pending')).length === pendingBefore)
check('失败原因具体（模型能据此改）', (badFrame?.detail ?? badFrame?.summary ?? '').includes('title'), `detail=${badFrame?.detail ?? ''}`)
check('★ 日记数没有变化', (await diaries()).length === countAfterGood)

/* ------------------------------------------------- 6. 北北请求查看私密日记 */
console.log('\n[6] 权限流转：请求 → AI 决定')

const target = written as DiaryView
const accessRequest = await req(`/api/diary/${target.id}/request-access`, post())
check('请求返回 201', accessRequest.status === 201, `status=${accessRequest.status}`)
const accessEvent = (accessRequest.body as { event: RuntimeEventView }).event
check('事件等的是 AI，不是北北', accessEvent.decider === 'companion', `decider=${accessEvent.decider}`)
check('事件类型是 diary_access_request', accessEvent.kind === 'diary_access_request', `kind=${accessEvent.kind}`)
check('事件指向那一篇日记（前端靠它标「已请求」）', accessEvent.targetId === target.id, `targetId=${accessEvent.targetId ?? ''}`)

const repeat = await req(`/api/diary/${target.id}/request-access`, post())
check('重复请求复用同一条（不制造两条一样的请求）', (repeat.body as { event: RuntimeEventView }).event.id === accessEvent.id)

console.log('\n[7] ★ 北北不能替 AI 决定')

const cheat = await req(`/api/inbox/${accessEvent.id}/decide`, post({ decision: 'approve' }))
check('替 AI 决策 → 400', cheat.status === 400, `status=${cheat.status}`)
const unchanged = await getEvent(accessEvent.id)
check('事件状态没有变（还是待 AI 决定）', unchanged.status === 'pending', `status=${unchanged.status}`)
check('日记仍然读不到（没有偷偷打开）', (await req(`/api/diary/${target.id}`)).body !== null && ((await req(`/api/diary/${target.id}`)).body as DiaryView).readable === false)

console.log('\n[8] 待办会注入给 AI（不然它永远不知道有人在等）')

await chat('今天天气不错', profileId)
const injected = systemBlocksOf(await lastSentMessages())
check('上下文里有事件段', injected.includes('等待你决定') || injected.includes('runtime_events'), '')
check('段里给出了事件 id（AI 靠它指定处理哪条）', injected.includes(accessEvent.id))
check('段里说清了要调什么工具', injected.includes('允许查看') || injected.includes('拒绝查看'))

/* ------------------------------------------------- 9. AI 同意 → 北北能读了 */
console.log('\n[9] AI 调用 diary_allow_access → 正文对北北开放')

const allowTurn = await chat(`[[tool:diary_allow_access {"eventId":"${accessEvent.id}"}]]`, profileId)
const allowFrame = toolCallsOf(allowTurn.frames)[0]
check('工具调用成功', allowFrame?.ok === true, `summary=${allowFrame?.summary ?? ''}`)
check('事件转为 approved', (await getEvent(accessEvent.id)).status === 'approved')

const readable = (await req(`/api/diary/${target.id}`)).body as DiaryView
check('★ 日记变成对北北开放', readable.visibility === 'open', `visibility=${readable.visibility}`)
check('★ 正文真的下发了', readable.readable === true && (readable.content ?? '').includes('事件收件箱'))
check('开放之后用户仍然改不了 AI 的日记', readable.editable === false)

console.log('\n[10] 结果只告诉模型一次')

await chat('嗯嗯', profileId)
const withResult = systemBlocksOf(await lastSentMessages())
check('结果第一次出现在上下文里', withResult.includes('你之前那些请求的结果'))
check('结果里说明了同意这件事', withResult.includes('开放'))

await chat('好的', profileId)
const afterDelivered = systemBlocksOf(await lastSentMessages())
check('★ 第二次不再重复注入（不烧无用的 token、也不诱导它重做）', !afterDelivered.includes('你之前那些请求的结果'))

/* ------------------------------------------------- 10.5 决策只能做一次 */
console.log('\n[10.5] 决策只能做一次（放在结果注入验完之后 —— 重复调用的失败回灌会占用一次「只注入一次」的结果）')

const againAllow = await chat(`[[tool:diary_allow_access {"eventId":"${accessEvent.id}"}]]`, profileId)
const againFrame = toolCallsOf(againAllow.frames)[0]
check('★ 重复同意 → 失败回灌', againFrame?.ok === false, `summary=${againFrame?.summary ?? ''}`)
check('日记没有因此变化', (await getEvent(accessEvent.id)).status === 'approved')

/* ------------------------------------------------- 11. AI 拒绝 */
console.log('\n[11] AI 拒绝：日记保持私密')

const second = await req('/api/diary', post({ title: '验收·第二篇', content: '这一篇不想给人看。', entryDate: '2026-09-24' }))
const secondId = (second.body as DiaryView).id
// 先用 AI 自己的身份写一篇（用户建的是 author=user，无法走权限流转），借 import 端点造一篇 companion 的
await req('/api/diary/import', {
  method: 'POST',
  body: JSON.stringify({ items: [{ id: 'probe-ai-diary-2', title: '验收·AI 第二篇', content: '私密内容', entryDate: '2026-09-24', author: 'companion', visibility: 'private', createdAt: Date.now(), updatedAt: Date.now() }] }),
})
const deniedRequest = await req('/api/diary/probe-ai-diary-2/request-access', post())
const deniedEvent = (deniedRequest.body as { event: RuntimeEventView }).event
await chat(`[[tool:diary_deny_access {"eventId":"${deniedEvent.id}"}]]`, profileId)
check('事件转为 denied', (await getEvent(deniedEvent.id)).status === 'denied')
const stillPrivate = (await req('/api/diary/probe-ai-diary-2')).body as DiaryView
check('★ 日记仍然私密', stillPrivate.visibility === 'private', `visibility=${stillPrivate.visibility}`)
check('★ 正文没有下发', stillPrivate.readable === false && stillPrivate.content === null)
check('★ 被拒之后日记还在（拒绝 ≠ 删掉）', (await diaries()).some((item) => item.id === 'probe-ai-diary-2'))

/* ------------------------------------------------- 12. 能力面 */
console.log('\n[12] 能力面：写类已可用、已绑工具、且是 autonomous')

const snapshotRes = await req('/api/capabilities')
const snapshot = ((snapshotRes.body as { capabilities?: Array<{ id: string; enabled: boolean; autonomy: string; toolName?: string }> }).capabilities ?? [])
const byId = new Map(snapshot.map((item) => [item.id, item]))
for (const id of ['diary.create', 'diary.update', 'diary.list_own', 'diary.read_own', 'diary.allow_access', 'diary.deny_access', 'messageboard.write']) {
  const item = byId.get(id)
  check(`${id} 已可用且绑了工具`, item?.enabled === true && typeof item.toolName === 'string', `enabled=${String(item?.enabled)} tool=${item?.toolName ?? '(无)'}`)
}
check('★ 写类已自主化（Phase 7B：diary.create / messageboard.write）', byId.get('diary.create')?.autonomy === 'autonomous' && byId.get('messageboard.write')?.autonomy === 'autonomous', `autonomy=${byId.get('diary.create')?.autonomy ?? ''}`)
check('读自己的能力是 autonomous', byId.get('diary.read_own')?.autonomy === 'autonomous')
check('写记忆仍未实施（如实说不）', byId.get('memory.write')?.enabled === false)

/* ------------------------------------------------- 13. 清理 */
console.log('\n[13] 清理')

await req(`/api/diary/${target.id}`, { method: 'DELETE' })
await req(`/api/diary/${secondId}`, { method: 'DELETE' })
check('用户删不掉 AI 的日记（404）', (await req('/api/diary/probe-ai-diary-2', { method: 'DELETE' })).status === 404)
check('AI 的日记仍在（用户无权处置）', (await diaries()).some((item) => item.id === 'probe-ai-diary-2'))

console.log(`\n=== 事件收件箱验收：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
}
