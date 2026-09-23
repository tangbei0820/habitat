/** Phase 3B 状态底座：读取快照与手动 tick；主动调度器后续直接复用同一个 StateProvider。 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { StateProvider } from '@shared/providers.js'
import { ProviderError } from '../providers/errors.js'

function requireProvider(provider: StateProvider | null): StateProvider {
  if (provider === null) {
    throw new ProviderError(ErrorCodes.ProviderNotConfigured, '尚未配置 Eventide sidecar（EVENTIDE_URL）')
  }
  return provider
}

export function registerStateRoutes(app: FastifyInstance, provider: StateProvider | null): void {
  app.get('/api/state', async () => ({ snapshot: provider?.current() ?? null }))

  // 这是显式推进入口，供验收与后续 scheduler 共用；不接收客户端自报时间，避免任意跳周期。
  app.post('/api/state/tick', async () => requireProvider(provider).tick(new Date()))
}
