/**
 * 通用的「调用方错误」异常：带 shared 错误码，由 `src/index.ts` 的统一错误处理器映射为 ApiError。
 *
 * 为什么需要它：`ProviderError` / `GatewayError` 各自绑定 LLM 与 MCP 两个子域，
 * 而参数校验（`limit` 给了个负数之类）既不属于其中任何一个。此前这类错误只能落到
 * 「未识别异常 → 500」，等于把「你参数写错了」报成「服务端崩了」。
 */
import type { ErrorCode } from '@shared/errors.js'

export class RequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}
