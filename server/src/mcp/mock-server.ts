/**
 * 开发用 mock MCP server（技术方案 §9 风险1：先验证客户端代码再排真实链路）。
 * 零额外运行时依赖：node:http + 官方 SDK，独立进程 `npm run dev:mock-mcp`，默认 :3333。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

interface MockMemory { content: string; priority: number; disclosure: string; triggers: string[] }
const memories = new Map<string, MockMemory>([
  ['core://agent', { content: '我是用于 Habitat 验收的 mock 记忆。', priority: 0, disclosure: '启动时读取', triggers: [] }],
])
let memorySequence = 0

function toolText(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] }
}

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
  mcp.registerTool('read_memory', { inputSchema: { uri: z.string() } }, async ({ uri }) => {
    if (uri === 'system://boot') return toolText(`BOOT\n${memories.get('core://agent')?.content ?? ''}`)
    const memory = memories.get(uri)
    return toolText(memory === undefined ? `Error: Memory at '${uri}' not found.` : `${uri}\n${memory.content}`)
  })
  mcp.registerTool(
    'search_memory',
    { inputSchema: { query: z.string(), domain: z.string().optional(), limit: z.number().int().min(1).max(100).default(10) } },
    async ({ query, domain, limit }) => {
      const found = [...memories.entries()]
        .filter(([uri, memory]) => (domain === undefined || uri.startsWith(`${domain}://`)) && `${uri}\n${memory.content}`.includes(query))
        .slice(0, limit)
      return toolText(found.length === 0 ? 'No matching memories found across all domains.' : found.map(([uri, memory]) => `- ${uri}\n  ${memory.content}`).join('\n'))
    },
  )
  mcp.registerTool(
    'create_memory',
    { inputSchema: { parent_uri: z.string(), content: z.string(), priority: z.number().int().min(0), disclosure: z.string(), title: z.string().optional() } },
    async ({ parent_uri, content, priority, disclosure, title }) => {
      const leaf = title ?? String(++memorySequence)
      const uri = `${parent_uri.replace(/\/$/, '')}/${leaf}`
      if (memories.has(uri)) return toolText(`Error: Memory at '${uri}' already exists.`)
      memories.set(uri, { content, priority, disclosure, triggers: [] })
      return toolText(`Success: Memory created at '${uri}'`)
    },
  )
  mcp.registerTool(
    'update_memory',
    { inputSchema: { uri: z.string(), old_string: z.string().optional(), new_string: z.string().optional(), append: z.string().optional(), priority: z.number().int().min(0).optional(), disclosure: z.string().optional() } },
    async ({ uri, old_string, new_string, append, priority, disclosure }) => {
      const memory = memories.get(uri)
      if (memory === undefined) return toolText(`Error: Memory at '${uri}' not found.`)
      if (old_string !== undefined) {
        if (new_string === undefined || !memory.content.includes(old_string)) return toolText(`Error: Could not find any match for old_string in '${uri}'.`)
        memory.content = memory.content.replace(old_string, new_string)
      } else if (append !== undefined) memory.content += append
      if (priority !== undefined) memory.priority = priority
      if (disclosure !== undefined) memory.disclosure = disclosure
      return toolText(`Success: Memory at '${uri}' updated`)
    },
  )
  mcp.registerTool('delete_memory', { inputSchema: { uri: z.string() } }, async ({ uri }) => {
    if (!memories.delete(uri)) return toolText(`Error: Memory at '${uri}' not found.`)
    return toolText(`Success: Memory '${uri}' deleted.`)
  })
  mcp.registerTool(
    'add_alias',
    { inputSchema: { new_uri: z.string(), target_uri: z.string(), priority: z.number().int().min(0), disclosure: z.string() } },
    async ({ new_uri, target_uri, priority, disclosure }) => {
      const target = memories.get(target_uri)
      if (target === undefined) return toolText(`Error: Memory at '${target_uri}' not found.`)
      memories.set(new_uri, { ...target, priority, disclosure, triggers: [...target.triggers] })
      return toolText(`Success: Alias '${new_uri}' now points to same memory as '${target_uri}'`)
    },
  )
  mcp.registerTool(
    'manage_triggers',
    { inputSchema: { uri: z.string(), add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() } },
    async ({ uri, add = [], remove = [] }) => {
      const memory = memories.get(uri)
      if (memory === undefined) return toolText(`Error: Memory at '${uri}' not found.`)
      memory.triggers = [...new Set([...memory.triggers, ...add])].filter((item) => !remove.includes(item))
      return toolText(`Keywords for '${uri}': ${memory.triggers.join(', ') || '(none)'}`)
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
