/** V2-B：上下文压缩接口闭环探针。
 *
 * 跑法：先按 README 启动 mock-openai 与 habitat-server，随后：
 *   PROBE_SERVER=http://127.0.0.1:3237 npx tsx scripts/probe-chat-compact.ts
 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

console.log(`\n=== Chat context compaction probe (${SERVER}) ===`)
const response = await fetch(`${SERVER}/api/chat/compact`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [
    { role: 'user', content: '我喜欢雨天散步。' },
    { role: 'assistant', content: '我记住了，之后可以一起留意天气。' },
  ] }),
})
const body = await response.json() as { summary?: unknown; profileId?: unknown; model?: unknown; usageRecordId?: unknown; error?: { message?: unknown } }
check('接口返回成功', response.ok, `status=${response.status}`)
check('摘要正文非空', typeof body.summary === 'string' && body.summary.trim() !== '', String(body.summary))
check('响应带方案与模型', typeof body.profileId === 'string' && typeof body.model === 'string')
check('摘要调用记入用量', typeof body.usageRecordId === 'number' && body.usageRecordId > 0, String(body.usageRecordId))

const bad = await fetch(`${SERVER}/api/chat/compact`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [] }),
})
const badBody = await bad.json() as { error?: { message?: unknown } }
check('空历史明确拒绝', bad.status === 400 && typeof badBody.error?.message === 'string')

console.log(`\n=== Chat context compaction probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
