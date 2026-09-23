/**
 * 聊天流路由（技术方案 §7.2①）
 *
 * Phase 3B 起：**校验 → 组装上下文（Eventide）→ 转发 LLM 流 → 记账**。
 *
 * 完整的上下文组装是 [世界书(恒定) + Eventide 状态卡 + Nocturne 召回 + 历史窗口]，
 * 其中历史窗口由前端随请求送来（§6.2：ChatMessage 归属本地，服务端不落聊天记录），
 * Eventide 已接入；世界书与 Nocturne 仍待后续从 `context/chat-context.ts` 同一入口加入，接口形态不变。
 *
 * ⚠️ 为什么用 `reply.hijack()`：Fastify 要等 handler 返回才发响应头，
 * 而流式必须**立刻**把头刷出去，否则前端要空等整段生成完。
 */
import type { ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type {
  ChatDeltaPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatStreamRequest,
  ChatUsagePayload,
} from '@shared/events'
import type { LlmChatMessage, LlmRole, LlmStreamChunk, LlmUsage, StateProvider } from '@shared/providers'
import { assembleChatContext } from '../context/chat-context.js'
import { finishAutomationRun, getAutomationPolicy, noteCounterpartActivity } from '../db/automation.js'
import { recordUsage } from '../db/usage.js'
import { BudgetGuard } from '../lib/budget-guard.js'
import { ProviderError } from '../providers/errors.js'
import type { LlmRegistry } from '../providers/registry.js'
import { settleChatInteraction } from '../services/settlement.js'

const ROLES: readonly LlmRole[] = ['system', 'user', 'assistant', 'tool']

/** 前端每轮都会把历史整段送来，故要有上限兜底（超了必然是调用方出了错） */
const MAX_MESSAGES = 200

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function parseMessages(raw: unknown): LlmChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProviderError(ErrorCodes.BadRequest, 'messages 必须是非空数组')
  }
  if (raw.length > MAX_MESSAGES) {
    throw new ProviderError(
      ErrorCodes.BadRequest,
      `messages 最多 ${MAX_MESSAGES} 条（收到 ${raw.length} 条）`,
    )
  }
  return raw.map((item, index) => {
    const record = asRecord(item)
    if (record === null) {
      throw new ProviderError(ErrorCodes.BadRequest, `messages[${index}] 不是对象`)
    }
    const role = record.role
    if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
      throw new ProviderError(ErrorCodes.BadRequest, `messages[${index}].role 非法：${String(role)}`)
    }
    const content = record.content
    if (typeof content !== 'string') {
      throw new ProviderError(ErrorCodes.BadRequest, `messages[${index}].content 必须是字符串`)
    }
    return {
      role: role as LlmRole,
      content,
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.toolCallId === 'string' ? { toolCallId: record.toolCallId } : {}),
    }
  })
}

function parseNumber(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ProviderError(ErrorCodes.BadRequest, `${field} 必须是数字`)
  }
  return raw
}

function parseBody(raw: unknown): ChatStreamRequest {
  const record = asRecord(raw)
  if (record === null) throw new ProviderError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')

  const profileId = typeof record.profileId === 'string' && record.profileId !== '' ? record.profileId : undefined
  const model = typeof record.model === 'string' && record.model !== '' ? record.model : undefined
  const temperature = parseNumber(record.temperature, 'temperature')
  const maxTokens = parseNumber(record.maxTokens, 'maxTokens')

  return {
    ...(profileId === undefined ? {} : { profileId }),
    ...(model === undefined ? {} : { model }),
    messages: parseMessages(record.messages),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
}

/** 一帧一次 write，不要攒着 —— 攒了就由内核决定何时刷出，流式变成整段吐 */
function writeFrame(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function registerChatRoutes(app: FastifyInstance, registry: LlmRegistry, state: StateProvider | null): void {
  app.post('/api/chat', async (request, reply): Promise<void> => {
    // —— 写响应头之前的失败都还能返回结构化 JSON（走统一错误处理器）——
    const body = parseBody(request.body)
    const profile =
      body.profileId === undefined
        ? registry.active()
        : registry.toPublic(registry.require(body.profileId))
    if (profile === null) {
      throw new ProviderError(
        ErrorCodes.ProviderNotConfigured,
        '没有可用的 LLM 方案：请到「设置 → API 方案」添加（或在 server/.env 里配置 HABITAT_LLM_PROFILES）',
      )
    }
    const provider = registry.provider(profile.id)
    const model = body.model ?? provider.defaultModel

    const counterpartAt = new Date()
    noteCounterpartActivity(counterpartAt.getTime())
    const latestUserText = [...body.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    const policy = getAutomationPolicy()
    const context = await assembleChatContext(body.messages, state, counterpartAt, {
      lastCounterpartMessageAt: counterpartAt,
      counterpartText: latestUserText,
      triggerWords: policy.triggerWords,
      timeZone: policy.timeZone,
    })
    if (context.eventide === 'unavailable') {
      request.log.warn({ error: context.error }, 'Eventide 状态卡不可用，本轮按原始聊天上下文降级')
    }
    const budget = new BudgetGuard().reserve('chat', body.maxTokens ?? 4_096, counterpartAt)
    if (!budget.allowed || budget.reservationId === null) {
      throw new ProviderError(ErrorCodes.BudgetExceeded, budget.reason ?? '本轮聊天超出预算')
    }
    const chatRunId = budget.reservationId

    // —— 关键一步：**先取第一个 chunk 再写响应头** ——
    // streamChat 是 async generator，函数体要到第一次 next 才执行；
    // 密钥没配、上游不可达、鉴权被拒这类错误都在这一步暴露。
    // 好处：它们能在写响应头之前抛出 → 走统一错误处理器，返回结构化 4xx/5xx；
    // 否则前端就得多一条「HTTP 200 但流里带错误事件」的分支。
    const controller = new AbortController()
    const iterator = provider.streamChat(context.messages, {
      model,
      ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
      ...(body.maxTokens === undefined ? {} : { maxTokens: body.maxTokens }),
      signal: controller.signal,
    })[Symbol.asyncIterator]()

    let step: IteratorResult<LlmStreamChunk>
    try {
      step = await iterator.next()
    } catch (err) {
      finishAutomationRun(chatRunId, 'failed', err instanceof Error ? err.message : String(err), null)
      if (err instanceof ProviderError) throw err
      throw new ProviderError(ErrorCodes.Internal, err instanceof Error ? err.message : String(err))
    }

    // —— 上游已确认开工，从这里开始自己写响应 ——
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform：禁止中间层压缩。压缩会攒够一块才吐，流式就废了
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx 反代默认缓冲上游响应（§9 风险2），这行是给它看的
      'x-accel-buffering': 'no',
    })

    let clientGone = false
    res.on('close', () => {
      // 正常收尾时 writableEnded 已置位；只有提前断开才算「客户端走了」
      if (!res.writableEnded) {
        clientGone = true
        controller.abort()
      }
    })

    let usage: LlmUsage | null = null
    let finishReason: string | null = null
    let assistantText = ''

    try {
      while (step.done !== true) {
        const chunk = step.value
        if (chunk.type === 'delta') {
          // toolCall 增量 Phase 3 才用；本层不转发，免得前端拿到半截参数
          const payload: ChatDeltaPayload = {
            ...(chunk.delta.content === undefined ? {} : { content: chunk.delta.content }),
            ...(chunk.delta.reasoning === undefined ? {} : { reasoning: chunk.delta.reasoning }),
          }
          if (payload.content !== undefined || payload.reasoning !== undefined) {
            writeFrame(res, 'chat-delta', payload)
          }
          if (chunk.delta.content !== undefined) assistantText += chunk.delta.content
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else {
          finishReason = chunk.finishReason
        }
        if (clientGone) break
        step = await iterator.next()
      }
    } catch (err) {
      const payload: ChatErrorPayload =
        err instanceof ProviderError
          ? { code: err.code, message: err.message }
          : { code: ErrorCodes.Internal, message: err instanceof Error ? err.message : String(err) }
      request.log.error({ err, profileId: profile.id, model }, '聊天流中断')
      finishAutomationRun(chatRunId, 'failed', payload.message, null)
      // 这一轮没跑成，**不记用量**：UsageRecord 记的是消耗，不是尝试
      if (!clientGone) {
        writeFrame(res, 'chat-error', payload)
        if (!res.writableEnded) res.end()
      }
      await iterator.return?.(undefined)
      return
    }

    // 记账（§6.2 强制落一条）。上游没回 usage 时按 0 落，保证「这轮发生过」有据可查
    const usagePayload: ChatUsagePayload = {
      profileId: profile.id,
      model,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    }
    let usageRecordId: number | null = null
    try {
      usageRecordId = recordUsage({
        profileId: profile.id,
        service: 'chat',
        model,
        promptTokens: usagePayload.promptTokens,
        completionTokens: usagePayload.completionTokens,
        totalTokens: usagePayload.totalTokens,
        timeZone: policy.timeZone,
      })
    } catch (err) {
      // 账没记上不该把这一轮回复作废，但必须留痕（错误不静默）
      request.log.error({ err, profileId: profile.id }, 'UsageRecord 写入失败')
    }
    finishAutomationRun(chatRunId, 'completed', null, usageRecordId)

    // 上游已完整结束就结算本轮；即使客户端中途断开，也不能丢掉已经发生的互动后效。
    // 任何失败只写日志，不能把成功聊天改判成失败。
    if (state !== null) {
      void settleChatInteraction({
        state,
        provider,
        model,
        messages: body.messages,
        assistantText,
        logger: request.log,
      })
    }

    // 客户端已断开：事件没人收，但 token 是真花了，账照记
    if (clientGone) return

    writeFrame(res, 'chat-usage', usagePayload)
    const donePayload: ChatDonePayload = { finishReason, usage: usagePayload, usageRecordId }
    writeFrame(res, 'chat-done', donePayload)
    res.end()
  })
}
