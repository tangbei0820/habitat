/**
 * LLM 方案路由（技术方案 §6.2 / §7.1）
 *
 * 三件事：列方案、取模型列表、探测连通性。
 * 注意「探测失败」是**结果**不是异常 —— 与 `/api/health/mcp` 的处理保持一致，
 * 由前端把 ok=false 渲染成 ⚠️ + 原因，而不是让请求整体失败。
 */
import type { FastifyInstance } from 'fastify'
import type { ApiProfilePublic, LlmProbeResult } from '@shared/types'
import type { LlmRegistry } from '../providers/registry'

/** 探测结果里最多带几个模型名（够 UI 展示，不刷屏） */
const PROBE_SAMPLE_SIZE = 5

interface IdParams {
  id: string
}

export function registerProviderRoutes(app: FastifyInstance, registry: LlmRegistry): void {
  app.get('/api/providers', async (): Promise<{
    active: ApiProfilePublic | null
    profiles: ApiProfilePublic[]
  }> => ({
    active: registry.active(),
    profiles: registry.list(),
  }))

  app.get<{ Params: IdParams }>(
    '/api/providers/:id/models',
    async (request): Promise<{ profileId: string; models: string[] }> => {
      const provider = registry.provider(request.params.id)
      const models = await provider.listModels()
      return { profileId: request.params.id, models }
    },
  )

  app.post<{ Params: IdParams }>('/api/providers/:id/test', async (request): Promise<LlmProbeResult> => {
    const { id } = request.params
    // 未知 id 属于调用方错误（走统一错误处理返回 404），不进 try
    const provider = registry.provider(id)
    const started = Date.now()
    try {
      const models = await provider.listModels()
      return {
        profileId: id,
        ok: true,
        latencyMs: Date.now() - started,
        modelCount: models.length,
        sampleModels: models.slice(0, PROBE_SAMPLE_SIZE),
        error: null,
      }
    } catch (err) {
      return {
        profileId: id,
        ok: false,
        latencyMs: Date.now() - started,
        modelCount: 0,
        sampleModels: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
