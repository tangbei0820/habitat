/**
 * MCP server 注册表（技术方案 §7.2② / §9 风险1）
 * 私有部署地址不进仓库，一律走环境变量。
 */

export interface McpServerConfig {
  id: string
  /** Streamable HTTP endpoint；null = 未配置 */
  url: string | null
  /** 可选 Bearer token */
  token: string | null
  /** 不含凭据的附加头；Nocturne 用 X-Namespace 隔离人格。 */
  headers?: Record<string, string>
}

export function loadMcpRegistry(env: NodeJS.ProcessEnv = process.env): McpServerConfig[] {
  return [
    {
      id: 'nocturne',
      url: env.MCP_NOCTURNE_URL ?? null,
      token: env.MCP_NOCTURNE_TOKEN ?? null,
      headers: env.MCP_NOCTURNE_NAMESPACE?.trim()
        ? { 'X-Namespace': env.MCP_NOCTURNE_NAMESPACE.trim() }
        : undefined,
    },
  ]
}
