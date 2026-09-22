import { ErrorCodes, type ApiError, type ErrorCode } from '@shared/errors'

export class ApiRequestError extends Error {
  code: ErrorCode
  detail: unknown

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

async function parseError(res: Response): Promise<ApiRequestError> {
  try {
    const body = (await res.json()) as Partial<ApiError>
    if (body.error) {
      return new ApiRequestError(body.error.code, body.error.message, body.error.detail)
    }
  } catch {
    // 非 JSON 响应，落到通用错误
  }
  return new ApiRequestError(ErrorCodes.UpstreamError, `请求失败：HTTP ${res.status}`)
}

/** fetch 封装：统一抛 ApiRequestError，调用方必须显式处理（不静默） */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}
