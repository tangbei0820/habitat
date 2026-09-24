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

/**
 * 离线时提前把请求拦下。
 *
 * 不拦的话，用户看到的是 `TypeError: Failed to fetch` ——
 * 这句话既没说明原因，又跟「后端挂了」长得一模一样，排查时会被带偏。
 * 这里给一个明确的错误码与人话，界面据此就能说清「是断网，不是坏了」。
 *
 * ⚠️ 只是**兜底**：各处该禁用的按钮仍要禁用，否则用户要点一下才知道不能用。
 */
export function assertOnline(): void {
  if (navigator.onLine === false) {
    throw new ApiRequestError(ErrorCodes.Offline, '当前处于离线状态，联网后再试')
  }
}

/** fetch 封装：统一抛 ApiRequestError，调用方必须显式处理（不静默） */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  assertOnline()
  const res = await fetch(path, init)
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

/**
 * 与 `fetchJson` 同一套规则，但用于**没有响应体**的端点（204）。
 *
 * 单独一个函数而不是让 `fetchJson` 去猜：`res.json()` 对空体会直接抛 SyntaxError，
 * 而那个错误看起来像「响应坏了」，实际上「删除成功」就是这么设计的。
 * 用错函数的代价是一次毫无线索的排查，不如多一个函数名。
 */
export async function fetchVoid(path: string, init?: RequestInit): Promise<void> {
  assertOnline()
  const res = await fetch(path, init)
  if (!res.ok) throw await parseError(res)
}
