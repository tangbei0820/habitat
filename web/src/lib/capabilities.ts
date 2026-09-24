import type { CapabilitySnapshot } from '@shared/capabilities'
import { fetchJson } from './api'

/**
 * 能力面（Phase 6.5）→ LLM 页面「能力模块卡片」。
 *
 * ⚠️ 这是**唯一**允许回答「小栖现在会什么」的来源。前端不许另建一份能力清单、
 * 也不许把能力文案写死在页面里 —— 一旦写死，「界面说会、实际不会」就会重新长出来
 * （这正是 Phase 6.5 要修的那个病，见 `docs/AI_RUNTIME.md` §0）。
 *
 * 只读接口，没有写端点：可用性由服务端按依赖真实情况判定。
 */
export async function getCapabilities(): Promise<CapabilitySnapshot[]> {
  const data = await fetchJson<{ capabilities: CapabilitySnapshot[] }>('/api/capabilities')
  return data.capabilities
}
