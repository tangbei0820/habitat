/**
 * Event Inbox 端点（Phase 6.5 P1）。
 *
 * 事件收件箱是**双向**的：有的等北北点确认（AI 想写日记 / 留言），
 * 有的等 AI 拿主意（北北想看某篇日记）。本文件只提供**用户侧**的读写：
 *
 *   · 列 / 看 —— 两边都能看（用户要知道 AI 在等什么，也要看到自己请求的结果）
 *   · 决策   —— **只有 `decider='user'` 的事件能在这里决**
 *
 * ⚠️ AI 侧的事件**刻意没有决策端点**。它只能由 AI 通过 `diary_allow_access` /
 * `diary_deny_access` 工具决定，而工具层硬编码了 `decider='companion'`。
 * 如果这里开一个「随便传 decider」的接口，用户就能替 AI 打开日记 ——
 * 那等于「私密」这个词不存在，整个权限模型也就白做了。
 *
 * ⚠️ 路径是 `/api/inbox` 而**不是** `/api/events` —— 后者已被 Eventide 的
 * 身体状态事件日志占用（`routes/automation.ts`）。两者语义完全不同：
 * 那张表是「发生过什么」的流水，这张是「等你决定什么」的待办。
 * 撞名不是笔误的后果，是「事件」这个词太泛；用「收件箱」才说清这边是什么。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { RuntimeEventDecider, RuntimeEventStatus } from '@shared/types'
import { getEvent, listEvents } from '../db/event.js'
import { RequestError } from '../lib/errors.js'
import { decideEvent } from '../services/event-inbox.js'

const STATUSES: readonly string[] = ['pending', 'approved', 'denied', 'failed']
const DECIDERS: readonly string[] = ['companion', 'user']

function enumOf<T extends string>(raw: unknown, allowed: readonly string[], field: string): T | undefined {
  if (raw === undefined || raw === '') return undefined
  if (typeof raw !== 'string' || !allowed.includes(raw)) {
    throw new RequestError(ErrorCodes.BadRequest, `${field} 只能是 ${allowed.join(' / ')}`)
  }
  return raw as T
}

export function registerInboxRoutes(app: FastifyInstance): void {
  /**
   * 收件箱列表。`decider` / `status` 都可省 —— 省略即「不筛这一维」。
   * 前端确认卡与 Life 页的事件 tab 共用这一个端点。
   */
  app.get('/api/inbox', async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>
    const decider = enumOf<RuntimeEventDecider>(query.decider, DECIDERS, 'decider')
    const status = enumOf<RuntimeEventStatus>(query.status, STATUSES, 'status')
    const rawLimit = query.limit
    const limit =
      typeof rawLimit === 'string' && rawLimit !== '' && Number.isFinite(Number(rawLimit))
        ? Number(rawLimit)
        : undefined
    return {
      events: listEvents({
        ...(decider === undefined ? {} : { decider }),
        ...(status === undefined ? {} : { status }),
        ...(limit === undefined ? {} : { limit }),
      }),
    }
  })

  app.get<{ Params: { id: string } }>('/api/inbox/:id', async (request) => {
    const event = getEvent(request.params.id)
    if (event === null) throw new RequestError(ErrorCodes.NotFound, '这条事件不存在')
    return event
  })

  /**
   * 北北对某条事件的决策（目前只有 `tool_confirm` 这一类会走到这里）。
   *
   * ⚠️ 决策**只能做一次**：`decideEvent` 带 `status='pending'` 条件更新，
   * 重复提交会返回 400 而不是把日记写第二遍。
   */
  app.post<{ Params: { id: string }; Body: unknown }>('/api/inbox/:id/decide', async (request) => {
    const body = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}
    const decision = body.decision
    if (decision !== 'approve' && decision !== 'deny') {
      throw new RequestError(ErrorCodes.BadRequest, 'decision 必须是 approve 或 deny')
    }
    const result = decideEvent(request.params.id, 'user', decision === 'approve')
    if (!result.ok) throw new RequestError(ErrorCodes.BadRequest, result.error)
    return { event: result.event }
  })
}
