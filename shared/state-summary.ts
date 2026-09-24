/**
 * 状态可读化（raw state → normalized state → human-readable summary）
 *
 * 为什么需要这一层：Eventide 下发的是**任意结构的 JSON**（`BodyStateSnapshot.state` 是
 * `Record<string, unknown>`），只有 `stateCard` 是字符串、而且可能为 null。
 * 谁直接渲染 `state`，谁就会得到 `[object Object]` —— 这正是本轮要修的现象之一。
 *
 * 两类消费方都要它，所以放 `shared/`：
 *   · 服务端 —— `state_read` 工具的返回值（给模型看，必须是文本而非对象）
 *   · 前端 —— 状态卡 / 详情页（给人看，普通页面不许出现 raw JSON）
 * 放在一起是为了**保证两边口径一致**：AI 读到的和自己看到的必须是同一份事实。
 *
 * 三条纪律：
 * 1. **绝不产出 `[object Object]`** —— 所有值在这里就转成显示字符串，边界外不再有对象。
 * 2. **不编造语义**：`FIELD_LABELS` 只是显示用的翻译，键名对不上就自动退回原键名；
 *    数值的单位、量纲一律不猜（宁可朴素，不可误导）。
 * 3. **`stateCard` 优先** —— 它是 sidecar 已渲染好的自然语言，结构化字段只做补充。
 */
import type { BodyStateSnapshot } from './types'

/**
 * 已知字段 → 中文名（**显示用翻译，不是语义定义**）。
 *
 * ⚠️ 这份词典**未与真实 Eventide sidecar 的键集核对过** —— 是按键名惯例先写的。
 * 键名不符时自动退回原键名显示，所以最坏情况只是「没翻译」，不会显示错的值。
 * 拿到真实键集后应订正本表（`docs/AI_RUNTIME.md` 已记为待办）。
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  energy: '精力',
  fatigue: '疲劳',
  mood: '情绪',
  valence: '情绪倾向',
  arousal: '唤醒度',
  stress: '压力',
  tension: '紧绷',
  warmth: '亲近感',
  loneliness: '孤独感',
  sleepiness: '困倦',
  focus: '专注',
  health: '健康',
  intimacy: '亲密度',
  trust: '信任',
  revision: '修订号',
  fatigue_delta: '疲劳增量',
}

/** 单值 / 整段摘要的显示上限 —— 超了截断并明确标注，不让它悄悄吃满上下文与屏幕。 */
const VALUE_LIMIT = 200
const TEXT_LIMIT = 1_200
/** 字段过多时截取前 N 个（保住「有边界」这件事，不静默丢） */
const FIELD_LIMIT = 24

/**
 * 任意值 → 一行人类可读字符串。
 *
 * 这是整套里**唯一**允许接触「值可能是对象」的地方 —— 出了这个函数就只有字符串了。
 * 递归时有深度上限：Eventide 的状态若嵌套很深，不能让渲染层跟着递归。
 */
export function describeValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? '—' : clip(text, VALUE_LIMIT)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
  }
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) {
    if (value.length === 0) return '(空)'
    const parts = value.slice(0, 8).map((item) => describeValue(item, depth + 1))
    const more = value.length > 8 ? ` 等 ${value.length} 项` : ''
    return clip(parts.join('、') + more, VALUE_LIMIT)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    // 有些内部对象自带可读投影，优先用（典型：{ label: '有些疲倦', value: 62 }）
    for (const key of ['label', 'text', 'summary', 'name', 'title', 'description']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim() !== '') return clip(candidate.trim(), VALUE_LIMIT)
    }
    if (depth >= 2) return '(结构略)'
    const pairs = Object.keys(record)
      .slice(0, 8)
      .map((key) => `${key}=${describeValue(record[key], depth + 1)}`)
    return clip(pairs.join(' '), VALUE_LIMIT)
  }
  return String(value)
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** 归一化后的一个字段：值已是**字符串**，前端直接渲染不会出现 `[object Object]`。 */
export interface StateFieldView {
  /** 原始键名（保留，便于对照 sidecar） */
  key: string
  /** 显示名（词典命中时是中文，否则等于 `key`） */
  label: string
  /** 已转成字符串的显示值 */
  value: string
}

export interface StateSummary {
  /** 是否真的拿到了状态（未配置 / 还没有快照时为 false） */
  available: boolean
  /** 一行主摘要（卡片标题用） */
  headline: string
  /** 多行完整摘要（进 prompt / 卡片正文） */
  text: string
  /** 归一化字段表 */
  fields: StateFieldView[]
  /** 快照时间（毫秒）；没有快照时为 null */
  settledAt: number | null
}

/** 没状态时的统一答复 —— 与 `available: false` 配套，避免各调用点各写一份文案。 */
function emptySummary(headline: string): StateSummary {
  return { available: false, headline, text: headline, fields: [], settledAt: null }
}

/**
 * 快照 → 人类可读摘要。
 *
 * @param snapshot `StateProvider.current()` 的返回；没有状态时传 null。
 */
export function describeState(snapshot: BodyStateSnapshot | null): StateSummary {
  if (snapshot === null) return emptySummary('当前没有可用状态（Eventide 未配置或尚未建立状态）')

  const fields: StateFieldView[] = Object.keys(snapshot.state ?? {})
    .slice(0, FIELD_LIMIT)
    .map((key) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      value: describeValue((snapshot.state as Record<string, unknown>)[key]),
    }))

  const card = snapshot.stateCard?.trim() ?? ''
  const cardFirstLine = card.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? ''

  // headline 三级回退：状态卡首行 → 前两个字段 → 只有一句话
  const fromFields = fields.slice(0, 2).map((field) => `${field.label} ${field.value}`).join('，')
  const headline = clip(cardFirstLine || fromFields || '状态已更新', VALUE_LIMIT)

  const sections: string[] = []
  if (card !== '') sections.push(clip(card, TEXT_LIMIT))
  if (fields.length > 0) {
    sections.push(fields.map((field) => `${field.label}：${field.value}`).join('\n'))
  }

  return {
    available: true,
    headline,
    text: sections.join('\n\n'),
    fields,
    settledAt: snapshot.settledAt,
  }
}
