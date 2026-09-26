/**
 * Phase 7C · 记忆沉淀（memory.write + Surf 升格）验收。
 *
 * 验的是四条不能破的边界：
 *
 * 1. **能力面如实** —— `memory.write` 绑了 `memory_write`、confirm 级；
 *    Nocturne 配好且工具面含 hold 时才 enabled（不伪造能力）。
 * 2. **挂起阶段绝不写** —— 模型调用 memory_write 只产生确认卡，
 *    批准前 Nocturne 里查不到那条内容；挂起回灌 `ok:true` 且明说「还没有执行」。
 * 3. **确认流闭环** —— 参数非法当场回灌（不产生必败确认卡）；
 *    批准后 hold 真调、读回真有；拒绝后保持没写；执行体缺失如实 failed。
 * 4. **Surf 沉淀是后台自主** —— 独处 Surf 成功后自动 hold 升格（不挂确认卡），
 *    内容带来源；沉淀失败不连坐记录本体。
 *
 * 跑法（见 `.workbuddy/run-7c-probe.sh`）：
 *   PROBE_SERVER=http://127.0.0.1:3241 PROBE_MOCK=http://127.0.0.1:3334 \
 *     npx tsx scripts/probe-memory-write.ts
 *
 * ⚠️ 需要 mock MCP（:3335）在跑且 server 配了 MCP_NOCTURNE_URL 指向它，
 *     否则 memory.write 不可用、探针第 1 节就会失败。
 */
export {}

import { createServer } from 'node:http'

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3241').replace(/\/+$/, '')
const MOCK = (process.env.PROBE_MOCK ?? 'http://127.0.0.1:3334').replace(/\/+$/, '')
const RSS_PORT = Number(process.env.PROBE_RSS_PORT ?? 3398)

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

interface CapabilityView { id: string; enabled: boolean; autonomy: string; toolName?: string; reason?: string }
interface ToolCallFrame { name: string; ok: boolean; summary: string; detail?: string; eventId?: string }
interface EventView { id: string; kind: string; decider: string; status: string; title: string; detail: string; result: string | null }
interface LogView { eventType: string; metrics: Record<string, unknown> }

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  // ⚠️ 只在真的有 body 时才声明 JSON（空 body 带 content-type 会被 Fastify 解析炸掉）
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

const json = async <T>(path: string, init?: RequestInit): Promise<T> => (await req(path, init)).body as T

/** 发一轮聊天，把 SSE 拆成 { event, data } 列表（与 probe-event-inbox 同法） */
async function chat(message: string): Promise<Array<{ event: string; data: unknown }>> {
  const profiles = await json<{ profiles: Array<{ id: string }> }>('/api/providers')
  const profileId = profiles.profiles[0]?.id ?? ''
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
  return frames
}

const toolCallsOf = (frames: Array<{ event: string; data: unknown }>): ToolCallFrame[] =>
  frames.filter((frame) => frame.event === 'tool-call').map((frame) => frame.data as ToolCallFrame)

async function pendingEvents(): Promise<EventView[]> {
  return ((await req('/api/inbox?status=pending')).body as { events: EventView[] }).events
}

/** 从 Nocturne 读回：搜关键词（走 /api/memory/search → 实例 trace） */
async function memoryText(query: string): Promise<string> {
  const body = (await req(`/api/memory/search?q=${encodeURIComponent(query)}`)).body as { text?: string }
  return body.text ?? ''
}

async function scriptSurf(select: string[], record: string[]): Promise<void> {
  await fetch(`${MOCK}/__script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ surfSelect: select, surfRecord: record }) })
}

function startRssServer(): Promise<void> {
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>7C探针源</title>` +
    `<item><title>7C探针文章</title><link>http://127.0.0.1:${RSS_PORT}/article?utm_source=probe</link><description>摘要</description></item>` +
    `</channel></rss>`
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/feed.xml')) {
      res.writeHead(200, { 'content-type': 'application/rss+xml' })
      res.end(feed)
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(RSS_PORT, '127.0.0.1', () => resolve())
    server.unref()
  })
}

const health = await req('/api/health')
check('server 就绪', health.status === 200, `status=${String(health.status)}`)

/* ------------------------------------------------------------------ 1. 能力面 */
console.log('\n[1] 能力面：memory.write 已实施且仍是 confirm 级')

const caps = await json<{ capabilities: CapabilityView[] }>('/api/capabilities')
const writeCap = caps.capabilities.find((item) => item.id === 'memory.write')
check('memory.write enabled（mock MCP 已配置）', writeCap?.enabled === true, JSON.stringify(writeCap))
check('memory.write 保持 confirm 级', writeCap?.autonomy === 'confirm')
check('memory.write 绑定 memory_write 工具', writeCap?.toolName === 'memory_write')
const readCap = caps.capabilities.find((item) => item.id === 'memory.read')
check('memory.read 同时可用（链路就绪的前提一致）', readCap?.enabled === true)

/* ------------------------------------------------------------------ 2. 挂起不执行 */
console.log('\n[2] 挂起阶段绝不写：确认卡在，Nocturne 里没有')

const MARKER = '[[tool:memory_write {"content":"7C验收记忆：北北喜欢在傍晚散步。","name":"傍晚散步","kind":"memory","tags":"验收"}]]'
const suspendFrames = toolCallsOf(await chat(MARKER))
const suspendCall = suspendFrames[0]
check('挂起回灌 ok:true（挂起不是失败）', suspendCall?.ok === true, JSON.stringify(suspendCall?.summary))
check('回灌明说还没有执行', (suspendCall?.detail ?? '').includes('还没有执行') || suspendCall?.summary.includes('等待北北确认'))
check('回灌带确认事件 id', typeof suspendCall?.eventId === 'string' && suspendCall.eventId !== '')

const pending = await pendingEvents()
const confirmEvent = pending.find((item) => item.kind === 'tool_confirm' && item.title.includes('写一条长期记忆'))
check('收件箱出现待确认事件（decider=user）', confirmEvent !== undefined && confirmEvent.decider === 'user')
check('确认卡标题带记忆名', (confirmEvent?.title ?? '').includes('傍晚散步'), confirmEvent?.title)
check('确认卡详情带正文预览', (confirmEvent?.detail ?? '').includes('7C验收记忆'), confirmEvent?.detail)

const before = await memoryText('傍晚散步')
check('批准前 Nocturne 里查不到这条内容（hold 没被调）', !before.includes('7C验收记忆'), before.slice(0, 80))

/* ------------------------------------------------------------------ 3. 参数校验当场回灌 */
console.log('\n[3] 参数非法当场回灌：不产生注定失败的确认卡')

const pendingBefore = (await pendingEvents()).length
const badFrames = toolCallsOf(await chat('[[tool:memory_write {"content":"坏参数","kind":"bogus"}]]'))
const badCall = badFrames[0]
check('非法 kind 回灌 ok:false', badCall?.ok === false, JSON.stringify(badCall?.summary))
check('错误信息指向 kind 取值', (badCall?.detail ?? '').includes('kind'))
check('没有新增确认卡', (await pendingEvents()).length === pendingBefore)

/* ------------------------------------------------------------------ 4. 批准 → hold 真调 */
console.log('\n[4] 批准后真写：hold 落进 Nocturne，读回有据')

if (confirmEvent === undefined) {
  check('(跳过：没有确认事件可决)', false)
} else {
  const approve = await req(`/api/inbox/${confirmEvent.id}/decide`, post({ decision: 'approve' }))
  check('决策接口接受 approve', approve.status === 200)
  const settled = (approve.body as { event: EventView }).event
  check('事件落定 approved，结果提到已写进长期记忆', settled.status === 'approved' && (settled.result ?? '').includes('已写进长期记忆'), settled.result ?? '')
  const readBack = await memoryText('傍晚散步')
  check('Nocturne 读回真有这条记忆', readBack.includes('7C验收记忆'), readBack.slice(0, 80))
  const again = await req(`/api/inbox/${confirmEvent.id}/decide`, post({ decision: 'approve' }))
  check('同一事件不能决两次', again.status === 400)
}

/* ------------------------------------------------------------------ 5. 拒绝 → 保持没写 */
console.log('\n[5] 拒绝：确认卡变 denied，Nocturne 保持干净')

const DENY_MARKER = '[[tool:memory_write {"content":"7C拒绝线：这条不该被记住。"}]]'
const denyFrames = toolCallsOf(await chat(DENY_MARKER))
check('第二次调用同样挂起', denyFrames[0]?.ok === true)
const denyEvent = (await pendingEvents()).find((item) => item.kind === 'tool_confirm')
if (denyEvent === undefined) {
  check('(跳过：没有第二张确认卡)', false)
} else {
  const denied = await req(`/api/inbox/${denyEvent.id}/decide`, post({ decision: 'deny' }))
  const settledDeny = (denied.body as { event: EventView }).event
  check('事件落定 denied', settledDeny.status === 'denied')
  const afterDeny = await memoryText('7C拒绝线')
  check('拒绝后 Nocturne 里依然没有这条', !afterDeny.includes('7C拒绝线'), afterDeny.slice(0, 80))
}

/* ------------------------------------------------------------------ 6. Surf 沉淀 */
console.log('\n[6] Surf 升格：独处产出自动 hold 进长期记忆（无确认卡）')

await startRssServer()
const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
const pad = (value: number): string => String(value).padStart(2, '0')
await json('/api/automation', {
  method: 'PATCH',
  body: JSON.stringify({
    enabled: true,
    wakeEnabled: false,
    solitudeEnabled: true,
    dreamEnabled: false,
    surfEnabled: true,
    quietStart: `${pad((hour + 1) % 24)}:00`,
    quietEnd: `${pad(hour)}:00`,
    solitudeStart: `${pad(hour)}:00`,
    solitudeEnd: `${pad((hour + 2) % 24)}:00`,
  }),
})
await json('/api/surf/feeds', { method: 'PUT', body: JSON.stringify({ feeds: [`http://127.0.0.1:${RSS_PORT}/feed.xml`] }) })
await scriptSurf(['{"idx":0,"why":"7C验收"}'], ['7C沉淀验收：我看了一篇 mock 文章并想把它记住。'])

const pendingBeforeSurf = (await pendingEvents()).length
const checkResult = await json<{ results: Array<{ kind: string; status: string; reason: string | null }> }>('/api/automation/check', post({}))
check('独处运行 completed 且产出 Surf', checkResult.results.some((item) => item.kind === 'solitude' && item.status === 'completed' && (item.reason ?? '').includes('Surf')), JSON.stringify(checkResult.results))
const runs = await json<{ runs: Array<{ kind: string; reason: string | null }> }>('/api/automation/runs?limit=10')
check('run 标记 surf', runs.runs.some((item) => item.kind === 'solitude' && item.reason === 'surf'), JSON.stringify(runs.runs[0]))
check('Surf 沉淀没有产生确认卡（后台自主）', (await pendingEvents()).length === pendingBeforeSurf)

const logs = (await req('/api/events?limit=200')).body as { events: LogView[] }
const consolidated = logs.events.find((item) => item.eventType === 'automation.surf.consolidated')
check('沉淀成功留审计（automation.surf.consolidated）', consolidated !== undefined)
const surfReadBack = await memoryText('7C沉淀验收')
check('Nocturne 里读得到 Surf 记录', surfReadBack.includes('7C沉淀验收'), surfReadBack.slice(0, 80))
check('沉淀内容带来源信息', surfReadBack.includes('来源') && surfReadBack.includes(`127.0.0.1:${RSS_PORT}`), '')

console.log(`\n=== 记忆沉淀验收：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
