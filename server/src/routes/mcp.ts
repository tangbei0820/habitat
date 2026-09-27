/** MCP Manager：连接注册、启停、真实探测与工具清单。前端只拿脱敏配置。 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type {
  McpManagerState,
  McpServerCreateInput,
  McpServerUpdateInput,
  McpServerView,
  McpTestResult,
  McpToolView,
} from '@shared/types'
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
} from '../db/mcp-servers.js'
import { GatewayError, McpGateway } from '../mcp/gateway.js'
import { RequestError } from '../lib/errors.js'

interface IdParams { id: string }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

function stringField(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new RequestError(ErrorCodes.BadRequest, `${name} 必填`)
  const result = value.trim()
  if (result.length > max) throw new RequestError(ErrorCodes.BadRequest, `${name} 最长 ${max} 字`)
  return result
}

function urlField(value: unknown, name = 'url'): string {
  const url = stringField(value, name, 500)
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new RequestError(ErrorCodes.BadRequest, `${name} 不是合法 URL`) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RequestError(ErrorCodes.BadRequest, `${name} 只支持 http / https`)
  }
  return url
}

function headersField(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(ErrorCodes.BadRequest, 'headers 必须是 JSON 对象')
  }
  const headers: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key.length > 120 || typeof raw !== 'string' || raw.length > 2_000) {
      throw new RequestError(ErrorCodes.BadRequest, `headers['${key}'] 必须是长度合适的字符串`)
    }
    headers[key] = raw
  }
  return headers
}

function boolField(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new RequestError(ErrorCodes.BadRequest, `${name} 必须是布尔值`)
  return value
}

function parseCreate(raw: unknown): McpServerCreateInput & { id?: string } {
  const body = record(raw)
  const id = body.id === undefined ? undefined : stringField(body.id, 'id', 60).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  if (id === '') throw new RequestError(ErrorCodes.BadRequest, 'id 无有效字符')
  const input: McpServerCreateInput & { id?: string } = {
    ...(id === undefined ? {} : { id }),
    name: stringField(body.name, 'name', 60),
    url: urlField(body.url),
    ...(typeof body.token === 'string' && body.token.trim() !== '' ? { token: body.token.trim() } : {}),
    ...(body.headers === undefined ? {} : { headers: headersField(body.headers) }),
    ...(body.enabled === undefined ? {} : { enabled: boolField(body.enabled, 'enabled') }),
    ...(body.allowAutonomous === undefined ? {} : { allowAutonomous: boolField(body.allowAutonomous, 'allowAutonomous') }),
  }
  return input
}

function parseUpdate(raw: unknown): McpServerUpdateInput {
  const body = record(raw)
  const patch: McpServerUpdateInput = {}
  if (body.name !== undefined) patch.name = stringField(body.name, 'name', 60)
  if (body.url !== undefined) patch.url = urlField(body.url)
  if (body.token !== undefined) {
    if (typeof body.token !== 'string') throw new RequestError(ErrorCodes.BadRequest, 'token 必须是字符串')
    if (body.token.trim() !== '') patch.token = body.token.trim()
  }
  if (body.clearToken !== undefined) patch.clearToken = boolField(body.clearToken, 'clearToken')
  if (body.headers !== undefined) patch.headers = headersField(body.headers)
  if (body.enabled !== undefined) patch.enabled = boolField(body.enabled, 'enabled')
  if (body.allowAutonomous !== undefined) patch.allowAutonomous = boolField(body.allowAutonomous, 'allowAutonomous')
  if (Object.keys(patch).length === 0) throw new RequestError(ErrorCodes.BadRequest, '没有要更新的字段')
  return patch
}

function view(record: ReturnType<typeof getMcpServer>, health: Awaited<ReturnType<McpGateway['health']>>[number]): McpServerView {
  if (record === null) throw new RequestError(ErrorCodes.NotFound, 'MCP server 不存在')
  return {
    serverId: record.row.id,
    name: record.row.name,
    state: health.state,
    configured: record.row.url !== '',
    enabled: record.row.enabled,
    allowAutonomous: record.row.allowAutonomous,
    toolCount: health.toolCount,
    lastError: health.lastError,
    lastCheckedAt: health.lastCheckedAt,
    url: record.row.url === '' ? null : record.row.url,
    hasToken: record.hasToken,
    headerNames: Object.keys(record.row.headers ?? {}),
    createdAt: record.row.createdAt,
    updatedAt: record.row.updatedAt,
  }
}

async function reload(gateway: McpGateway): Promise<void> {
  const { listMcpServerConfigs } = await import('../db/mcp-servers.js')
  await gateway.replaceServers(listMcpServerConfigs())
}

export function registerMcpRoutes(app: FastifyInstance, gateway: McpGateway): void {
  app.get('/api/mcp/servers', async (): Promise<McpManagerState> => {
    const health = await gateway.health()
    const byId = new Map(health.map((item) => [item.serverId, item]))
    return {
      servers: listMcpServers().map((item) => {
        const current = byId.get(item.row.id)
        if (current === undefined) throw new RequestError(ErrorCodes.Internal, `MCP server '${item.row.id}' 状态缺失`)
        return view(item, current)
      }),
    }
  })

  app.post('/api/mcp/servers', async (request, reply): Promise<McpServerView> => {
    try {
      const created = createMcpServer(parseCreate(request.body))
      await reload(gateway)
      const health = (await gateway.health()).find((item) => item.serverId === created.row.id)
      if (health === undefined) throw new RequestError(ErrorCodes.Internal, 'MCP server 状态装载失败')
      reply.status(201)
      return view(created, health)
    } catch (err) {
      if (err instanceof RequestError) throw err
      throw new RequestError(ErrorCodes.BadRequest, err instanceof Error ? err.message : String(err))
    }
  })

  app.patch<{ Params: IdParams }>('/api/mcp/servers/:id', async (request): Promise<McpServerView> => {
    try {
      const updated = updateMcpServer(request.params.id, parseUpdate(request.body))
      await reload(gateway)
      const health = (await gateway.health()).find((item) => item.serverId === updated.row.id)
      if (health === undefined) throw new RequestError(ErrorCodes.Internal, 'MCP server 状态装载失败')
      return view(updated, health)
    } catch (err) {
      if (err instanceof RequestError) throw err
      if (err instanceof GatewayError) throw err
      throw new RequestError(ErrorCodes.BadRequest, err instanceof Error ? err.message : String(err))
    }
  })

  app.delete<{ Params: IdParams }>('/api/mcp/servers/:id', async (request): Promise<{ deleted: true }> => {
    if (!deleteMcpServer(request.params.id)) throw new RequestError(ErrorCodes.NotFound, 'MCP server 不存在')
    await reload(gateway)
    return { deleted: true }
  })

  app.post<{ Params: IdParams }>('/api/mcp/servers/:id/test', async (request): Promise<McpTestResult> => {
    if (getMcpServer(request.params.id) === null) throw new RequestError(ErrorCodes.NotFound, 'MCP server 不存在')
    return gateway.test(request.params.id)
  })

  app.get<{ Params: IdParams }>('/api/mcp/servers/:id/tools', async (request): Promise<{ tools: McpToolView[] }> => {
    if (getMcpServer(request.params.id) === null) throw new RequestError(ErrorCodes.NotFound, 'MCP server 不存在')
    const groups = await gateway.listTools(request.params.id)
    const tools: McpToolView[] = []
    for (const group of groups) {
      if (typeof group !== 'object' || group === null || !Array.isArray((group as { tools?: unknown }).tools)) continue
      for (const raw of (group as { tools: unknown[] }).tools) {
        if (typeof raw !== 'object' || raw === null || typeof (raw as { name?: unknown }).name !== 'string') continue
        const tool = raw as { name: string; description?: unknown; inputSchema?: unknown }
        tools.push({
          serverId: request.params.id,
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : null,
          inputSchema: typeof tool.inputSchema === 'object' && tool.inputSchema !== null && !Array.isArray(tool.inputSchema)
            ? tool.inputSchema as Record<string, unknown>
            : {},
        })
      }
    }
    return { tools }
  })
}
