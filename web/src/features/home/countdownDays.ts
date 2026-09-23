/**
 * 倒数日的日期换算（模块页与主屏 Widget 共用一份 —— 同一个日子在两个地方
 * 算出不同的天数，是用户一定会发现、而且一定会先怀疑「哪个才是对的」的那种问题）。
 */

/**
 * 距离目标日还有多少天：正数=未来，0=今天，负数=已过去。
 *
 * ⚠️ 逐段拆开构造本地日期，**不要**写 `new Date('2026-09-23')` ——
 * 那会把纯日期解析成 UTC 零点，在东八区就凭空少算一天（差 8 小时，换算成天数是 0.33，
 * 四舍五入后有时对有时错，是最难查的那类偏差）。
 */
export function dayDistance(targetDate: string): number {
  const [year, month, day] = targetDate.split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function distanceLabel(days: number): string {
  if (days === 0) return '就是今天'
  if (days > 0) return `还有 ${String(days)} 天`
  return `已过 ${String(Math.abs(days))} 天`
}
