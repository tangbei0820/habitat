import type { FastifyInstance } from 'fastify'
import type { StudyCardDraft } from '@shared/types'
import { ErrorCodes } from '@shared/errors.js'
import type { LlmChatMessage } from '@shared/providers.js'
import { runBackgroundLlm, parseJsonText } from '../lib/llm-call.js'
import { ProviderError } from '../providers/errors.js'
import type { LlmRegistry } from '../providers/registry.js'

const SUBJECT_MAX = 80
const GOAL_MAX = 240
const LEVEL_MAX = 40
const MAX_CARDS = 8

function text(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string') throw new ProviderError(ErrorCodes.BadRequest, `${field} 必须是字符串`)
  const value = raw.trim()
  if (value === '') throw new ProviderError(ErrorCodes.BadRequest, `${field} 不能为空`)
  if (value.length > max) throw new ProviderError(ErrorCodes.BadRequest, `${field} 最长 ${max} 字`)
  return value
}

function count(raw: unknown): number {
  if (raw === undefined) return 3
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_CARDS) {
    throw new ProviderError(ErrorCodes.BadRequest, `count 必须是 1–${MAX_CARDS} 的整数`)
  }
  return raw
}

function bodyOf(raw: unknown): { subject: string; goal: string; level: string; count: number } {
  const body = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return {
    subject: text(body.subject, 'subject', SUBJECT_MAX),
    goal: text(body.goal ?? '建立今天可以记住的基础词汇与表达', 'goal', GOAL_MAX),
    level: text(body.level ?? '初学者', 'level', LEVEL_MAX),
    count: count(body.count),
  }
}

function parseCards(value: unknown, expected: number): StudyCardDraft[] {
  const rawCards: unknown[] | null = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).cards)
      ? (value as Record<string, unknown>).cards as unknown[]
      : null
  if (rawCards === null) throw new ProviderError(ErrorCodes.ProviderUpstreamError, '模型没有返回可用的学习卡片')
  const cards: StudyCardDraft[] = []
  const seen = new Set<string>()
  for (const raw of rawCards) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const front = typeof item.front === 'string' ? item.front.trim() : ''
    const back = typeof item.back === 'string' ? item.back.trim() : ''
    if (front === '' || back === '' || seen.has(front)) continue
    const example = typeof item.example === 'string' && item.example.trim() !== '' ? item.example.trim() : null
    const hint = typeof item.hint === 'string' && item.hint.trim() !== '' ? item.hint.trim() : null
    cards.push({ front, back, example, hint })
    seen.add(front)
    if (cards.length >= expected) break
  }
  if (cards.length === 0) throw new ProviderError(ErrorCodes.ProviderUpstreamError, '模型返回的学习卡片格式不完整')
  return cards
}

export function registerStudyRoutes(app: FastifyInstance, registry: LlmRegistry): void {
  app.post('/api/study/cards/generate', async (request) => {
    const input = bodyOf(request.body)
    const resolved = registry.capabilityProvider('chat')
    if (resolved === null) {
      throw new ProviderError(ErrorCodes.ProviderNotConfigured, '没有可用的主聊天 API：请先在 Provider Center 配置')
    }
    const messages: LlmChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是栖息地里的温和 AI 伴学者。',
          '请只返回 JSON，不要 Markdown 代码围栏，不要解释 JSON 之外的内容。',
          'JSON 形状必须是 {"cards":[{"front":"...","back":"...","example":"...","hint":"..."}]}。',
          'front 是需要记忆的英语单词或短语，back 是简明中文含义与用法，example 是自然的英文例句，hint 是一个帮助记忆的联想提示。',
          '卡片之间不要重复；内容要适合用户当前水平；不要捏造用户没有提供的个人资料。',
        ].join(' '),
      },
      {
        role: 'user',
        content: `学习主题：${input.subject}\n学习目标：${input.goal}\n当前水平：${input.level}\n请生成 ${String(input.count)} 张今天适合复习的卡片。`,
      },
    ]
    const result = await runBackgroundLlm(resolved.provider, messages, 'study', {
      model: resolved.binding?.model ?? resolved.provider.defaultModel,
      temperature: 0.8,
      maxTokens: 1_800,
    })
    let parsed: unknown
    try {
      parsed = parseJsonText(result.text)
    } catch {
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, '模型返回的学习卡片不是有效 JSON')
    }
    return { cards: parseCards(parsed, input.count), model: resolved.binding?.model ?? resolved.provider.defaultModel }
  })
}
