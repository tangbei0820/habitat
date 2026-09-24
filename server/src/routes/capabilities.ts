import type { FastifyInstance } from 'fastify'
import type { CapabilitySnapshot } from '@shared/capabilities'
import type { CapabilityService } from '../capabilities/registry.js'

/**
 * 能力面（Phase 6.5）。
 *
 * 这是 LLM 页面「能力卡片」的数据来源，也是**用户能自己核对 AI 到底有什么能力**的入口 ——
 * 在此之前，「小栖会做什么」只存在于提示词文案里，用户与 AI 双方都无从验证。
 *
 * 只读，没有写端点：能力是否可用由服务端按依赖真实情况判定，
 * 不该提供一个「手动把某项能力改成可用」的开关 —— 那会立刻把这份快照变成谎言。
 */
export function registerCapabilityRoutes(app: FastifyInstance, capabilities: CapabilityService): void {
  app.get('/api/capabilities', async (): Promise<{ capabilities: CapabilitySnapshot[] }> => {
    return { capabilities: await capabilities.snapshot() }
  })
}
