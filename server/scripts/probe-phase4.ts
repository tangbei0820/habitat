/** Phase 4 全链探针：需先启动 mock OpenAI 与使用隔离数据库的 habitat-server。 */
export {}

const base = process.env.PROBE_SERVER ?? 'http://127.0.0.1:3238'
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

async function json(path: string, init?: RequestInit): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, init)
  return { response, body: await response.json() as Record<string, unknown> }
}

function currentMonth(): string {
  const parts = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  return `${parts.get('year')}-${parts.get('month')}`
}

const headers = { 'content-type': 'application/json' }
const month = currentMonth()
console.log('\n=== Phase 4 full-chain probe ===')

const initial = await json(`/api/life/ledger?month=${month}`)
check('Life 账本空态可读取', initial.response.ok && typeof initial.body.summary === 'object')

const runtime = await json('/api/life/runtime')
check('运行页聚合 server / Eventide / MCP / automation', runtime.response.ok
  && typeof runtime.body.server === 'object' && typeof runtime.body.automation === 'object')

const push = await json('/api/push/status')
check('未配置 VAPID 时明确降级', push.response.ok && push.body.configured === false && push.body.publicKey === null)

const chat = await fetch(`${base}/api/chat`, {
  method: 'POST', headers,
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Phase 4 记账测试' }] }),
})
check('未定价聊天正常完成', chat.ok)
await chat.text()

const beforePrice = await json(`/api/life/ledger?month=${month}`)
const beforeSummary = (beforePrice.body.summary as { totals?: { unpricedCalls?: number } }).totals
check('没有价格快照时明确标记未定价', beforeSummary?.unpricedCalls === 1)

const price = await json('/api/prices', {
  method: 'POST', headers,
  body: JSON.stringify({
    provider: 'openai-compat', model: 'mock-chat-small',
    promptCentsPerMillion: 1_000_000, completionCentsPerMillion: 2_000_000, validFrom: 0,
  }),
})
check('新增不可变价格快照', price.response.status === 201)
check('新快照只给未定价历史调用补价', price.body.repriced === 1)

const afterPrice = await json(`/api/life/ledger?month=${month}`)
const pricedSummary = (afterPrice.body.summary as { totals?: { pricedCostCents?: number; unpricedCalls?: number } }).totals
check('账本聚合已定价费用', (pricedSummary?.pricedCostCents ?? 0) > 0 && pricedSummary?.unpricedCalls === 0)

const snapshots = afterPrice.body.priceSnapshots as Array<{ id: string }> | undefined
const secondPrice = await json('/api/prices', {
  method: 'POST', headers,
  body: JSON.stringify({
    provider: 'openai-compat', model: 'mock-chat-small',
    promptCentsPerMillion: 9_000_000, completionCentsPerMillion: 9_000_000, validFrom: Date.now(),
  }),
})
check('后续改价不重算已绑定历史', secondPrice.response.status === 201 && secondPrice.body.repriced === 0)

await json('/api/wallet/transactions', { method: 'POST', headers, body: JSON.stringify({ delta: 10, reason: '测试充值' }) })
await json('/api/wallet/transactions', { method: 'POST', headers, body: JSON.stringify({ delta: -3, reason: '测试支出' }) })
const wallet = await json(`/api/life/ledger?month=${month}`)
check('Life 账本展示钱包余额与不可变流水', (wallet.body.wallet as { balance?: number }).balance === 7
  && (wallet.body.walletTransactions as unknown[]).length === 2)

const overdraft = await json('/api/wallet/transactions', { method: 'POST', headers, body: JSON.stringify({ delta: -99, reason: '不应成功' }) })
check('账本拒绝透支', overdraft.response.status === 400)

const monthView = await json(`/api/life/month?month=${month}`)
const totals = monthView.body.totals as { apiCalls?: number; unpricedCalls?: number }
check('月历按服务端事实源聚合', monthView.response.ok && totals.apiCalls === 1 && totals.unpricedCalls === 0)

const days = monthView.body.days as Array<{ dayKey: string }> | undefined
const detail = await json(`/api/life/day/${days?.[0]?.dayKey ?? `${month}-01`}`)
const usage = detail.body.usage as Array<{ priceSnapshotId?: string }> | undefined
check('日期下钻保留用量与价格来源', detail.response.ok && usage?.[0]?.priceSnapshotId === snapshots?.[0]?.id)
check('日期下钻返回共同生活时间线投影', detail.response.ok && Array.isArray(detail.body.timeline))

const readAll = await json('/api/notifications/read-all', { method: 'PATCH' })
check('通知中心支持全部已读', readAll.response.ok && readAll.body.updated === 0)

const badMonth = await json('/api/life/month?month=2026-13')
check('非法月份被拒绝', badMonth.response.status === 400)

const badPush = await json('/api/push/subscription', {
  method: 'PUT', headers,
  body: JSON.stringify({ endpoint: 'https://push.invalid/1', keys: { p256dh: 'x', auth: 'y' } }),
})
check('服务端未配置 VAPID 时拒绝假订阅', badPush.response.status === 400)

console.log(`\n=== Phase 4 full-chain probe：${passed} passed / ${failed} failed ===`)
if (failed > 0) process.exitCode = 1
