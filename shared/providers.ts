/**
 * Provider / Gateway 接口族（技术方案 §7.1，定义于 shared/）
 * 业务代码只依赖这些接口；Adapter 在服务端注册表装配。
 * Phase 0 仅落地 ToolGateway 的最小形状，其余接口随对应 Phase 增补。
 */

/** ToolGateway：MCP 客户端聚合的统一出口（§7.2② 诊断链路） */
export interface ToolGateway {
  listTools(serverId?: string): Promise<unknown[]>
  callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown>
  health(): Promise<import('./types').McpServerHealth[]>
  diagnostics(): Promise<void>
}

export interface LLMProvider {
  streamChat(
    messages: Array<{ role: string; content: string }>,
    opts?: { tools?: unknown[]; model?: string },
  ): AsyncIterable<string>
}

export interface MemoryProvider {
  search(query: string): Promise<unknown[]>
  recall(boot?: boolean): Promise<unknown[]>
  read(id: string): Promise<unknown>
  create(entry: unknown): Promise<unknown>
  update(id: string, entry: unknown): Promise<unknown>
  delete(id: string): Promise<void>
}

export interface StateProvider {
  tick(now: Date): Promise<{ stateCard: unknown; payload: unknown }>
}

export interface TTSProvider {
  synthesize(text: string, voice: string): Promise<string>
}

export interface ImageProvider {
  vision(url: string): Promise<unknown>
  generate(prompt: string): Promise<string>
}

export interface SearchProvider {
  search(query: string): Promise<unknown[]>
}

export interface NotificationProvider {
  push(userId: string, payload: { title: string; body: string }): Promise<void>
}
