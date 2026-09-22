/** 极简日志封装：后续可接错误上报（错误不静默铁律） */
export const log = {
  info: (...args: unknown[]): void => console.info('[habitat]', ...args),
  warn: (...args: unknown[]): void => console.warn('[habitat]', ...args),
  error: (...args: unknown[]): void => console.error('[habitat]', ...args),
}
