// 必须是第一个 import：它要在 db/index.js 于模块加载期读环境变量之前把 .env 灌进来
import { envFileLoaded } from './lib/env.js'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { ApiError, ErrorCode } from '@shared/errors'
import { closeDb } from './db/index.js'
import { GatewayError, McpGateway } from './mcp/gateway.js'
import { loadMcpRegistry } from './mcp/registry.js'
import { ProviderError } from './providers/errors.js'
import { LlmRegistry, loadProfiles } from './providers/registry.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerProviderRoutes } from './routes/providers.js'

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})

await app.register(cors, { origin: true })

/** 带 shared 错误码的业务异常 → HTTP 状态码 */
function statusForCode(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return 404
    case 'BAD_REQUEST':
    case 'PROVIDER_NOT_CONFIGURED':
      return 400
    case 'UNAUTHORIZED':
    case 'PROVIDER_UNAUTHORIZED':
      return 401
    default:
      return 502
  }
}

// 统一错误映射：业务错误一律 ApiError 形状，错误不静默
app.setErrorHandler((err: unknown, _req, reply) => {
  if (err instanceof GatewayError || err instanceof ProviderError) {
    const body: ApiError = { error: { code: err.code, message: err.message, detail: err.detail } }
    return reply.status(statusForCode(err.code)).send(body)
  }
  app.log.error(err)
  const body: ApiError = {
    error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
  }
  return reply.status(500).send(body)
})

const gateway = new McpGateway(loadMcpRegistry(), app.log)
registerHealthRoutes(app, gateway)

// LLM 方案：坏配置只跳过并告警，不阻塞启动
const { profiles, problems } = loadProfiles()
const llmRegistry = new LlmRegistry(profiles)
registerProviderRoutes(app, llmRegistry)
if (!envFileLoaded) app.log.info('未发现 server/.env，按进程环境变量运行')
for (const problem of problems) app.log.warn({ problem }, 'LLM 方案配置被跳过')
app.log.info(
  { profiles: llmRegistry.list().map((p) => p.id), active: llmRegistry.active()?.id ?? null },
  'LLM 方案已装载',
)

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
