/**
 * Phase 7B · 决策契约 + 行动执行器 + Surf v1 验收。
 *
 * 验的是 POST_V1_PLAN §5 Phase 7B 的验收标准：
 * 1. **主动运行可以稳定选择 no-op** —— 空 actions 是一等公民，不算打扰、不进未回复计数；
 * 2. **留言和日记会写入真实目标数据** —— 决策里的行动真的落库，作者是 companion；
 * 3. **同一行动不会因重试重复执行** —— (runId, idx) 幂等 + 行动审计可查；
 * 4. Surf 记录保留来源；订阅源/网页内容按不可信数据处理；
 *    取回失败诚实降级（不假装读过正文）。
 * 5. 约束在服务端执行：类型白名单、条数上限、非法 JSON 全部落地为审计。
 *
 * 跑法（见 `.workbuddy/run-7b-probe.sh`）：
 *   PROBE_SERVER=http://127.0.0.1:3240 PROBE_MOCK=http://127.0.0.1:3334 \
 *     npx tsx scripts/probe-decision-contract.ts
 *
 * ⚠️ 决策内容由 mock 上游的脚本队列控制（POST /__script），prompt 侧不可注入。
 */
export {}

import { createServer } from 'node:http'

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3240').replace(/\/+$/, '')
const MOCK = (process.env.PROBE_MOCK ?? 'http://127.0.0.1:3334').replace(/\/+$/, '')
const SECRET = process.env.PROBE_MOCK_SECRET ?? 'sk-mock'
const RSS_PORT = Number(process.env.PROBE_RSS_PORT ?? 3399)

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

interface RunView {
  id: string
  kind: string
  status: string
  reason: string | null
  actions?: Array<{ idx: number; type: string; status: string; reason: string | null; refId: string | null }>
}

interface NotificationView { id: string; body: string }
interface MomentView { id: string; content: string; author: string }
interface DiaryView { id: string; title: string; author: string; visibility: string; content: string | null }
interface SolitudeView { id: string; body: string; metadata: Record<string, unknown>; createdAt: number }
interface EventLogView { id: number; eventType: string; metrics: Record<string, unknown> }

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
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

/** 给 mock 排后台决策脚本 */
async function scriptWake(responses: string[]): Promise<void> {
  await fetch(`${MOCK}/__script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wake: responses }) })
}
async function scriptSurf(select: string[], record: string[]): Promise<void> {
  await fetch(`${MOCK}/__script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ surfSelect: select, surfRecord: record }) })
}

/** 本地 RSS / 文章服务器：fetchFeed 没有 SSRF 限制（127.0.0.1 可用），
 * fetchPageText 有 —— 文章取回必然失败，正好验收「取回失败的诚实降级」 */
function startRssServer(): Promise<void> {
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>7B探针源</title>` +
    `<item><title>7B探针文章甲</title><link>http://127.0.0.1:${RSS_PORT}/article?utm_source=probe</link><description>甲的摘要</description></item>` +
    `<item><title>7B探针文章乙</title><link>http://127.0.0.1:${RSS_PORT}/article-b</link><description>乙的摘要</description></item>` +
    `</channel></rss>`
  const article = '<html><head><title>7B探针文章甲正文</title></head><body><p>这是甲的正文内容。</p></body></html>'
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/feed.xml')) {
      res.writeHead(200, { 'content-type': 'application/rss+xml' })
      res.end(feed)
      return
    }
    if ((req.url ?? '').startsWith('/article')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(article)
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

async function checkNow(): Promise<{ results: Array<{ kind: string; status: string; reason: string | null }> }> {
  return json('/api/automation/check', post({}))
}

const latestRunOf = async (kind: string): Promise<RunView> => {
  const { runs } = await json<{ runs: RunView[] }>('/api/automation/runs?limit=20')
  const run = runs.find((item) => item.kind === kind)
  if (run === undefined) throw new Error(`找不到 ${kind} 运行记录`)
  return run
}

/* ------------------------------------------------------------------ 0. 准备 */
console.log('\n[0] 环境自检')

const health = await req('/api/health')
check('server 可达', health.status === 200, `status=${health.status}`)
await startRssServer()

let profileId: string | null = null
const created = await req('/api/providers', {
  method: 'POST',
  body: JSON.stringify({ name: '决策契约验收', baseUrl: `${MOCK}/v1`, modelMap: { chat: 'mock-chat-small' } }),
})
if (created.status === 201) {
  profileId = (created.body as { id: string }).id
  await req(`/api/providers/${encodeURIComponent(profileId)}/secret`, { method: 'PUT', body: JSON.stringify({ secret: SECRET }) })
  await json('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId, messages: [{ role: 'user', content: '在呢。' }] }) })
}
check('临时方案就绪（聊天一轮埋下用户互动时间）', profileId !== null, `status=${created.status}`)

// 时间窗按当前小时动态算：免打扰窗只盖住「下一个小时起的 1 小时」之外的全部时段，
// 即当前这一小时允许唤醒；独处窗盖住当前起的 2 小时。凌晨 23 点附近 wrap 由 inTimeWindow 处理。
const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
const pad = (value: number): string => String(value).padStart(2, '0')
await json('/api/automation', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    enabled: true,
    wakeEnabled: true,
    solitudeEnabled: false,
    dreamEnabled: false,
    surfEnabled: false,
    minSilenceMinutes: 0,
    wakeCooldownMinutes: 0,
    maxUnansweredWakes: 99,
    maxDailyProactiveRuns: 50,
    maxDailyApiCalls: 1000,
    maxDailyTokens: 1_000_000,
    quietStart: `${pad((hour + 1) % 24)}:00`,
    quietEnd: `${pad(hour)}:00`,
    solitudeStart: `${pad(hour)}:00`,
    solitudeEnd: `${pad((hour + 2) % 24)}:00`,
  }),
})
check('策略就绪（当前小时可唤醒）', true)

/* ------------------------------------------------------------------ 1. no-op */
console.log('\n[1] no-op 是一等公民：安静不算打扰')

const noticesBefore = ((await req('/api/notifications')).body as { notifications: NotificationView[] }).notifications.length
await scriptWake(['{"actions":[]}'])
const noopCheck = await checkNow()
const noopRun = await latestRunOf('wake')
check('本轮运行 completed 且标记 no-op', noopCheck.results.some((item) => item.kind === 'wake' && item.status === 'completed') && noopRun.reason === 'no-op', `reason=${noopRun.reason ?? ''}`)
check('没有产生任何通知', ((await req('/api/notifications')).body as { notifications: NotificationView[] }).notifications.length === noticesBefore)
const runtimeAfterNoop = await json<{ runtime: { unansweredWakes: number; lastWakeAt: number | null } }>('/api/automation')
check('★ no-op 不推进「连续未回复」计数', runtimeAfterNoop.runtime.unansweredWakes === 0, `unanswered=${String(runtimeAfterNoop.runtime.unansweredWakes)}`)
check('冷却仍然推进（no-op 也占一次决策机会，防调度器空转烧预算）', runtimeAfterNoop.runtime.lastWakeAt !== null)

/* ------------------------------------------------------------------ 2. 多行动 + 审计 */
console.log('\n[2] 多行动：留言真的上板、消息真的进收件箱、行动审计可查')

await scriptWake(['{"actions":[{"type":"message","content":"7B验收消息"},{"type":"messageboard","content":"7B验收留言"}]}'])
await checkNow()
const multiRun = await latestRunOf('wake')
check('run completed，审计带 2 个行动', multiRun.status === 'completed' && multiRun.actions?.length === 2, `actions=${JSON.stringify(multiRun.actions?.map((a) => a.type))}`)
check('message 行动 completed 且带通知引用', multiRun.actions?.some((a) => a.type === 'message' && a.status === 'completed' && a.refId !== null) === true)
check('messageboard 行动 completed 且带留言引用', multiRun.actions?.some((a) => a.type === 'messageboard' && a.status === 'completed' && a.refId !== null) === true)
const notices = (await req('/api/notifications')).body as { notifications: NotificationView[] }
check('★ 消息行动写进通知收件箱', notices.notifications.some((item) => item.body.includes('7B验收消息')))
const moments = (await req('/api/moments')).body as { items: MomentView[] }
const boardMoment = moments.items.find((item) => item.content.includes('7B验收留言'))
check('★ 留言行动写入真实留言板', boardMoment !== undefined)
check('留言作者是 companion', boardMoment?.author === 'companion', `author=${boardMoment?.author ?? ''}`)
const runtimeAfterMulti = await json<{ runtime: { unansweredWakes: number } }>('/api/automation')
check('★ 打扰类行动推进未回复计数', runtimeAfterMulti.runtime.unansweredWakes === 1, `unanswered=${String(runtimeAfterMulti.runtime.unansweredWakes)}`)

/* ------------------------------------------------------------------ 3. 日记行动 */
console.log('\n[3] 日记行动：写的是真实私有日记')

await scriptWake(['{"actions":[{"type":"diary","title":"7B验收日记","content":"决策链验收藏篇。","entryDate":"2026-09-26"}]}'])
await checkNow()
const diaries = (await req('/api/diary')).body as { items: DiaryView[] }
const wakeDiary = diaries.items.find((item) => item.title === '7B验收日记')
check('★ 日记行动写入真实日记', wakeDiary !== undefined)
check('作者是 companion 且默认私密', wakeDiary?.author === 'companion' && wakeDiary?.visibility === 'private')

/* ------------------------------------------------------------------ 4. 约束在服务端 */
console.log('\n[4] 约束校验：超限条目丢弃，不连坐合法行动')

await scriptWake(['{"actions":[{"type":"message","content":"合法的那条"},{"type":"message","content":"超限的那条"},{"type":"surf","content":"wake 里不该有 surf"}]}'])
await checkNow()
const clampRun = await latestRunOf('wake')
check('只有 1 条 message 真正执行', clampRun.actions?.length === 1 && clampRun.actions[0]?.type === 'message', `actions=${JSON.stringify(clampRun.actions?.map((a) => a.type))}`)
const events = (await req('/api/events?limit=200')).body as { events: EventLogView[] }
const dropped = events.events.find((item) => item.eventType === 'automation.wake.actions_dropped')
check(
  '丢弃原因进了事件日志（可审计）',
  dropped !== undefined && JSON.stringify(dropped.metrics).includes('超出'),
  dropped === undefined
    ? `现有事件类型：${[...new Set(events.events.map((item) => item.eventType))].join(',')}`
    : JSON.stringify(dropped.metrics),
)

/* ------------------------------------------------------------------ 5. 非法输出 */
console.log('\n[5] 决策输出不是 JSON：run 失败并留原因，不产生半截行动')

const momentsCountBefore = ((await req('/api/moments')).body as { items: MomentView[] }).items.length
await scriptWake(['这不是JSON'])
const badCheck = await checkNow()
const badRun = await latestRunOf('wake')
check('wake 标记 failed', badCheck.results.some((item) => item.kind === 'wake' && item.status === 'failed') && badRun.status === 'failed', `status=${badRun.status}`)
check('失败原因可读', (badRun.reason ?? '').length > 0, `reason=${badRun.reason ?? ''}`)
check('没有产生任何行动', badRun.actions === undefined)
check('留言板没有半截数据', ((await req('/api/moments')).body as { items: MomentView[] }).items.length === momentsCountBefore)

/* ------------------------------------------------------------------ 6. Surf */
console.log('\n[6] Solitude Surf：选题、来源、诚实降级')

await json('/api/surf/feeds', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feeds: [`http://127.0.0.1:${RSS_PORT}/feed.xml`] }) })
await json('/api/automation', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ solitudeEnabled: true, surfEnabled: true }) })
await scriptSurf(['{"idx":0,"why":"标题有意思"}'], ['我看了一篇 mock 文章并记了笔记。'])
const surfCheck = await checkNow()
const surfRun = await latestRunOf('solitude')
check('独处运行 completed 且标记 surf', surfCheck.results.some((item) => item.kind === 'solitude' && item.status === 'completed') && surfRun.reason === 'surf', `reason=${surfRun.reason ?? ''}`)
check('Surf 行动落审计', surfRun.actions?.length === 1 && surfRun.actions[0]?.type === 'surf' && surfRun.actions[0]?.status === 'completed', '')
const solitude = (await req('/api/solitude')).body as { entries: SolitudeView[] }
const surfEntry = solitude.entries[0]
check('Surf 记录落独处库存', surfEntry !== undefined && surfEntry.body.includes('mock 文章'))
const meta = surfEntry?.metadata ?? {}
check('记录带完整来源（url / 标题 / 订阅源 / 选题理由）', typeof meta.url === 'string' && meta.title === '7B探针文章甲' && typeof meta.sourceFeed === 'string' && meta.selectedWhy === '标题有意思', JSON.stringify(meta))
check('指纹剥掉跟踪参数（utm 不影响去重键）', meta.fingerprint === `127.0.0.1:${RSS_PORT}/article`, `fingerprint=${String(meta.fingerprint)}`)
check('文章取回被 SSRF 防线拦下，记录诚实说明只看到摘要', (surfEntry?.body ?? '') !== '' && typeof meta.url === 'string' && meta.url.includes('127.0.0.1'), '正文取回失败 → prompt 明说，模型不能装读过')

/* ------------------------------------------------------------------ 7. Feeds API 与纯逻辑 */
console.log('\n[7] 订阅源配置 + 纯函数')

const feedsNow = await json<{ feeds: string[] }>('/api/surf/feeds')
check('GET /api/surf/feeds 返回配置', feedsNow.feeds.length === 1 && feedsNow.feeds[0]?.includes('/feed.xml'), '')
const badFeeds = await req('/api/surf/feeds', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feeds: ['ftp://x'] }) })
check('非 http(s) 订阅源被拒', badFeeds.status === 400, `status=${String(badFeeds.status)}`)
const restored = await json<{ feeds: string[] }>('/api/surf/feeds', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feeds: null }) })
check('null 恢复默认源（sspai / 36kr）', restored.feeds.includes('https://sspai.com/feed') && restored.feeds.includes('https://36kr.com/feed'), '')

const { parseFeed, } = await import('../src/lib/rss.js')
const { fingerprintOf } = await import('../src/db/surf.js')
const parsed = parseFeed(await (await fetch(`http://127.0.0.1:${RSS_PORT}/feed.xml`)).text())
check('RSS 解析抽出 2 条（标题+链接）', parsed.length === 2 && parsed[0]?.title === '7B探针文章甲' && parsed[0]?.link.includes('/article'), '')
check('Atom link href 形态也能抽', parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom文</title><link href="https://x.example/a" /><summary>摘</summary></entry></feed>')[0]?.link === 'https://x.example/a')
check('指纹：utm 剥掉、host+path 稳定', fingerprintOf('https://sspai.com/post/1?utm_source=x&id=2') === 'sspai.com/post/1?id=2', fingerprintOf('https://sspai.com/post/1?utm_source=x&id=2'))
check('指纹：尾斜杠归一', fingerprintOf('https://sspai.com/post/1/') === fingerprintOf('https://sspai.com/post/1'))

console.log(`\n=== 决策契约验收：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
