/** 成功聊天后的 Eventide 互动结算；失败只留痕，绝不回滚已送达回复。 */
import type { FastifyBaseLogger } from 'fastify'
import type { LLMProvider, LlmChatMessage, StateProvider } from '@shared/providers.js'
import { appendEventLog } from '../db/activity.js'
import { finishAutomationRun, getAutomationPolicy } from '../db/automation.js'
import { BudgetGuard } from '../lib/budget-guard.js'
import { parseJsonText, runBackgroundLlm } from '../lib/llm-call.js'

const MAX_WINDOW_MESSAGES = 12
const MAX_WINDOW_CHARS = 8_000

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
}): Promise<void> {
  if (input.assistantText.trim() === '') return
  let reservationId: string | null = null
  try {
    const prompt = await input.state.settlementPrompt(settlementWindow(input.messages, input.assistantText))
    const decision = new BudgetGuard().reserve('settlement', 2_048)
    if (!decision.allowed || decision.reservationId === null) {
      appendEventLog('eventide.settlement.skipped', { reason: decision.reason })
      return
    }
    reservationId = decision.reservationId
    const result = await runBackgroundLlm(
      input.provider,
      [{ role: 'system', name: 'eventide_settlement', content: prompt }],
      'state-settlement',
      { model: input.model, temperature: 0, maxTokens: 700, timeZone: getAutomationPolicy().timeZone },
    )
    await input.state.settle(parseJsonText(result.text))
    finishAutomationRun(reservationId, 'completed', null, result.usageRecordId)
    appendEventLog('eventide.settlement.completed', { usageRecordId: result.usageRecordId }, reservationId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (reservationId !== null) finishAutomationRun(reservationId, 'failed', message, null)
    appendEventLog('eventide.settlement.failed', { error: message }, reservationId)
    input.logger.warn({ err: error }, 'Eventide 互动结算失败；聊天回复已正常完成')
  }
}
