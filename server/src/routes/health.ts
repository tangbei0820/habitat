/**
 * 健康与 MCP 诊断路由（技术方案 §7.2② → 前端 ●/⚠️ 数据源）
 */
import type { FastifyInstance } from 'fastify'
import type { McpHealth, ServerHealth } from '@shared/types'
import type { McpGateway } from '../mcp/gateway'

export function registerHealthRoutes(app: FastifyInstance, gateway: McpGateway): void {
  app.get('/api/health', async (): Promise<ServerHealth> => ({
    ok: true,
    service: 'habitat-server',
    time: new Date().toISOString(),
  }))

  app.get('/api/health/mcp', async (): Promise<McpHealth> => {
    const servers = await gateway.health()
    return { ok: servers.every((s) => s.state === 'ready'), servers }
  })
}
