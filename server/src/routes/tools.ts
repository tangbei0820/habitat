import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type { ToolGateway } from '@shared/providers'
import type { McpToolDescriptor } from '@shared/types'
import { ProviderError } from '../providers/errors.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function registerToolRoutes(app: FastifyInstance, gateway: ToolGateway): void {
  app.get('/api/tools', async (): Promise<{ tools: McpToolDescriptor[] }> => {
    const groups = await gateway.listTools()
    const tools: McpToolDescriptor[] = []
    for (const group of groups) {
      if (!isRecord(group) || typeof group.serverId !== 'string' || !Array.isArray(group.tools)) continue
      for (const raw of group.tools) {
        if (!isRecord(raw) || typeof raw.name !== 'string') continue
        tools.push({
          serverId: group.serverId,
          name: raw.name,
          description: typeof raw.description === 'string' ? raw.description : null,
          inputSchema: isRecord(raw.inputSchema) ? raw.inputSchema : {},
        })
      }
    }
    return { tools }
  })

  app.post('/api/tools/call', async (request): Promise<{ result: unknown }> => {
    if (!isRecord(request.body)) throw new ProviderError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
    const { serverId, name, args } = request.body
    if (typeof serverId !== 'string' || serverId === '' || typeof name !== 'string' || name === '') {
      throw new ProviderError(ErrorCodes.BadRequest, 'serverId 与 name 必填')
    }
    if (!isRecord(args)) throw new ProviderError(ErrorCodes.BadRequest, 'args 必须是 JSON 对象')
    return { result: await gateway.callTool(serverId, name, args) }
  })
}
