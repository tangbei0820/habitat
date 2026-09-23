/** Phase 3B 全链验收：真实 sidecar + habitat-server + mock LLM + SQLite。 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')
const SIDECAR = (process.env.PROBE_EVENTIDE ?? 'http://127.0.0.1:8234').replace(/\/+$/, '')

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, init)
  const body = await response.json() as T
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body)}`)
  return body
}

async function patchPolicy(body: Record<string, unknown>): Promise<void> {
  await json('/api/automation', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function chat(content: string): Promise<Response> {
  return fetch(`${SERVER}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: '你是小栖。' }, { role: 'user', content }] }),
  })
}

async function waitForSettlement(afterId = 0): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await json<{ events: Array<{ id: number; eventType: string }> }>('/api/events?limit=100')
    if (result.events.some((event) => event.id > afterId && event.eventType === 'eventide.settlement.completed')) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

function shanghaiDay(date: Date): string {
  const parts = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`
}

console.log('\n=== Phase 3B full-chain probe ===')

const initial = await json<{ policy: { enabled: boolean } }>('/api/automation')
check('主动行为默认关闭', initial.policy.enabled === false)

const firstChat = await chat('今天想和你待一会儿。')
const firstStream = await firstChat.text()
check('普通聊天不被默认关闭的主动行为阻塞', firstChat.ok && firstStream.includes('event: chat-done'))
check('回复后异步互动结算完成', await waitForSettlement())
const stateAfterChat = await json<{ snapshot: { state: Record<string, unknown>; settledAt: number } }>('/api/state')
const meta = stateAfterChat.snapshot.state.meta as Record<string, unknown>
check('Eventide 写回归一化 settlement', typeof meta.last_settlement === 'object' && meta.last_settlement !== null)

const localHour = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23',
}).format(new Date()))
const quietHour = (localHour + 2) % 24
const quietStart = `${String(quietHour).padStart(2, '0')}:00`
const quietEnd = `${String(quietHour).padStart(2, '0')}:01`
await patchPolicy({
  enabled: true,
  wakeEnabled: true,
  solitudeEnabled: true,
  dreamEnabled: false,
  minSilenceMinutes: 0,
  wakeCooldownMinutes: 0,
  maxUnansweredWakes: 1,
  maxDailyProactiveRuns: 5,
  quietStart,
  quietEnd,
  solitudeStart: '00:00',
  solitudeEnd: '00:00',
})
const firstCheck = await json<{ results: Array<{ kind: string; status: string }> }>('/api/automation/check', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
})
check('独处时光生成私有记录', firstCheck.results.some((item) => item.kind === 'solitude' && item.status === 'completed'))
check('主动唤醒生成通知', firstCheck.results.some((item) => item.kind === 'wake' && item.status === 'completed'))
const notices = await json<{ notifications: Array<{ id: string; body: string; readAt: number | null }> }>('/api/notifications')
check('通知收件箱持久化主动正文', notices.notifications.length === 1 && notices.notifications[0]?.body.length > 0)
const solitude = await json<{ entries: Array<{ body: string }> }>('/api/solitude')
check('独处正文与用户聊天分库存放', solitude.entries.length === 1 && solitude.entries[0]?.body.length > 0)

const secondCheck = await json<{ results: Array<{ kind: string; status: string; reason: string | null }> }>('/api/automation/check', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
})
check('同一天不重复跑独处时光', secondCheck.results.some((item) => item.kind === 'solitude' && item.status === 'skipped'))
check('连续未回复达到上限后停止打扰', secondCheck.results.some((item) => item.kind === 'wake' && item.reason?.includes('未获回复') === true))
const runtimeBeforeReply = await json<{ runtime: { unansweredWakes: number } }>('/api/automation')
check('主动未回复计数已落库', runtimeBeforeReply.runtime.unansweredWakes === 1)

const previousEvents = await json<{ events: Array<{ id: number }> }>('/api/events?limit=1')
const previousId = previousEvents.events[0]?.id ?? 0
const secondChat = await chat('我回来啦。')
await secondChat.text()
check('用户再次发言后第二轮聊天成功', secondChat.ok)
check('第二轮互动结算也完成', await waitForSettlement(previousId))
const runtimeAfterReply = await json<{ runtime: { unansweredWakes: number } }>('/api/automation')
check('用户发言清零主动未回复计数', runtimeAfterReply.runtime.unansweredWakes === 0)

const credit = await json<{ wallet: { balance: number } }>('/api/wallet/transactions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delta: 10, reason: 'Phase 3B probe credit' }),
})
const debit = await json<{ wallet: { balance: number } }>('/api/wallet/transactions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delta: -3, reason: 'Phase 3B probe debit' }),
})
const walletTransactions = await json<{ transactions: unknown[] }>('/api/wallet/transactions')
check('钱包充值与支出按流水累计', credit.wallet.balance === 10 && debit.wallet.balance === 7)
check('钱包不可变流水可追溯', walletTransactions.transactions.length === 2)
const overdraft = await fetch(`${SERVER}/api/wallet/transactions`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delta: -8, reason: 'should fail' }),
})
check('钱包拒绝透支且不产生假流水', overdraft.status === 400)

const eventNow = new Date(stateAfterChat.snapshot.settledAt + 11 * 60_000)
const eventResponse = await fetch(`${SIDECAR}/v1/events/check`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    state: stateAfterChat.snapshot.state,
    now: eventNow.toISOString(),
    last_counterpart_message_at: eventNow.toISOString(),
    counterpart_text: '小栖，我想你',
    trigger_words: ['想你'],
    local_hour: 12,
    local_day_key: shanghaiDay(eventNow),
    roll: 0,
  }),
})
const eventBody = await eventResponse.json() as { event_key?: unknown; started?: unknown }
check('称呼 / 关键词事件可触发且由 Eventide 写状态', eventResponse.ok && eventBody.event_key === 'voice_or_name_trigger' && eventBody.started === true)

const dreamDay = shanghaiDay(new Date(Date.now() + 24 * 60 * 60_000))
const dreamNowText = `${dreamDay}T01:00:00+08:00`
const dreamNow = new Date(dreamNowText)
const dreamResponse = await fetch(`${SIDECAR}/v1/dream/check`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    state: stateAfterChat.snapshot.state,
    now: dreamNowText,
    seed: '一场温柔的梦',
    last_counterpart_message_at: new Date(dreamNow.getTime() - 3 * 60 * 60_000).toISOString(),
    random_seed: 1,
  }),
})
const dreamBody = await dreamResponse.json() as { trigger?: { prompt?: unknown } | null }
check(
  '梦种经过窗口 / 静默 / 概率检查后产出梦卡 prompt',
  dreamResponse.ok && typeof dreamBody.trigger?.prompt === 'string',
  `status=${dreamResponse.status}`,
)

await patchPolicy({ maxDailyApiCalls: 1 })
const blocked = await chat('这轮应该被预算拦住。')
const blockedBody = await blocked.json() as { error?: { code?: unknown } }
check('BudgetGuard 在调用上游前硬拦截', blocked.status === 429 && blockedBody.error?.code === 'BUDGET_EXCEEDED')

const noticeId = notices.notifications[0]?.id
if (noticeId !== undefined) await json(`/api/notifications/${noticeId}/read`, { method: 'PATCH' })
const readBack = await json<{ notifications: Array<{ readAt: number | null }> }>('/api/notifications')
check('通知可标记已读', readBack.notifications[0]?.readAt !== null)

console.log(`\n=== Phase 3B full-chain probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
