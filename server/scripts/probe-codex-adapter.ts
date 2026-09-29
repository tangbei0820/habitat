/** Codex Subscription Provider 生命周期探针：并发隔离、usage、取消与进程关闭。 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiProfile } from '@shared/types.js'
import type { LlmStreamChunk } from '@shared/providers.js'
import { CodexAppServerProvider } from '../src/providers/codex-app-server.js'

let passed = 0
let failed = 0

function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

const directory = mkdtempSync(join(tmpdir(), 'habitat-codex-probe-'))
const mockPath = join(directory, 'mock-app-server.cjs')
writeFileSync(mockPath, `
const readline = require('node:readline')
let threadCount = 0
let turnCount = 0
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  const method = message.method
  if (method === 'initialize') { out({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1' } }); return }
  if (method === 'thread/start') { threadCount += 1; out({ jsonrpc: '2.0', id: message.id, result: { thread: { id: 'thread-' + threadCount } } }); return }
  if (method === 'model/list') { out({ jsonrpc: '2.0', id: message.id, result: { data: [{ id: 'gpt-probe' }] } }); return }
  if (method === 'turn/start') {
    turnCount += 1
    const turnId = 'turn-' + turnCount
    out({ jsonrpc: '2.0', id: message.id, result: { turn: { id: turnId } } })
    const text = message.params.input[0].text.includes('第二') ? '第二路' : '第一路'
    const delay = text.includes('第一') || text.includes('第二') ? 5 : 35
    setTimeout(() => out({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { turnId, delta: text } }), delay)
    setTimeout(() => out({ jsonrpc: '2.0', method: 'turn/usage', params: { turnId, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } } }), delay + 10)
    setTimeout(() => out({ jsonrpc: '2.0', method: 'turn/completed', params: { turnId, usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } } }), delay + 20)
    return
  }
  if (method === 'turn/cancel') {
    out({ jsonrpc: '2.0', id: message.id, result: {} })
    setTimeout(() => out({ jsonrpc: '2.0', method: 'turn/cancelled', params: { turnId: message.params.turnId } }), 1)
  }
})
`)

process.env.HABITAT_CODEX_APP_SERVER_COMMAND = `node ${mockPath}`
const profile: ApiProfile = {
  id: 'codex-probe', name: 'Codex probe', provider: 'codex-subscription', baseUrl: 'codex://local',
  keyRef: '', modelMap: { chat: 'gpt-probe' }, isActive: true,
}
const provider = new CodexAppServerProvider(profile)

async function collect(stream: AsyncIterable<LlmStreamChunk>): Promise<{ text: string; usage: LlmStreamChunk[] }> {
  let text = ''
  const chunks: LlmStreamChunk[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
    if (chunk.type === 'delta' && chunk.delta.content !== undefined) text += chunk.delta.content
  }
  return { text, usage: chunks }
}

try {
  const models = await provider.listModels()
  check('Codex app-server 可读取模型列表', models.includes('gpt-probe'))

  const [first, second] = await Promise.all([
    collect(provider.streamChat([{ role: 'user', content: '第一路' }], { conversationId: 'session-a' })),
    collect(provider.streamChat([{ role: 'user', content: '第二路' }], { conversationId: 'session-b' })),
  ])
  check('并发会话不会串用彼此的 turn 事件', first.text === '第一路' && second.text === '第二路')
  check('Codex usage 事件映射为统一 usage chunk', first.usage.some((chunk) => chunk.type === 'usage' && chunk.usage.totalTokens === 5))

  const controller = new AbortController()
  const iterator = provider.streamChat([{ role: 'user', content: '取消这一路' }], { conversationId: 'session-c', signal: controller.signal })[Symbol.asyncIterator]()
  const firstChunk = await iterator.next()
  controller.abort()
  let cancelled = false
  try { await iterator.next() } catch { cancelled = true }
  await iterator.return?.()
  check('客户端取消会结束当前 turn，不影响后续进程', firstChunk.done !== true && cancelled)

  await provider.dispose()
  const recovered = await collect(provider.streamChat([{ role: 'user', content: '重启后恢复' }], { conversationId: 'session-a' }))
  check('app-server 进程重启后会懒重建并恢复会话请求', recovered.text === '第一路')
} finally {
  await provider.dispose()
  rmSync(directory, { recursive: true, force: true })
}

console.log(`\nCodex adapter probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

export {}
