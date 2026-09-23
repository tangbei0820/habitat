/**
 * 展示层的格式化小工具。
 *
 * 刻意保持「只做投影、不做判断」—— 这里不该出现业务规则（比如「多久算超时」），
 * 那些属于调用方。放在 `lib/` 而不是某个组件里，是因为跨模块复用（语音条时长
 * 既要在气泡上显示，也要进对话上下文的占位描述）。
 */

/**
 * 时长 → `m:ss`。
 *
 * 单位是毫秒（`Date.now()` 的差值直接喂进来）。负数按 0 处理：
 * 时钟回拨或录音起止算错时，宁可显示 `0:00` 也不要在界面上出现 `-1:-3`。
 */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalSeconds = Math.floor(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
