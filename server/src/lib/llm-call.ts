/** 把现有流式 LLMProvider 收成一次后台文本调用，并统一落 UsageRecord。 */
import type { LLMProvider, LlmChatMessage, LlmUsage } from '@shared/providers.js'
import type { UsageService } from '../db/usage.js'
import { recordUsage } from '../db/usage.js'

export interface BackgroundLlmResult {
  text: string
  usage: LlmUsage
  usageRecordId: number
}

export async function runBackgroundLlm(
  provider: LLMProvider,
  messages: LlmChatMessage[],
  service: UsageService,
  options: { model?: string; temperature?: number; maxTokens?: number; timeZone?: string } = {},
): Promise<BackgroundLlmResult> {
  const model = options.model ?? provider.defaultModel
  let text = ''
  let usage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  for await (const chunk of provider.streamChat(messages, {
    model,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  })) {
    if (chunk.type === 'delta' && chunk.delta.content !== undefined) text += chunk.delta.content
    if (chunk.type === 'usage') usage = chunk.usage
  }
  const usageRecordId = recordUsage({
    profileId: provider.profileId,
    service,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  })
  return { text: text.trim(), usage, usageRecordId }
}

export function parseJsonText(text: string): unknown {
  const trimmed = text.trim()
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed
  return JSON.parse(unfenced)
}
