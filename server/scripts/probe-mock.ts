import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const endpoint = new URL(process.env.MOCK_MCP_URL ?? 'http://localhost:3333/mcp')
const t = new StreamableHTTPClientTransport(endpoint)
const c = new Client({ name: 'probe', version: '0' }, { capabilities: {} })

const results: boolean[] = []
function check(label: string, ok: boolean, detail = ''): void {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` -> ${detail}`}`)
}

try {
  await c.connect(t)
  const sessionId = t.sessionId
  check('握手拿到 mcp-session-id', typeof sessionId === 'string' && sessionId.length > 0)
  if (sessionId === undefined) throw new Error('mock MCP 没有返回 session id')

  const tools = await c.listTools()
  const names = tools.tools.map((tool) => tool.name).sort()
  check('tools/list 返回真实 mock 工具面', ['breath', 'echo', 'trace'].every((name) => names.includes(name)), names.join(', '))

  const getController = new AbortController()
  const getTimeout = setTimeout(() => getController.abort(), 3_000)
  const stream = await fetch(endpoint, {
    headers: {
      accept: 'text/event-stream',
      'mcp-session-id': sessionId,
    },
    signal: getController.signal,
  })
  clearTimeout(getTimeout)
  // Client.connect() 已经占着一条 standalone SSE；同 session 再开一条时 SDK 按规范回 409。
  // 200（未占用）与 409（已占用）都证明请求已靠 header 路由进正确 transport；旧实现会在外层直接 400。
  check('GET SSE 使用 header 中的 session id', stream.status === 200 || stream.status === 409, `HTTP ${stream.status}`)
  await stream.body?.cancel()

  await t.terminateSession()
  check('DELETE 显式关闭会话', t.sessionId === undefined)

  const closed = await fetch(endpoint, {
    headers: {
      accept: 'text/event-stream',
      'mcp-session-id': sessionId,
    },
  })
  check('关闭后的 session 不再可用', closed.status === 400, `HTTP ${closed.status}`)
  await closed.body?.cancel()
} catch (error) {
  check('探针执行完成', false, error instanceof Error ? error.message : String(error))
} finally {
  await c.close().catch(() => undefined)
}

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
