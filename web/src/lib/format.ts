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

/**
 * 时间戳 → 相对时间（「刚刚 / 12 分钟前 / 3 小时前 / 2 天前」）。
 *
 * 超过 30 天不再说「多少天前」—— 那个数字对人已经没有意义，直接给日期。
 * 未来时间（时钟回拨）按「刚刚」处理，不在界面上出现「-5 分钟前」。
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (!Number.isFinite(diff) || diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const days = Math.floor(diff / 86_400_000)
  if (days <= 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 取「自然日」的零点时间戳 —— 按本地时区切，不是按「距今 24 小时」切 */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 时间戳 → 日期分隔的文案（聊天气泡之间的「今天 / 昨天 / 8月3日」）。
 *
 * ⚠️ 必须按**自然日**比较，不能拿 `now - ts` 去除以 86400000：
 * 今天 00:10 和昨天 23:50 只差 20 分钟，但它们是两个不同的日子 ——
 * 用毫秒差算会把它归成同一天，分隔条就永远不出现。
 */
export function formatDayLabel(ts: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  const date = new Date(ts)
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * 两个时间戳是否属于同一个自然日。用于判断「要不要在两段之间插日期分隔」。
 * 放在这里而不是组件内：同一套日历口径只能有一份实现。
 */
export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

/**
 * Eventide / 上游自定 JSON 的状态值格式化（Phase 7A）。
 *
 * payload 值可能是任意类型 —— 直接 `String(value)` 会把嵌套对象渲染成 `[object Object]`。
 * 约定：对象与数组用 JSON 展开（诚实呈现结构），其它类型走 String；空值给「—」。
 */
export function stateValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
