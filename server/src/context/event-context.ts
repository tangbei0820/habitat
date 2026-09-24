/**
 * Event Inbox 的上下文段（Phase 6.5 P1）。
 *
 * 这一段的职责只有一个：**把「等着 AI 处理的事」和「它上次请求的结果」告诉它**。
 *
 * 为什么必须有这一段 —— 确认卡是异步的，模型发起之后那一轮就结束了。
 * 如果此后没有任何渠道把结果带回来，模型会永远停在「我已经提请确认了」这个状态，
 * 下一轮就可能顺着往下编（「我写的日记你看到了吗」）。这不是模型撒谎，
 * 是它真的不知道；本 Phase 的整条主线就是「别让模型靠猜」。
 *
 * 两种段、两种送达策略（都很讲究，改之前先想清楚）：
 *
 *   · **待决的（pending）**：每轮都注入。它本来就是「还没做的事」，重复提醒是应该的 ——
 *     AI 可能上一轮没顾上处理。数量天然很少（一次对话不会有几十条待决请求）。
 *   · **已决的（decided）**：**只注入一次**。重复说「北北已经允许你写日记了」既费 token，
 *     又会让它以为要再写一篇。所以注入后要标记 `resultDeliveredAt`。
 *
 * ⚠️ 标记动作**不在本文件里做**，而是返回 id 交给调用方在「流真的发出去之后」执行。
 * 在这个函数里标记会有一个坏后果：上游密钥没配 / 不可达时，本轮根本没发出去，
 * 但结果已经被标成「已告知」—— 模型永远失去这条信息。
 */
import type { RuntimeEvent } from '@shared/types'
import { listPendingForCompanion, listUndeliveredResults } from '../db/event.js'

export interface EventContextResult {
  /** 要注入的 system 段；无事可报时为 `null`（那一轮就少一段） */
  block: string | null
  /** 已随本轮注入、应当在流开始后标记为「已送达」的已决事件 id */
  deliveredIds: string[]
}

/** 每次注入的条数上限 —— 待办列表不该把上下文吃光 */
const MAX_PENDING = 10
const MAX_RESULTS = 10

function renderPending(events: readonly RuntimeEvent[]): string[] {
  if (events.length === 0) return []
  const lines = events.map((event) => `- ${event.title}\n  事件 id：${event.id}\n  ${event.detail.replace(/\n/g, '\n  ')}`)
  return [
    '# 等待你决定的事',
    '',
    '下面这些事**需要你自己拿主意**（北北无法替你做决定）。决定了就调用对应工具，用工具里的 `eventId` 指定是哪一条：',
    '',
    ...lines,
    '',
    '想让北北看就调用「允许查看」，不想就调用「拒绝查看」。拒绝不需要理由，你也可以在回复里说明你的想法。',
  ]
}

function renderResults(events: readonly RuntimeEvent[]): string[] {
  if (events.length === 0) return []
  const lines = events.map((event) => `- ${event.title} —— ${event.result ?? '（无结果说明）'}`)
  return [
    '# 你之前那些请求的结果',
    '',
    '下面这些是你**之前发起、已经由北北处理完**的事。这是既成事实，直接在当前对话里自然地体现即可：',
    '',
    ...lines,
  ]
}

/**
 * 生成事件段。**同步**（纯 SQLite 读），所以调用方不必为它加 await 分支。
 */
export function buildEventContext(): EventContextResult {
  const pending = listPendingForCompanion(MAX_PENDING)
  const results = listUndeliveredResults(MAX_RESULTS)

  const sections = [...renderPending(pending), ...(pending.length > 0 && results.length > 0 ? [''] : []), ...renderResults(results)]
  if (sections.length === 0) return { block: null, deliveredIds: [] }

  return { block: sections.join('\n'), deliveredIds: results.map((event) => event.id) }
}
