/**
 * Provider 侧错误：带 shared 错误码，由路由层的统一错误处理器映射为 ApiError 形状。
 * （与 MCP 侧的 GatewayError 各管一片，互不耦合）
 */
import type { ErrorCode } from '@shared/errors.js'

export class ProviderError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
