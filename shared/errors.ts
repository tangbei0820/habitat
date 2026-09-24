/**
 * 统一错误码：前后端共用，错误不静默（Phase 0 验收项）。
 * 接口出错时返回 { error: { code, message, detail? } }。
 */
export const ErrorCodes = {
  BadRequest: 'BAD_REQUEST',
  Unauthorized: 'UNAUTHORIZED',
  NotFound: 'NOT_FOUND',
  UpstreamError: 'UPSTREAM_ERROR',
  McpHandshakeFailed: 'MCP_HANDSHAKE_FAILED',
  McpToolCallFailed: 'MCP_TOOL_CALL_FAILED',
  /** 方案 id 不存在 */
  ProviderNotFound: 'PROVIDER_NOT_FOUND',
  /** 方案缺必需配置（如密钥环境变量未设置、未指定 chat 模型） */
  ProviderNotConfigured: 'PROVIDER_NOT_CONFIGURED',
  /** 上游鉴权失败（401/403）——多半是密钥错或过期 */
  ProviderUnauthorized: 'PROVIDER_UNAUTHORIZED',
  /** 上游其它错误（非 2xx、连接失败、流中断） */
  ProviderUpstreamError: 'PROVIDER_UPSTREAM_ERROR',
  /** BudgetGuard 拒绝本次 LLM / 主动行为调用。 */
  BudgetExceeded: 'BUDGET_EXCEEDED',
  /**
   * 浏览器处于离线状态，请求在发出前就被拦下（Phase 6 §离线）。
   * ⚠️ 只由前端产生 —— 后端不会返回它。
   */
  Offline: 'OFFLINE',
  Internal: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

export interface ApiError {
  error: {
    code: ErrorCode
    message: string
    detail?: unknown
  }
}
