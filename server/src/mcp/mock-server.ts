/**
 * 开发用 mock MCP server（技术方案 §9 风险1：先验证客户端代码再排真实链路）。
 * 零额外运行时依赖：node:http + 官方 SDK，独立进程 `npm run dev:mock-mcp`，默认 :3333。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** McpServer 与 transport 一一对应（Protocol 不允许复用连接），每个会话新建一个 */
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'habitat-mock-mcp', version: '0.1.0' })
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
      const url = new URL(req.url, 'http://localhost')
      const sid = url.searchParams.get('sessionId')
      const transport = sid ? transports.get(sid) : undefined
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
