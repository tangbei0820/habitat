import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { ApiError } from '@shared/errors'
import { closeDb } from './db/index.js'
import { GatewayError, McpGateway } from './mcp/gateway.js'
import { loadMcpRegistry } from './mcp/registry.js'
import { registerHealthRoutes } from './routes/health.js'

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})

await app.register(cors, { origin: true })

// 统一错误映射：业务错误一律 ApiError 形状，错误不静默
app.setErrorHandler((err: unknown, _req, reply) => {
  if (err instanceof GatewayError) {
    const body: ApiError = { error: { code: err.code, message: err.message, detail: err.detail } }
    const status =
      err.code === 'NOT_FOUND' ? 404 : err.code === 'BAD_REQUEST' ? 400 : 502
    return reply.status(status).send(body)
  }
  app.log.error(err)
  const body: ApiError = { error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } }
  return reply.status(500).send(body)
})

const gateway = new McpGateway(loadMcpRegistry(), app.log)
registerHealthRoutes(app, gateway)

// 启动即连接 MCP server；单个失败不阻塞启动（状态机 + 诊断表已留痕）
await gateway.connectAll()

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })

async function shutdown(): Promise<void> {
  await app.close()
  await gateway.closeAll()
  closeDb()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
