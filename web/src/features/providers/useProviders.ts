/**
 * API 方案的状态中枢：列表 + 增删改 + 测试连接。
 *
 * 状态放在服务端（SQLite 是权威源），前端每次操作后**重新拉一次列表**，
 * 不做本地乐观更新 —— 方案改动是低频操作，而「列表与真实配置一致」比少一次往返重要得多。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  ApiProfileCreateInput,
  ApiProfilePublic,
  ApiProfileUpdateInput,
  LlmProbeResult,
} from '@shared/types'
import { ApiRequestError } from '../../lib/api'
import { log } from '../../lib/log'
import * as api from './api'

export interface ProvidersController {
  profiles: ApiProfilePublic[]
  activeId: string | null
  loading: boolean
  /** 写操作进行中（新建 / 编辑 / 删除 / 设为默认 / 改密钥） */
  mutating: boolean
  error: string | null
  /** 每个方案最近一次「测试连接」的结果 */
  probes: Record<string, LlmProbeResult>
  /** 正在测试中的方案 id（用于把按钮文案换成「测试中…」） */
  probingId: string | null
  reload: () => void
  create: (input: ApiProfileCreateInput, secret: string | null) => Promise<boolean>
  update: (id: string, patch: ApiProfileUpdateInput, secret: string | null) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  activate: (id: string) => Promise<boolean>
  clearKey: (id: string) => Promise<boolean>
  test: (id: string) => Promise<void>
}

function toMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : String(err)
}

export function useProviders(): ProvidersController {
  const [profiles, setProfiles] = useState<ApiProfilePublic[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probes, setProbes] = useState<Record<string, LlmProbeResult>>({})
  const [probingId, setProbingId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listProviders()
      .then((list) => {
        if (cancelled) return
        setProfiles(list.profiles)
        setActiveId(list.active?.id ?? null)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        log.error('读取 API 方案失败', err)
        setError(toMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  /** 所有写操作的公共壳：统一错误处理 + 成功后重新拉取 */
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setMutating(true)
    try {
      await fn()
      setError(null)
      setTick((value) => value + 1)
      return true
    } catch (err) {
      log.error('API 方案操作失败', err)
      setError(toMessage(err))
      return false
    } finally {
      setMutating(false)
    }
  }, [])

  const create = useCallback(
    (input: ApiProfileCreateInput, secret: string | null) =>
      run(async () => {
        const created = await api.createProvider(input)
        // 密钥分两步写：先建方案拿到 id 再写密钥（密钥不进方案实体）
        if (secret !== null) await api.setProviderSecret(created.id, secret)
      }),
    [run],
  )

  const update = useCallback(
    (id: string, patch: ApiProfileUpdateInput, secret: string | null) =>
      run(async () => {
        await api.updateProvider(id, patch)
        if (secret !== null) await api.setProviderSecret(id, secret)
      }),
    [run],
  )

  const remove = useCallback((id: string) => run(() => api.deleteProvider(id)), [run])
  const activate = useCallback((id: string) => run(() => api.activateProvider(id)), [run])
  const clearKey = useCallback((id: string) => run(() => api.clearProviderSecret(id)), [run])

  const test = useCallback(async (id: string): Promise<void> => {
    setProbingId(id)
    try {
      const result = await api.testProvider(id)
      setProbes((prev) => ({ ...prev, [id]: result }))
      setError(null)
    } catch (err) {
      // 只有「请求本身失败」（如后端挂了）才走这里；上游连不上是 ok=false 的正常结果
      log.error('测试连接请求失败', err)
      setError(toMessage(err))
    } finally {
      setProbingId(null)
    }
  }, [])

  return {
    profiles,
    activeId,
    loading,
    mutating,
    error,
    probes,
    probingId,
    reload,
    create,
    update,
    remove,
    activate,
    clearKey,
    test,
  }
}
