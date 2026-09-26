/**
 * MCP Gateway（技术方案 §7.2②）：官方 SDK 客户端聚合，不自研协议栈。
 * - 每个 server 一个状态机：disconnected → connecting → handshake → ready / error
 * - 连接与每次工具调用经诊断中间件全量落 mcp_diagnostic_log
 * - Streamable HTTP 优先（§9 风险1）
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FastifyBaseLogger } from 'fastify'
import { ErrorCodes, type ErrorCode } from '@shared/errors.js'
import type { ToolGateway } from '@shared/providers.js'
import type { McpServerHealth, McpServerState } from '@shared/types.js'
import { insertMcpDiagnostic } from '../db/diagnostics.js'
import type { McpServerConfig } from './registry.js'

/** 带 shared 错误码的异常，路由层统一映射为 ApiError 形状 */
export class GatewayError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

interface ServerRuntime {
  config: McpServerConfig
  state: McpServerState
  client: Client | null
  transport: StreamableHTTPClientTransport | null
  toolCount: number
  lastError: string | null
  lastCheckedAt: number | null
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class McpGateway implements ToolGateway {
  private readonly servers = new Map<string, ServerRuntime>()

  constructor(
    configs: McpServerConfig[],
    private readonly log?: FastifyBaseLogger,
  ) {
    for (const config of configs) {
      this.servers.set(config.id, {
        config,
        state: 'disconnected',
        client: null,
        transport: null,
        toolCount: 0,
        lastError: null,
        lastCheckedAt: null,
      })
    }
  }

  /** 启动时连接全部 server；单个失败只记日志，绝不阻塞服务启动（§9 风险1） */
  async connectAll(): Promise<void> {
    for (const [id, rt] of this.servers) {
      try {
        await this.connect(id, rt)
      } catch {
        // 错误已在 connect 内部落诊断表并更新状态机，这里仅保证不向上抛
      }
    }
  }

  async health(): Promise<McpServerHealth[]> {
    return [...this.servers.entries()].map(([serverId, rt]) => ({
      serverId,
      state: rt.state,
      // 「没配 URL」与「配了但连不上」是两种病，UI 要分开说（未配置 ≠ 异常）
      configured: Boolean(rt.config.url),
      toolCount: rt.toolCount,
      lastError: rt.lastError,
      lastCheckedAt: rt.lastCheckedAt,
    }))
  }

  /** 重连所有非 ready 的 server（供 diagnostics() / 定时探活复用） */
  async diagnostics(): Promise<void> {
    for (const [id, rt] of this.servers) {
      if (rt.state !== 'ready') {
        try {
          await this.connect(id, rt)
        } catch {
          // 同上：状态机与诊断表已记录
        }
      }
    }
  }

  async listTools(serverId?: string): Promise<unknown[]> {
    const targets = serverId
      ? [this.requireServer(serverId)]
      : [...this.servers.values()].filter((rt) => rt.state === 'ready')
    const results: unknown[] = []
    for (const rt of targets) {
      const client = this.requireReady(rt)
      const started = Date.now()
      try {
        const res = await client.listTools()
        insertMcpDiagnostic({
          serverId: rt.config.id,
          direction: 'out',
          method: 'tools/list',
          httpStatus: null, // SDK transport 不暴露 HTTP 状态码，留空
          handshake: false,
          latencyMs: Date.now() - started,
          error: null,
          at: Date.now(),
        })
        results.push({ serverId: rt.config.id, tools: res.tools })
      } catch (err) {
        insertMcpDiagnostic({
          serverId: rt.config.id,
          direction: 'out',
          method: 'tools/list',
          httpStatus: null,
          handshake: false,
          latencyMs: Date.now() - started,
          error: errMessage(err),
          at: Date.now(),
        })
        throw new GatewayError(ErrorCodes.McpToolCallFailed, `tools/list failed on '${rt.config.id}'`, errMessage(err))
      }
    }
    return results
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const rt = this.requireServer(serverId)
    const client = this.requireReady(rt)
    const started = Date.now()
    try {
      const res = await client.callTool({ name, arguments: args })
      insertMcpDiagnostic({
        serverId,
        direction: 'out',
        method: 'tools/call',
        httpStatus: null,
        handshake: false,
        latencyMs: Date.now() - started,
        error: null,
        at: Date.now(),
      })
      return res
    } catch (err) {
      insertMcpDiagnostic({
        serverId,
        direction: 'out',
        method: 'tools/call',
        httpStatus: null,
        handshake: false,
        latencyMs: Date.now() - started,
        error: errMessage(err),
        at: Date.now(),
      })
      throw new GatewayError(ErrorCodes.McpToolCallFailed, `tools/call '${name}' failed on '${serverId}'`, errMessage(err))
    }
  }

  async closeAll(): Promise<void> {
    for (const rt of this.servers.values()) {
      await rt.transport?.close().catch(() => undefined)
      rt.client = null
      rt.transport = null
      rt.state = 'disconnected'
    }
  }

  private requireServer(serverId: string): ServerRuntime {
    const rt = this.servers.get(serverId)
    if (!rt) {
      throw new GatewayError(ErrorCodes.NotFound, `unknown MCP server '${serverId}'`)
    }
    return rt
  }

  private requireReady(rt: ServerRuntime): Client {
    if (rt.state !== 'ready' || !rt.client) {
      throw new GatewayError(
        ErrorCodes.McpHandshakeFailed,
        `MCP server '${rt.config.id}' is not ready (state=${rt.state}${rt.lastError ? `, lastError=${rt.lastError}` : ''})`,
      )
    }
    return rt.client
  }

  private async connect(serverId: string, rt: ServerRuntime): Promise<void> {
    // 清理旧连接
    await rt.transport?.close().catch(() => undefined)
    rt.client = null
    rt.transport = null
    rt.toolCount = 0

    if (!rt.config.url) {
      rt.state = 'error'
      rt.lastError = 'not configured'
      rt.lastCheckedAt = Date.now()
      insertMcpDiagnostic({
        serverId,
        direction: 'out',
        method: 'initialize',
        httpStatus: null,
        handshake: false,
        latencyMs: null,
        error: 'not configured',
        at: Date.now(),
      })
      this.log?.warn({ serverId }, 'MCP server not configured')
      return
    }

    rt.state = 'connecting'
    const started = Date.now()
    try {
      const headers: Record<string, string> = { ...rt.config.headers }
      if (rt.config.token) headers.Authorization = `Bearer ${rt.config.token}`
      const transport = new StreamableHTTPClientTransport(new URL(rt.config.url), {
        requestInit: { headers },
      })
      const client = new Client({ name: 'habitat-gateway', version: '0.1.0' }, { capabilities: {} })

      rt.state = 'handshake'
      await client.connect(transport) // initialize 握手：卡在哪一层由此可判（§7.2②）

      const tools = await client.listTools()
      rt.client = client
      rt.transport = transport
      rt.toolCount = tools.tools.length
      rt.state = 'ready'
      rt.lastError = null
      insertMcpDiagnostic({
        serverId,
        direction: 'out',
        method: 'initialize',
        httpStatus: null,
        handshake: true,
        latencyMs: Date.now() - started,
        error: null,
        at: Date.now(),
      })
      this.log?.info({ serverId, toolCount: rt.toolCount }, 'MCP server ready')
    } catch (err) {
      rt.state = 'error'
      rt.lastError = errMessage(err)
      insertMcpDiagnostic({
        serverId,
        direction: 'out',
        method: 'initialize',
        httpStatus: null,
        handshake: true,
        latencyMs: Date.now() - started,
        error: errMessage(err),
        at: Date.now(),
      })
      this.log?.warn({ serverId, err: rt.lastError }, 'MCP handshake failed')
      throw err
    } finally {
      rt.lastCheckedAt = Date.now()
    }
  }
}
