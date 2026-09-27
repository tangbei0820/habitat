/**
 * UsageRecord 写入（§6.2 / §7.2①）
 *
 * 「每次 LLM / TTS 调用强制落一条」是账本与统计的地基（§10.2），
 * 所以这里的原则是：**宁可记 0，不能不记**。
 */
import { db } from './index.js'
import { and, desc, eq, lte } from 'drizzle-orm'
import { apiProfile, priceSnapshot, usageRecord } from './schema.js'

export type UsageService =
  | 'chat'
  | 'tts'
  | 'transcription'
  | 'vision'
  | 'image'
  | 'embedding'
  | 'state-settlement'
  | 'proactive-wake'
  | 'solitude'
  | 'dream'
  | 'study'

export interface UsageInput {
  profileId: string
  service: UsageService
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  at?: number
  timeZone?: string
}

/** 用户时区的 YYYY-MM-DD（不能依赖服务器进程自己的时区）。 */
export function dayKeyOf(at: number, timeZone = process.env.HABITAT_TIME_ZONE ?? 'Asia/Shanghai'): string {
  const parts = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at)).map((part) => [part.type, part.value]))
  return `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}-${parts.get('day') ?? '01'}`
}

/** 落一条用量记录，返回主键。写库失败由调用方决定如何处置（本轮真跑了，不该因此让流失败） */
export function recordUsage(input: UsageInput): number {
  const at = input.at ?? Date.now()
  const promptTokens = input.promptTokens ?? 0
  const completionTokens = input.completionTokens ?? 0
  const profile = db.select({ provider: apiProfile.provider }).from(apiProfile).where(eq(apiProfile.id, input.profileId)).get()
  const snapshot = profile === undefined ? undefined : db.select().from(priceSnapshot).where(and(
    eq(priceSnapshot.provider, profile.provider),
    eq(priceSnapshot.model, input.model),
    lte(priceSnapshot.validFrom, at),
  )).orderBy(desc(priceSnapshot.validFrom), desc(priceSnapshot.createdAt)).limit(1).get()
  const cost = snapshot === undefined ? null : Math.ceil((
    promptTokens * snapshot.promptCentsPerMillion
    + completionTokens * snapshot.completionCentsPerMillion
  ) / 1_000_000)
  const result = db
    .insert(usageRecord)
    .values({
      profileId: input.profileId,
      service: input.service,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens: input.totalTokens ?? 0,
      cost,
      priceSnapshotId: snapshot?.id ?? null,
      dayKey: dayKeyOf(at, input.timeZone),
      at,
    })
    .run()
  return Number(result.lastInsertRowid)
}
