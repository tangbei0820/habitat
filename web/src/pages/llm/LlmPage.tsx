/**
 * LLM 页面 = 小栖档案（SPEC §9.1）。
 *
 * 回答一个问题：**小栖现在会做什么，以及你能去哪里看。**
 *
 * 三条设计底线：
 *   1. 内容唯一来源是 `GET /api/capabilities`。页面**不自带**第二份能力清单 ——
 *      写死的文案迟早会和真实可调用的能力脱钩（Phase 6.5 修的正是这个病）。
 *   2. **只读**。这里不提供「把某项能力打开」的开关：能不能用由服务端按依赖判定。
 *   3. **不做假入口**。有界面的模块才可点；没有界面的明说「暂无界面」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CapabilitySnapshot } from '@shared/capabilities'
import { ErrorCodes } from '@shared/errors'
import { CapabilityModuleCard } from '../../features/llm/CapabilityModuleCard'
import { CAPABILITY_MODULES } from '../../features/llm/capabilityModules'
import { ApiRequestError } from '../../lib/api'
import { getCapabilities } from '../../lib/capabilities'
import { log } from '../../lib/log'

type LoadState = 'loading' | 'ready' | 'failed'

export function LlmPage() {
  const [state, setState] = useState<LoadState>('loading')
  const [capabilities, setCapabilities] = useState<CapabilitySnapshot[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((): void => {
    setState('loading')
    setError(null)
    getCapabilities()
      .then((list) => {
        setCapabilities(list)
        setState('ready')
      })
      .catch((err: unknown) => {
        log.error('读取能力面失败', err)
        // 离线单独说清 —— 与「后端挂了」是两个问题，混成一句会把排查带偏
        setError(
          err instanceof ApiRequestError && err.code === ErrorCodes.Offline
            ? '当前处于离线状态，联网后即可看到小栖的能力面'
            : err instanceof ApiRequestError
              ? err.message
              : String(err),
        )
        setState('failed')
      })
  }, [])

  useEffect(load, [load])

  /** 按模块分组。模块顺序由 `CAPABILITY_MODULES` 决定，不按接口返回顺序 —— 顺序是设计，不是数据的副产物。 */
  const grouped = useMemo(
    () =>
      CAPABILITY_MODULES.map((meta) => ({
        meta,
        items: capabilities.filter((capability) => capability.module === meta.key),
      })).filter((group) => group.items.length > 0),
    [capabilities],
  )

  const enabledCount = capabilities.filter((capability) => capability.enabled).length

  return (
    <div className="px-4 py-6" data-page="llm">
      <h1 className="text-lg font-semibold">小栖档案</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        小栖现在会做的事，以及你能去哪里看。
      </p>

      {state === 'loading' && (
        <p data-testid="llm-loading" className="mt-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
          正在读取小栖的能力面…
        </p>
      )}

      {state === 'failed' && (
        <div
          data-testid="llm-error"
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)', color: 'var(--danger)' }}
        >
          <p>读不到能力面：{error}</p>
          <button
            type="button"
            data-testid="llm-retry"
            onClick={load}
            className="mt-2 rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
          >
            重试
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          <p data-testid="llm-summary" className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            共 {capabilities.length} 项能力 · 当前可用 {enabledCount} 项
            {enabledCount < capabilities.length && '（灰色项标了用不了的原因）'}
          </p>

          {grouped.length === 0 ? (
            <p data-testid="llm-empty" className="mt-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              服务端还没有登记任何能力。
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {grouped.map((group) => (
                <CapabilityModuleCard key={group.meta.key} meta={group.meta} capabilities={group.items} />
              ))}
            </div>
          )}

          {/* 记忆页入口在上方「记忆」模块卡（capabilityModules.ts）；这里不再放第二个 */}

          <p className="mt-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
            这份档案由服务端按依赖真实情况生成，界面不做改动。小栖在对话里怎么用它，见 Chat；它产生了什么，见 Home 与生活。
          </p>
        </>
      )}
    </div>
  )
}
