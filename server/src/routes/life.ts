/** Phase 4 Life：月历、账本、价格、运行状态与 Web Push 配置。 */
import type { FastifyInstance } from 'fastify'
import { desc } from 'drizzle-orm'
import { ErrorCodes } from '@shared/errors.js'
import type { StateProvider } from '@shared/providers.js'
import type { LifeRuntimeView } from '@shared/types.js'
import { db } from '../db/index.js'
import { getAutomationPolicy, getAutomationRuntimeState, listAutomationRuns } from '../db/automation.js'
import { getLifeDay, getLifeLedger, getLifeMonthSummary } from '../db/life.js'
import { appendEventLog } from '../db/activity.js'
import { dayKeyOf } from '../db/usage.js'
import { createPriceSnapshot, listPriceSnapshots } from '../db/pricing.js'
import { removePushSubscription, savePushSubscription } from '../db/push.js'
import { eventideHistory } from '../db/schema.js'
import { RequestError } from '../lib/errors.js'
import type { McpGateway } from '../mcp/gateway.js'
import { getPushStatus } from '../services/push.js'

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

function currentMonth(): string {
  const zone = getAutomationPolicy().timeZone
  const parts = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  return `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}`
}

function monthParam(value: unknown): string {
  const month = typeof value === 'string' ? value : currentMonth()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RequestError(ErrorCodes.BadRequest, 'month 必须是 YYYY-MM')
  }
  return month
}

function boundedText(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 1..${max} 字符`)
  }
  return value.trim()
}

function nonnegativeInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) {
    throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 0..1000000000 的整数`)
  }
  return value as number
}

const READING_EVENT_TYPES = new Set([
  'reading.opened',
  'reading.progress',
  'reading.bookmark',
  'reading.annotation',
  'reading.vocabulary',
])

const STUDY_EVENT_TYPES = new Set([
  'study.cards.generated',
  'study.card.reviewed',
  'study.record.created',
  'study.task.completed',
])

function optionalNonnegativeInteger(body: Record<string, unknown>, key: string, max = 1_000_000_000): number | undefined {
  if (body[key] === undefined) return undefined
  const value = body[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 0..${max} 的整数`)
  }
  return value as number
}

function optionalPercentage(body: Record<string, unknown>, key: string): number | undefined {
  if (body[key] === undefined) return undefined
  const value = body[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new RequestError(ErrorCodes.BadRequest, `${key} 必须是 0..100 的数字`)
  }
  return Math.round(value * 100) / 100
}

function readingEventBody(value: unknown): {
  eventType: string
  bookId: string
  metrics: Record<string, unknown>
} {
  const body = objectBody(value)
  const eventType = boundedText(body, 'eventType', 40)
  if (!READING_EVENT_TYPES.has(eventType)) throw new RequestError(ErrorCodes.BadRequest, '不支持的共读事件类型')
  const bookId = boundedText(body, 'bookId', 160)
  const bookTitle = boundedText(body, 'bookTitle', 200)
  const paragraphIndex = optionalNonnegativeInteger(body, 'paragraphIndex', 2_000_000)
  const readingSecondsDelta = optionalNonnegativeInteger(body, 'readingSecondsDelta', 86_400)
  const readingSecondsTotal = optionalNonnegativeInteger(body, 'readingSecondsTotal', 31_536_000)
  const progressPercent = optionalPercentage(body, 'progressPercent')
  const enabled = body.enabled === undefined ? undefined : body.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new RequestError(ErrorCodes.BadRequest, 'enabled 必须是布尔值')
  }
  return {
    eventType,
    bookId,
    metrics: {
      source: 'reading',
      bookId,
      bookTitle,
      ...(paragraphIndex === undefined ? {} : { paragraphIndex }),
      ...(readingSecondsDelta === undefined ? {} : { readingSecondsDelta }),
      ...(readingSecondsTotal === undefined ? {} : { readingSecondsTotal }),
      ...(progressPercent === undefined ? {} : { progressPercent }),
      ...(enabled === undefined ? {} : { enabled }),
    },
  }
}

function optionalTimestamp(body: Record<string, unknown>): number | undefined {
  if (body.at === undefined) return undefined
  if (!Number.isSafeInteger(body.at) || (body.at as number) < 0 || (body.at as number) > Date.now() + 86_400_000) {
    throw new RequestError(ErrorCodes.BadRequest, 'at 必须是有效的时间戳，且不能晚于明天')
  }
  return body.at as number
}

function optionalStudyText(body: Record<string, unknown>, key: string, max: number): string | undefined {
  if (body[key] === undefined) return undefined
  return boundedText(body, key, max)
}

function studyEventBody(value: unknown): {
  eventType: string
  metrics: Record<string, unknown>
  refId: string | null
  at: number | undefined
} {
  const body = objectBody(value)
  const eventType = boundedText(body, 'eventType', 40)
  if (!STUDY_EVENT_TYPES.has(eventType)) throw new RequestError(ErrorCodes.BadRequest, '不支持的学习事件类型')
  const subject = optionalStudyText(body, 'subject', 120)
  const label = optionalStudyText(body, 'label', 160)
  const cardId = optionalStudyText(body, 'cardId', 160)
  const studiedOn = optionalStudyText(body, 'studiedOn', 10)
  const dayKey = optionalStudyText(body, 'dayKey', 10)
  if (studiedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(studiedOn)) throw new RequestError(ErrorCodes.BadRequest, 'studiedOn 必须是 YYYY-MM-DD')
  if (dayKey !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new RequestError(ErrorCodes.BadRequest, 'dayKey 必须是 YYYY-MM-DD')
  const count = body.count === undefined ? undefined : nonnegativeInteger(body, 'count')
  const durationMinutes = body.durationMinutes === undefined ? undefined : nonnegativeInteger(body, 'durationMinutes')
  const repetitions = body.repetitions === undefined ? undefined : nonnegativeInteger(body, 'repetitions')
  const intervalDays = body.intervalDays === undefined ? undefined : nonnegativeInteger(body, 'intervalDays')
  const grade = body.grade === undefined ? undefined : body.grade
  if (grade !== undefined && grade !== 'again' && grade !== 'good' && grade !== 'easy') throw new RequestError(ErrorCodes.BadRequest, 'grade 必须是 again / good / easy')
  if (eventType === 'study.cards.generated' && (subject === undefined || count === undefined || count < 1 || count > 100)) throw new RequestError(ErrorCodes.BadRequest, '生成卡片事件需要 1..100 张卡片与主题')
  if (eventType === 'study.card.reviewed' && (subject === undefined || grade === undefined)) throw new RequestError(ErrorCodes.BadRequest, '复习事件需要主题与 grade')
  if (eventType === 'study.record.created' && (subject === undefined || durationMinutes === undefined || durationMinutes < 1 || studiedOn === undefined)) throw new RequestError(ErrorCodes.BadRequest, '学习记录事件需要主题、时长与日期')
  if (eventType === 'study.task.completed' && (label === undefined || dayKey === undefined)) throw new RequestError(ErrorCodes.BadRequest, '任务完成事件需要内容与日期')
  return {
    eventType,
    refId: cardId ?? null,
    at: optionalTimestamp(body),
    metrics: {
      source: 'study',
      ...(subject === undefined ? {} : { subject }),
      ...(count === undefined ? {} : { count }),
      ...(grade === undefined ? {} : { grade }),
      ...(repetitions === undefined ? {} : { repetitions }),
      ...(intervalDays === undefined ? {} : { intervalDays }),
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      ...(studiedOn === undefined ? {} : { studiedOn }),
      ...(label === undefined ? {} : { label }),
      ...(dayKey === undefined ? {} : { dayKey }),
    },
  }
}

export function registerLifeRoutes(app: FastifyInstance, gateway: McpGateway, state: StateProvider | null): void {
  app.get('/api/life/month', async (request) => {
    const query = request.query as Record<string, unknown>
    return getLifeMonthSummary(monthParam(query.month))
  })
  app.get('/api/life/day/:dayKey', async (request) => {
    const { dayKey } = request.params as { dayKey: string }
    const match = /^(\d{4})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.exec(dayKey)
    const valid = match !== null && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      .toISOString().slice(0, 10) === dayKey
    if (!valid) {
      throw new RequestError(ErrorCodes.BadRequest, 'dayKey 必须是 YYYY-MM-DD')
    }
    return getLifeDay(dayKey)
  })
  app.post('/api/life/events/reading', async (request, reply) => {
    const input = readingEventBody(request.body)
    const at = Date.now()
    const id = appendEventLog(input.eventType, input.metrics, input.bookId, at)
    return reply.status(201).send({ ok: true, id, dayKey: dayKeyOf(at), at })
  })
  app.post('/api/life/events/study', async (request, reply) => {
    const input = studyEventBody(request.body)
    const at = input.at ?? Date.now()
    const id = appendEventLog(input.eventType, input.metrics, input.refId, at)
    return reply.status(201).send({ ok: true, id, dayKey: dayKeyOf(at), at })
  })
  app.get('/api/life/ledger', async (request) => {
    const query = request.query as Record<string, unknown>
    return getLifeLedger(monthParam(query.month))
  })
  app.get('/api/life/runtime', async (): Promise<LifeRuntimeView> => {    const [mcp, eventide] = await Promise.all([
      gateway.health().then((servers) => ({ ok: servers.every((server) => server.state === 'ready'), servers })),
      state === null ? Promise.resolve({
        ok: false, configured: false, service: 'eventide' as const, revision: null,
        lastError: 'not configured', lastCheckedAt: Date.now(),
      }) : state.health(),
    ])
    return {
      server: { ok: true, service: 'habitat-server', time: new Date().toISOString() },
      eventide,
      bodyState: (() => {
        const snapshot = state?.current() ?? null
        return snapshot === null ? null : { payload: snapshot.payload, settledAt: snapshot.settledAt }
      })(),
      mcp,
      automation: {
        policy: getAutomationPolicy(),
        runtime: getAutomationRuntimeState(),
        runs: listAutomationRuns(30),
      },
    }
  })

  /** 当前完整快照（状态页「raw 高级」用；runtime 视图里只有摘要） */
  app.get('/api/life/eventide/current', async () => {
    const snapshot = state?.current() ?? null
    if (snapshot === null) {
      throw new RequestError(ErrorCodes.NotFound, '尚无 Eventide 快照')
    }
    return snapshot
  })

  /** 历史快照（状态页趋势 / 最近变化用）。按时间升序返回，方便直接画线。 */
  app.get('/api/life/eventide/history', async (request) => {
    const query = request.query as Record<string, unknown>
    const raw = query.limit === undefined ? 120 : Number(query.limit)
    if (!Number.isInteger(raw) || (raw as number) < 1 || (raw as number) > 500) {
      throw new RequestError(ErrorCodes.BadRequest, 'limit 必须是 1..500 的整数')
    }
    const rows = db
      .select()
      .from(eventideHistory)
      .orderBy(desc(eventideHistory.settledAt))
      .limit(raw)
      .all()
      .reverse()
    return {
      points: rows.map((row) => ({
        settledAt: row.settledAt,
        payload: row.payload,
      })),
    }
  })

  app.get('/api/prices', async () => ({ snapshots: listPriceSnapshots() }))
  app.post('/api/prices', async (request, reply) => {
    const body = objectBody(request.body)
    const validFrom = body.validFrom
    if (!Number.isSafeInteger(validFrom) || (validFrom as number) < 0) {
      throw new RequestError(ErrorCodes.BadRequest, 'validFrom 必须是非负毫秒时间戳')
    }
    const result = createPriceSnapshot({
      provider: boundedText(body, 'provider', 80),
      model: boundedText(body, 'model', 160),
      promptCentsPerMillion: nonnegativeInteger(body, 'promptCentsPerMillion'),
      completionCentsPerMillion: nonnegativeInteger(body, 'completionCentsPerMillion'),
      validFrom: validFrom as number,
    })
    return reply.status(201).send(result)
  })

  app.get('/api/push/status', async () => getPushStatus())
  app.put('/api/push/subscription', async (request) => {
    if (!getPushStatus().configured) throw new RequestError(ErrorCodes.BadRequest, '服务端尚未配置 Web Push VAPID')
    const body = objectBody(request.body)
    const endpoint = boundedText(body, 'endpoint', 4_096)
    const keys = objectBody(body.keys)
    const p256dh = boundedText(keys, 'p256dh', 1_024)
    const auth = boundedText(keys, 'auth', 512)
    if (!/^https:\/\//.test(endpoint)) throw new RequestError(ErrorCodes.BadRequest, 'Push endpoint 必须是 HTTPS')
    savePushSubscription(endpoint, p256dh, auth)
    return { ok: true }
  })
  app.delete('/api/push/subscription', async (request) => {
    const body = objectBody(request.body)
    const endpoint = boundedText(body, 'endpoint', 4_096)
    return { ok: true, removed: removePushSubscription(endpoint) }
  })
}
