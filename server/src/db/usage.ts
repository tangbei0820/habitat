/**
 * UsageRecord 写入（§6.2 / §7.2①）
 *
 * 「每次 LLM / TTS 调用强制落一条」是账本与统计的地基（§10.2），
 * 所以这里的原则是：**宁可记 0，不能不记**。
 */
import { db } from './index.js'
import { usageRecord } from './schema.js'

export type UsageService = 'chat' | 'tts' | 'vision' | 'embedding'

export interface UsageInput {
  profileId: string
  service: UsageService
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  at?: number
}

/** 本地时区的 YYYY-MM-DD（不能用 ISO 的 UTC 日期，否则跨零点会串天） */
export function dayKeyOf(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 落一条用量记录，返回主键。写库失败由调用方决定如何处置（本轮真跑了，不该因此让流失败） */
export function recordUsage(input: UsageInput): number {
  const at = input.at ?? Date.now()
  const result = db
    .insert(usageRecord)
    .values({
      profileId: input.profileId,
      service: input.service,
      model: input.model,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      dayKey: dayKeyOf(at),
      at,
    })
    .run()
  return Number(result.lastInsertRowid)
}
