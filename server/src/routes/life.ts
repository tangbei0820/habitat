/** Phase 4 Life：月历、账本、价格、运行状态与 Web Push 配置。 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { StateProvider } from '@shared/providers.js'
import type { LifeRuntimeView } from '@shared/types.js'
import { getAutomationPolicy, getAutomationRuntimeState, listAutomationRuns } from '../db/automation.js'
import { getLifeDay, getLifeLedger, getLifeMonthSummary } from '../db/life.js'
import { createPriceSnapshot, listPriceSnapshots } from '../db/pricing.js'
import { removePushSubscription, savePushSubscription } from '../db/push.js'
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
  app.get('/api/life/ledger', async (request) => {
    const query = request.query as Record<string, unknown>
    return getLifeLedger(monthParam(query.month))
  })
  app.get('/api/life/runtime', async (): Promise<LifeRuntimeView> => {
    const [mcp, eventide] = await Promise.all([
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
