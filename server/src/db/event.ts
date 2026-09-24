/**
 * Event Inbox 数据访问（Phase 6.5 P1）。服务端权威源。
 *
 * 本文件只管**存取**，「决策之后到底执行什么」在 `services/event-inbox.ts`。
 * 分开是因为两者变更频率不同：仓储跟着表结构走，执行逻辑跟着能力面走。
 *
 * ⚠️ 两个刻意的设计，改之前先读：
 *
 * 1. **`payload` 不进 `RuntimeEvent`**（对外形状）。它可能含不该露出的字段，
 *    而对外形状会被直接序列化下发前端。执行器单独用 `readEventPayload()` 取。
 *
 * 2. **决策只能做一次**。`settleEvent()` 带 `status='pending'` 条件更新，
 *    已经决过的事件返回 `null` 而不是覆盖 —— 否则确认卡点两下就写两篇日记。
 *    这不是「顺手加个校验」，它跟「拒绝不等于删掉」是同一类纪律。
 */
import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type {
  RuntimeEvent,
  RuntimeEventDecider,
  RuntimeEventKind,
  RuntimeEventStatus,
} from '@shared/types'
import { db } from './index.js'
import { runtimeEvent, type RuntimeEventRow } from './schema.js'

/** 已决的状态集合（`pending` 之外的都在这里） */
export type SettledStatus = Exclude<RuntimeEventStatus, 'pending'>

/** 收件箱一次最多返回多少条 —— 它是「待办」，不是历史归档，没有翻页的需求 */
export const EVENT_LIST_LIMIT = 100

/** 标题 / 详情上限。事件会进模型上下文，不设上限等于让人往里塞整篇日记 */
const TITLE_LIMIT = 120
const DETAIL_LIMIT = 600

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function toEvent(row: RuntimeEventRow): RuntimeEvent {
  return {
    id: row.id,
    kind: row.kind,
    decider: row.decider,
    status: row.status,
    title: row.title,
    detail: row.detail,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    result: row.result,
    // 仓储对外统一暴露布尔（存储层用时间戳，是为了保留「什么时候送达」这个事实）
    resultDelivered: row.resultDeliveredAt !== null,
    capabilityId: row.capabilityId,
    targetId: row.targetId,
  }
}

export interface CreateEventInput {
  kind: RuntimeEventKind
  /** 谁有权决定这一条 */
  decider: RuntimeEventDecider
  title: string
  detail?: string
  /** 执行器要用的数据。**不会**随 `RuntimeEvent` 下发 */
  payload: Record<string, unknown>
  /** 涉及的能力 id（如 `diary.create`），用于前端分组与图标 */
  capabilityId?: string
  /** 指向的业务对象（日记 id 等）。前端靠它做「这篇是否已请求过」的匹配 */
  targetId?: string
}

export function createEvent(input: CreateEventInput): RuntimeEvent {
  const row: RuntimeEventRow = {
    id: `evt-${randomUUID()}`,
    kind: input.kind,
    decider: input.decider,
    status: 'pending',
    title: clip(input.title, TITLE_LIMIT),
    detail: clip(input.detail ?? '', DETAIL_LIMIT),
    payloadJson: JSON.stringify(input.payload),
    result: null,
    resultDeliveredAt: null,
    capabilityId: input.capabilityId ?? null,
    targetId: input.targetId ?? null,
    createdAt: Date.now(),
    decidedAt: null,
  }
  db.insert(runtimeEvent).values(row).run()
  return toEvent(row)
}

export function getEvent(id: string): RuntimeEvent | null {
  const row = db.select().from(runtimeEvent).where(eq(runtimeEvent.id, id)).get()
  return row === undefined ? null : toEvent(row)
}

/** 取执行载荷。找不到 / JSON 坏了都返回 `null`（调用方按「无法执行」处理，不抛）。 */
export function readEventPayload(id: string): Record<string, unknown> | null {
  const row = db.select({ payloadJson: runtimeEvent.payloadJson }).from(runtimeEvent).where(eq(runtimeEvent.id, id)).get()
  if (row === undefined) return null
  try {
    const parsed: unknown = JSON.parse(row.payloadJson)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** 收件箱列表。`status` 省略 = 全部状态（含已决，前端要能看到「上次那件事的结果」）。 */
export function listEvents(filter: {
  decider?: RuntimeEventDecider
  status?: RuntimeEventStatus
  limit?: number
} = {}): RuntimeEvent[] {
  const conditions = []
  if (filter.decider !== undefined) conditions.push(eq(runtimeEvent.decider, filter.decider))
  if (filter.status !== undefined) conditions.push(eq(runtimeEvent.status, filter.status))
  const query = db.select().from(runtimeEvent)
  const scoped = conditions.length === 0 ? query : query.where(and(...conditions))
  return scoped
    .orderBy(desc(runtimeEvent.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? EVENT_LIST_LIMIT, 1), EVENT_LIST_LIMIT))
    .all()
    .map(toEvent)
}

/** 待 AI 决策的事件 —— 注入模型上下文用。按 `pending` 取，所以天然不会重复执行。 */
export function listPendingForCompanion(limit = 20): RuntimeEvent[] {
  return listEvents({ decider: 'companion', status: 'pending', limit })
}

/**
 * 在待决事件里找一条。
 *
 * 用途是**去重**：同一篇日记不该同时挂两条「请求查看」（用户连点两下、或换设备又点一次），
 * 那样 AI 会看到两条一样的请求，然后决策两次。
 *
 * 为什么要读 payload 才能匹配：`payload` 刻意不进对外形状（见文件头），
 * 所以这类「按业务键找」只能在这里做。待决事件本来就没几条，内存里筛完全够。
 */
export function findPendingEvent(
  kind: RuntimeEventKind,
  predicate: (payload: Record<string, unknown>, event: RuntimeEvent) => boolean,
): RuntimeEvent | null {
  const rows = db
    .select()
    .from(runtimeEvent)
    .where(and(eq(runtimeEvent.kind, kind), eq(runtimeEvent.status, 'pending')))
    .orderBy(desc(runtimeEvent.createdAt))
    .all()
  for (const row of rows) {
    const event = toEvent(row)
    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(row.payloadJson)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
      payload = parsed as Record<string, unknown>
    } catch {
      continue
    }
    if (predicate(payload, event)) return event
  }
  return null
}

/**
 * 已决策、但**结果还没告诉过模型**的事件。
 *
 * 为什么要「告诉一次就够」：确认卡点完之后，模型并不知道自己那次请求成没成。
 * 但每轮都重复「北北已经允许你写日记了」既费 token，又会让它以为要再写一篇。
 */
export function listUndeliveredResults(limit = 20): RuntimeEvent[] {
  return db
    .select()
    .from(runtimeEvent)
    .where(and(isNotNull(runtimeEvent.decidedAt), isNull(runtimeEvent.resultDeliveredAt)))
    .orderBy(desc(runtimeEvent.decidedAt))
    .limit(limit)
    .all()
    .map(toEvent)
}

export function markResultsDelivered(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  const at = Date.now()
  let updated = 0
  for (const id of ids) {
    updated += db
      .update(runtimeEvent)
      .set({ resultDeliveredAt: at })
      .where(and(eq(runtimeEvent.id, id), isNull(runtimeEvent.resultDeliveredAt)))
      .run().changes
  }
  return updated
}

/**
 * 落定一次决策。**只在 `pending` 时生效** —— 返回 `null` 表示这条已决过或不存在，
 * 调用方必须把它当成错误报给用户（而不是当成「执行了」）。
 */
export function settleEvent(id: string, status: SettledStatus, result: string): RuntimeEvent | null {
  const changed = db
    .update(runtimeEvent)
    .set({ status, result: clip(result, DETAIL_LIMIT), decidedAt: Date.now() })
    .where(and(eq(runtimeEvent.id, id), eq(runtimeEvent.status, 'pending')))
    .run().changes
  if (changed === 0) return null
  return getEvent(id)
}
