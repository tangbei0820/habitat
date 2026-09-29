/** 主聊天首包失败回退配置。
 *
 * 继续复用 app_kv：这是单用户实例的一小段策略状态，不需要为备用链另起表或迁移。
 * 旧版 HABITAT_CHAT_FALLBACK_PROFILE_ID 仍可读取；用户第一次在设置页保存后，
 * 服务端保存的有序列表成为唯一来源，避免环境变量与 UI 互相覆盖。
 */
import type { ChatFallbackConfig } from '@shared/types.js'
import { getKv, setKv } from './kv.js'
import { getProfile } from './profiles.js'

const KV_KEY = 'provider.chat.fallback'
const ENV_KEY = 'HABITAT_CHAT_FALLBACK_PROFILE_ID'
const MAX_FALLBACKS = 3

interface StoredFallback {
  enabled: boolean
  profileIds: string[]
  updatedAt: number
}

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function isChatProfile(id: string): boolean {
  const profile = getProfile(id)
  return profile !== null && (profile.provider === 'codex-subscription' || profile.modelMap.chat !== undefined)
}

function fromEnvironment(env: NodeJS.ProcessEnv): ChatFallbackConfig {
  const id = env[ENV_KEY]?.trim() ?? ''
  return id === ''
    ? { enabled: false, profileIds: [], updatedAt: null, source: 'none' }
    : { enabled: true, profileIds: [id], updatedAt: null, source: 'environment' }
}

export function getChatFallbackConfig(env: NodeJS.ProcessEnv = process.env): ChatFallbackConfig {
  const stored = getKv(KV_KEY)
  if (stored !== null) {
    try {
      const parsed: unknown = JSON.parse(stored)
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>
        const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : Date.now()
        return {
          enabled: record.enabled === true,
          profileIds: normalizeIds(record.profileIds).slice(0, MAX_FALLBACKS),
          updatedAt,
          source: 'saved',
        }
      }
    } catch {
      // 损坏的策略不应阻断服务；下面回到兼容环境变量口径。
    }
  }
  return fromEnvironment(env)
}

export interface SaveChatFallbackInput {
  enabled: boolean
  profileIds: string[]
}

export function saveChatFallbackConfig(input: SaveChatFallbackInput): ChatFallbackConfig {
  const profileIds = normalizeIds(input.profileIds)
  if (profileIds.length > MAX_FALLBACKS) throw new Error(`最多配置 ${MAX_FALLBACKS} 个备用连接`)
  for (const id of profileIds) {
    if (!isChatProfile(id)) throw new Error(`连接 '${id}' 不是可用于主聊天的 Provider`)
  }
  const updatedAt = Date.now()
  const value: StoredFallback = { enabled: input.enabled, profileIds, updatedAt }
  setKv(KV_KEY, JSON.stringify(value))
  return { ...value, source: 'saved' }
}

export function chatFallbackReferences(profileId: string): boolean {
  const config = getChatFallbackConfig()
  return config.enabled && config.profileIds.includes(profileId)
}

export const CHAT_FALLBACK_LIMIT = MAX_FALLBACKS
