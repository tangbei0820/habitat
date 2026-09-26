/**
 * 开发用 mock MCP server（技术方案 §9 风险1：先验证客户端代码再排真实链路）。
 * 零额外运行时依赖：node:http + 官方 SDK，独立进程 `npm run dev:mock-mcp`，默认 :3333。
 *
 * ⚠️ 2026-09-24 对齐真实实例的工具面：原先 mock 的是**官方 Demo v1.26** 那套
 * （`read_memory` / `search_memory` / `create_memory` / …），而自部署实例用的是
 * `breath` / `hold` / `trace` / `wander` / … 两套名字毫无交集。
 * 于是本地 mock 全绿、线上一调就炸 —— mock 长得不像被测对象，验了等于没验。
 *
 * 现在只 mock 适配层实际要用的三个工具（`breath` + `trace` + `hold`）加一个链路自检用的 `echo`。
 * **改实例或升级后，先跑工具面侦察再回来同步这里**：
 *   npm run probe:nocturne-tools        # 开发机
 *   bash probe-nocturne-tools-quick.sh  # 服务器
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** mock 记忆：实例是「抽屉 + 关键词」模型，没有 URI 树，所以这里也不用 URI。 */
interface MockMemory { kind: string; content: string }
const memories: MockMemory[] = [
  { kind: 'memory', content: '我是用于 Habitat 验收的 mock 记忆，北北晚上会去散步。' },
  { kind: 'feel', content: '傍晚的风让人安静下来，适合散步。' },
]

function toolText(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] }
}

/** McpServer 与 transport 一一对应（Protocol 不允许复用连接），每个会话新建一个 */
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'habitat-mock-mcp', version: '0.2.0' })
  mcp.registerTool(
    'echo',
    {
      description: '原样返回输入，验证 Gateway 工具调用链路',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: `mock echo: ${text}` }],
    }),
  )
  mcp.registerTool(
    'breath',
    { description: '新窗或者Compact后读取记忆。', inputSchema: {} },
    async () => toolText(`BREATH\n${memories.map((item) => `- [${item.kind}] ${item.content}`).join('\n')}`),
  )
  mcp.registerTool(
    'trace',
    { description: '按关键词搜索记忆。', inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).default(15) } },
    async ({ query, limit }) => {
      const found = memories.filter((item) => item.content.includes(query)).slice(0, limit)
      return toolText(
        found.length === 0
          ? '没有匹配的记忆。'
          : found.map((item) => `- [${item.kind}] ${item.content}`).join('\n'),
      )
    },
  )
  mcp.registerTool(
    'hold',
    {
      description: '写入长期沉淀。正文按原样留下，不走脱水器。kind：memory/feel/writing/unresolved/window/letter。',
      // 参数面按实例实测收敛（2026-09-26 工具面侦察）：content 必填，其余可选。
      // pinned / protected / drive / chord / importance 等适配层不透传，mock 也不收。
      inputSchema: {
        content: z.string(),
        kind: z.string().optional(),
        name: z.string().optional(),
        tags: z.string().optional(),
      },
    },
    async ({ content, kind, name, tags }) => {
      const record: MockMemory & { name?: string; tags?: string } = {
        kind: kind ?? 'memory',
        content: name ? `《${name}》${content}` : content,
        ...(tags === undefined ? {} : { tags }),
      }
      memories.push(record)
      const label = name ? `「${name}」` : ''
      return toolText(`已沉淀${label}（kind: ${record.kind}）。`)
    },
  )
  return mcp
}

const transports = new Map<string, StreamableHTTPServerTransport>()
const servers = new Map<string, McpServer>()

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw === '' ? undefined : JSON.parse(raw)
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url !== '/mcp') {
    res.writeHead(404).end(JSON.stringify({ error: 'not found' }))
    return
  }
  try {
    console.log('[mock-mcp]', req.method, req.url, 'sid-header:', req.headers['mcp-session-id'] ?? '-')
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const sid = req.headers['mcp-session-id']
      const existing = typeof sid === 'string' ? transports.get(sid) : undefined
      if (existing) {
        // 同会话后续请求（tools/list、tools/call 等）：路由到既有 transport
        await existing.handleRequest(req, res, body)
        return
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessionclosed: (sessionId) => {
          transports.delete(sessionId)
          servers.delete(sessionId)
        },
      })
      // 注意：sessionId 在处理 initialize 时才生成，connect 必须无条件执行
      const mcp = createMcpServer()
      // 会话在显式 DELETE 前一直有效；res close 只表示该 HTTP 响应结束（initialize 的 SSE 响应也会触发）
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
      if (transport.sessionId) {
        transports.set(transport.sessionId, transport)
        servers.set(transport.sessionId, mcp)
      }
    } else if (req.method === 'GET' || req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id']
      const transport = typeof sid === 'string' ? transports.get(sid) : undefined
      if (!transport) {
        res.writeHead(400).end(JSON.stringify({ error: 'unknown sessionId' }))
        return
      }
      await transport.handleRequest(req, res)
    } else {
      res.writeHead(405).end()
    }
  } catch (err) {
    console.error('[mock-mcp] request failed', err)
    if (!res.headersSent) res.writeHead(500).end(JSON.stringify({ error: String(err) }))
  }
})

const port = Number(process.env.MOCK_MCP_PORT ?? 3333)
httpServer.listen(port, () => {
  console.log(`[mock-mcp] Streamable HTTP MCP server on http://localhost:${port}/mcp`)
})
