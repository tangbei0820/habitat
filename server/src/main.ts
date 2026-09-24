// 必须是第一个 import：它要在 db/index.js 于模块加载期读环境变量之前把 .env 灌进来
import { envFileLoaded } from './lib/env.js'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { ApiError, ErrorCode } from '@shared/errors'
import { CapabilityService } from './capabilities/registry.js'
import { closeDb } from './db/index.js'
import { importProfiles } from './db/profiles.js'
import { pruneMcpDiagnostics } from './db/diagnostics.js'
import { RequestError } from './lib/errors.js'
import { GatewayError, McpGateway } from './mcp/gateway.js'
import { loadMcpRegistry } from './mcp/registry.js'
import { ProviderError } from './providers/errors.js'
import { LlmRegistry, loadProfiles } from './providers/registry.js'
import { NOCTURNE_TOOLS, NocturneMemoryProvider } from './providers/nocturne-memory.js'
import { loadEventideStateProvider } from './providers/eventide-state.js'
import { registerCapabilityRoutes } from './routes/capabilities.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerDiagnosticRoutes } from './routes/diagnostics.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerProviderRoutes } from './routes/providers.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerStateRoutes } from './routes/state.js'
import { registerAutomationRoutes } from './routes/automation.js'
import { registerLifeRoutes } from './routes/life.js'
import { registerMediaRoutes } from './routes/media.js'
import { registerToolRoutes } from './routes/tools.js'
import { AutomationService, startAutomationScheduler } from './services/automation.js'

const app = Fastify({
  // Phase 5 媒体仍走受控 data URL；给 8 MB 音频的 base64 膨胀留空间，具体端点再按类型收紧。
  bodyLimit: 12 * 1024 * 1024,
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})

// CORS：默认反射任意来源（仅本地开发可接受）。**上线前必须用 CORS_ORIGIN 收紧到具体域名**
// （逗号分隔），见 server/.env.example 与技术方案 §9-3。
const corsOrigin = process.env.CORS_ORIGIN?.trim()
await app.register(cors, corsOrigin !== undefined && corsOrigin !== '' ? { origin: corsOrigin.split(',').map((s) => s.trim()) } : { origin: true })

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
    case 'BUDGET_EXCEEDED':
      return 429
    default:
      return 502
  }
}

// 统一错误映射：业务错误一律 ApiError 形状，错误不静默
app.setErrorHandler((err: unknown, _req, reply) => {
  if (err instanceof GatewayError || err instanceof ProviderError || err instanceof RequestError) {
    const body: ApiError = { error: { code: err.code, message: err.message, detail: err.detail } }
    return reply.status(statusForCode(err.code)).send(body)
  }
  app.log.error(err)
  const body: ApiError = {
    error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
  }
  return reply.status(500).send(body)
})

const mcpConfigs = loadMcpRegistry()
const gateway = new McpGateway(mcpConfigs, app.log)
const memoryProvider = new NocturneMemoryProvider(gateway)
const stateProvider = loadEventideStateProvider()
// 能力面：静态声明（shared/capabilities.ts）+ 运行时依赖探测，合成 AI「现在真能做什么」的快照
const capabilityService = new CapabilityService(gateway, memoryProvider, stateProvider)
registerHealthRoutes(app, gateway, stateProvider)
registerDiagnosticRoutes(app)
registerMemoryRoutes(app, memoryProvider)
registerStateRoutes(app, stateProvider)
registerCapabilityRoutes(app, capabilityService)

// LLM 方案：**服务端 SQLite 是权威源**（见 db/profiles.ts）。
// 环境变量 HABITAT_LLM_PROFILES 仅作**首次种子**：从未导入过时一次性导入，之后改 .env 不再生效
const { profiles: seedProfiles, problems } = loadProfiles()
const importedProfiles = importProfiles(seedProfiles)
const llmRegistry = new LlmRegistry()
registerProviderRoutes(app, llmRegistry)
registerChatRoutes(app, llmRegistry, stateProvider, memoryProvider, capabilityService)
registerMediaRoutes(app, llmRegistry)
registerToolRoutes(app, gateway)
const automationService = new AutomationService(llmRegistry, stateProvider, memoryProvider, app.log)
registerAutomationRoutes(app, automationService)
registerLifeRoutes(app, gateway, stateProvider)
const stopAutomationScheduler = startAutomationScheduler(automationService, app.log)
if (!envFileLoaded) app.log.info('未发现 server/.env，按进程环境变量运行')
for (const problem of problems) app.log.warn({ problem }, 'LLM 方案配置被跳过')
if (importedProfiles > 0) {
  app.log.info({ count: importedProfiles }, '已从 HABITAT_LLM_PROFILES 导入方案（仅首次；此后以数据库为准）')
} else if (seedProfiles.length > 0) {
  app.log.info(
    { count: seedProfiles.length },
    'HABITAT_LLM_PROFILES 未导入（此前已导入过或数据库已有方案），请改用设置页编辑',
  )
}
const activeProfile = llmRegistry.active()
app.log.info(
  { profiles: llmRegistry.list().map((p) => p.id), active: activeProfile?.id ?? null },
  'LLM 方案已装载',
)
if (activeProfile === null) {
  app.log.warn('尚无 LLM 方案 —— 打开设置页添加，或设置 HABITAT_LLM_PROFILES')
}

// 诊断日志只增不减：启动时裁掉超量旧记录，防止表无限长大（保留策略见 db/index.ts）
const pruned = pruneMcpDiagnostics()
if (pruned > 0) app.log.info({ pruned }, '诊断日志超出保留上限，已裁掉最旧的记录')

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })

// MCP 是可降级外部依赖：先监听 HTTP，再在后台连接，不能让 SDK 的默认 60s 超时卡住整个服务。
// 失败后每分钟重试；同一时刻只允许一轮，避免慢连接重叠。未配置 URL 时不启动定时器。
let mcpCheckInFlight = false
let lastToolFace: string | null = null
async function checkMcpInBackground(): Promise<void> {
  if (mcpCheckInFlight) return
  mcpCheckInFlight = true
  try {
    await gateway.diagnostics()
    const nocturne = (await gateway.health()).find((item) => item.serverId === 'nocturne')
    if (nocturne?.state !== 'ready') return

    const missing = await memoryProvider.verifyToolFace()
    const signature = missing.length === 0 ? 'ready' : `missing:${missing.join(',')}`
    if (signature === lastToolFace) return
    lastToolFace = signature
    if (missing.length > 0) {
      app.log.warn(
        { missing, expected: Object.values(NOCTURNE_TOOLS) },
        'Nocturne 实例缺少记忆适配层需要的工具，记忆功能不可用 —— 先跑 npm run probe:nocturne-tools 核对工具面',
      )
    } else {
      app.log.info({ tools: Object.values(NOCTURNE_TOOLS) }, 'Nocturne 工具面自检通过')
    }
  } finally {
    mcpCheckInFlight = false
  }
}

const hasConfiguredMcp = mcpConfigs.some((config) => config.url !== null && config.url !== '')
const mcpRetryTimer = hasConfiguredMcp
  ? setInterval(() => void checkMcpInBackground(), 60_000)
  : null
mcpRetryTimer?.unref()
if (hasConfiguredMcp) void checkMcpInBackground()

async function shutdown(): Promise<void> {
  if (mcpRetryTimer !== null) clearInterval(mcpRetryTimer)
  stopAutomationScheduler()
  await app.close()
  await gateway.closeAll()
  closeDb()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
