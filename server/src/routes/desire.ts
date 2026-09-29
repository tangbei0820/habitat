/** Core-4 Desire 影子视图：普通页面只看到生活化摘要与候选，永不直接驱动行动。 */
import type { FastifyInstance } from 'fastify'
import { listDesireAudits } from '../db/desire.js'
import { RequestError } from '../lib/errors.js'
import type { DesireEngine } from '../services/desire.js'

function limitOf(value: unknown): number {
  if (value === undefined) return 50
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RequestError('BAD_REQUEST', 'limit 必须是 1..200 的整数')
  }
  return limit
}

export function registerDesireRoutes(app: FastifyInstance, desire: DesireEngine): void {
  app.get('/api/desire', async (request) => {
    const query = request.query as Record<string, unknown>
    return { snapshot: desire.current(), audits: listDesireAudits(limitOf(query.limit)) }
  })

  /** 显式推进影子状态；不触发 LLM、不发消息、不执行候选行动。 */
  app.post('/api/desire/tick', async () => ({ snapshot: desire.tick() }))
}
