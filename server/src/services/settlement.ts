/** 成功聊天后的 Eventide 互动结算；失败只留痕，绝不回滚已送达回复。 */
import type { FastifyBaseLogger } from 'fastify'
import type { LLMProvider, LlmChatMessage, StateProvider } from '@shared/providers.js'
import { appendEventLog } from '../db/activity.js'
import {
  enqueueCoreSettlement,
  getCoreSettlement,
  listPendingCoreSettlements,
  markCoreSettlementApplied,
  markCoreSettlementAttempt,
} from '../db/core-settlement.js'
import { finishAutomationRun, getAutomationPolicy } from '../db/automation.js'
import { BudgetGuard } from '../lib/budget-guard.js'
import { parseJsonText, runBackgroundLlm } from '../lib/llm-call.js'
import { DesireEngine } from './desire.js'

const MAX_WINDOW_MESSAGES = 12
const MAX_WINDOW_CHARS = 8_000

function recordResult(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Eventide 结算结果必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

function settlementWindow(messages: LlmChatMessage[], assistantText: string): string {
  const conversational = messages.filter((message) => message.role === 'user' || message.role === 'assistant')
  const lines = [...conversational.slice(-MAX_WINDOW_MESSAGES), { role: 'assistant' as const, content: assistantText }]
    .map((message) => `${message.role === 'user' ? '对方' : '你'}：${message.content}`)
  const text = lines.join('\n')
  return text.length <= MAX_WINDOW_CHARS ? text : text.slice(-MAX_WINDOW_CHARS)
}

export async function settleChatInteraction(input: {
  state: StateProvider
  provider: LLMProvider
  model: string
  messages: LlmChatMessage[]
  assistantText: string
  logger: FastifyBaseLogger
  interactionId?: string
  desire?: DesireEngine
}): Promise<void> {
  if (input.assistantText.trim() === '') return
  let reservationId: string | null = null
  let usageRecordId: number | null = null
  try {
    let result: Record<string, unknown>
    const existing = input.interactionId === undefined ? null : getCoreSettlement(input.interactionId)
    if (existing?.status === 'applied') {
      appendEventLog('core.settlement.duplicate', { interactionId: input.interactionId, status: 'applied' }, input.interactionId)
      return
    }
    if (existing !== null) {
      // 上次已经付出模型成本并得到结构化结果，只重试 Eventide 应用，不重复调用模型。
      result = existing.result
    } else {
      const prompt = await input.state.settlementPrompt(settlementWindow(input.messages, input.assistantText))
      const decision = new BudgetGuard().reserve('settlement', 2_048)
      if (!decision.allowed || decision.reservationId === null) {
        appendEventLog('eventide.settlement.skipped', { reason: decision.reason, interactionId: input.interactionId ?? null })
        return
      }
      reservationId = decision.reservationId
      const generated = await runBackgroundLlm(
        input.provider,
        [{ role: 'system', name: 'eventide_settlement', content: prompt }],
        'state-settlement',
        { model: input.model, temperature: 0, maxTokens: 700, timeZone: getAutomationPolicy().timeZone },
      )
      usageRecordId = generated.usageRecordId
      result = recordResult(parseJsonText(generated.text))
      if (input.interactionId !== undefined) {
        const queued = enqueueCoreSettlement(input.interactionId, result)
        if (queued.status === 'applied') {
          finishAutomationRun(reservationId, 'completed', null, usageRecordId)
          return
        }
      }
    }
    const snapshot = await input.state.settle(result)
    const applied = input.interactionId === undefined
      ? true
      : markCoreSettlementApplied(input.interactionId)
    if (!applied) {
      appendEventLog('core.settlement.duplicate', { interactionId: input.interactionId, status: 'applied' }, input.interactionId)
      if (reservationId !== null) finishAutomationRun(reservationId, 'completed', null, usageRecordId)
      return
    }
    if (reservationId !== null) finishAutomationRun(reservationId, 'completed', null, usageRecordId)
    try {
      input.desire?.observe({ source: 'eventide', signal: 'eventide.settlement', statePayload: snapshot.payload, refId: input.interactionId ?? null })
    } catch (error) {
      input.logger.warn({ err: error, interactionId: input.interactionId }, 'Desire 结算观察失败；Eventide 已成功落库')
    }
    appendEventLog('core.settlement.completed', { interactionId: input.interactionId ?? null }, input.interactionId ?? reservationId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (input.interactionId !== undefined && getCoreSettlement(input.interactionId)?.status === 'pending') {
      markCoreSettlementAttempt(input.interactionId, message)
      appendEventLog('core.settlement.retry_pending', { interactionId: input.interactionId, error: message }, input.interactionId)
    } else {
      appendEventLog('eventide.settlement.failed', { error: message, interactionId: input.interactionId ?? null }, reservationId)
    }
    if (reservationId !== null) finishAutomationRun(reservationId, 'failed', message, null)
    input.logger.warn({ err: error }, 'Eventide 互动结算失败；聊天回复已正常完成')
  }
}

/**
 * 服务重启 / sidecar 短暂断网后的恢复路径。
 * outbox 里只有结构化结算结果，因此恢复不会重新读取或持久化聊天正文，也不会再次消耗 LLM 额度。
 */
export async function retryPendingCoreSettlements(
  state: StateProvider | null,
  desire: DesireEngine,
  logger: FastifyBaseLogger,
  now = Date.now(),
): Promise<number> {
  if (state === null) return 0
  let applied = 0
  for (const item of listPendingCoreSettlements(20, now)) {
    try {
      const snapshot = await state.settle(item.result, new Date(now))
      if (markCoreSettlementApplied(item.interactionId, now)) {
        try {
          desire.observe({ source: 'eventide', signal: 'eventide.settlement.retry', statePayload: snapshot.payload, refId: item.interactionId, at: now })
        } catch (error) {
          logger.warn({ err: error, interactionId: item.interactionId }, 'Desire 恢复观察失败；Eventide 已成功落库')
        }
        appendEventLog('core.settlement.recovered', { interactionId: item.interactionId, attempts: item.attemptCount + 1 }, item.interactionId, now)
        applied += 1
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markCoreSettlementAttempt(item.interactionId, message, now)
      logger.warn({ err: error, interactionId: item.interactionId }, 'Core-5 结算 outbox 重试失败')
    }
  }
  return applied
}
