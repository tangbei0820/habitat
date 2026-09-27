/**
 * V2-B：聊天“联网搜索”显式授权探针。
 *
 * 先按 README 启动 mock-openai 与 habitat-server，随后：
 *   PROBE_SERVER=http://127.0.0.1:3237 npx tsx scripts/probe-chat-web-search.ts
 */
import { createServer } from 'node:http'
import { searchWeb } from '../src/lib/web-fetch.js'

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

console.log(`\n=== Chat web search probe (${SERVER}) ===`)
const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(
    '<a class="result__a" href="https://example.com/a">Example A</a>' +
    '<div class="result__snippet">Fixture snippet A</div>' +
    '<a class="result__a" href="https://example.com/b">Example B</a>' +
    '<div class="result__snippet">Fixture snippet B</div>',
  )
})
await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const address = fixture.address()
const fixturePort = typeof address === 'object' && address !== null ? address.port : 0
const fixtureResults = await searchWeb('fixture query', { endpoint: `http://127.0.0.1:${fixturePort}/html` })
await new Promise<void>((resolve) => fixture.close(() => resolve()))
check('公开搜索结果解析标题 / 来源 / 摘要', fixtureResults.length === 2 && fixtureResults[0]?.url === 'https://example.com/a' && fixtureResults[1]?.snippet === 'Fixture snippet B')

const response = await fetch(`${SERVER}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: '请查一下今天公开网页上关于栖息地的资料。' }],
    webSearch: { query: 'Habitat AI companion' },
  }),
})
const raw = await response.text()
const events = raw
  .split(/\r?\n\r?\n/)
  .map((frame) => {
    const event = frame.match(/^event: ([^\n]+)/m)?.[1]
    const data = frame.match(/^data: (.+)$/m)?.[1]
    if (event === undefined || data === undefined) return null
    try { return { event, data: JSON.parse(data) as Record<string, unknown> } } catch { return null }
  })
  .filter((item): item is { event: string; data: Record<string, unknown> } => item !== null)
const tool = events.find((item) => item.event === 'tool-call')
const deltas = events.filter((item) => item.event === 'chat-delta').map((item) => typeof item.data.content === 'string' ? item.data.content : '').join('')
check('接口返回成功', response.ok, `status=${response.status}`)
check('产生联网工具卡', tool !== undefined)
check('工具名与结果状态完整', tool?.data.name === 'web_search' && typeof tool?.data.ok === 'boolean')
check('工具结果回灌后仍有模型回复', deltas.includes('工具返回'))
check('正常收尾', events.some((item) => item.event === 'chat-done'))

const bad = await fetch(`${SERVER}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], webSearch: { query: '' } }),
})
check('空查询明确拒绝', bad.status === 400)

console.log(`\n=== Chat web search probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
