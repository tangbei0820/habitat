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
