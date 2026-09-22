/**
 * LLM 方案注册表（技术方案 §6.2 ApiProfile / §7.1 Adapter 装配）
 *
 * 职责：装载方案 → 按 id 取方案 → 按方案装配 LLMProvider Adapter → 产出脱敏视图。
 *
 * Phase 1 的方案来源是环境变量 `HABITAT_LLM_PROFILES`（JSON 数组），目的是先把链路跑通。
 * 按 §6.2，ApiProfile 的权威存储在**本地**（前端 Dexie）、服务端只是同步副本；
 * 那套同步随「API 方案管理 UI」落地，届时本注册表换数据源即可，对上层接口不变。
 */
import { ErrorCodes } from '@shared/errors.js'
import type { LLMProvider } from '@shared/providers.js'
import type { ApiProfile, ApiProfileModelMap, ApiProfilePublic } from '@shared/types.js'
import { ProviderError } from './errors.js'
import { OpenAICompatProvider } from './openai-compat.js'

const PROFILES_ENV_KEY = 'HABITAT_LLM_PROFILES'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 只认已知的模型槽位；未知键忽略而不是报错，方便以后加槽位不破坏旧配置 */
function parseModelMap(value: unknown): ApiProfileModelMap {
  const source = isRecord(value) ? value : {}
  const map: ApiProfileModelMap = {}
  const chat = asString(source.chat)
  const tts = asString(source.tts)
  const vision = asString(source.vision)
  const embedding = asString(source.embedding)
  if (chat !== undefined && chat !== '') map.chat = chat
  if (tts !== undefined && tts !== '') map.tts = tts
  if (vision !== undefined && vision !== '') map.vision = vision
  if (embedding !== undefined && embedding !== '') map.embedding = embedding
  return map
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const headers: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    const headerValue = asString(raw)
    if (headerValue !== undefined) headers[key] = headerValue
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

/** 单条方案的解析：字段缺失就丢掉这一条并给出**可读原因**，而不是抛错拖垮整个进程 */
function parseProfile(value: unknown, index: number): { profile: ApiProfile } | { problem: string } {
  if (!isRecord(value)) return { problem: `第 ${index + 1} 条不是对象` }

  const id = asString(value.id)
  if (id === undefined || id === '') return { problem: `第 ${index + 1} 条缺 id` }

  const provider = asString(value.provider) ?? 'openai-compat'
  if (provider !== 'openai-compat') {
    return { problem: `方案 '${id}' 的 provider='${provider}' 暂不支持（当前仅 openai-compat）` }
  }

  const baseUrl = asString(value.baseUrl)
  if (baseUrl === undefined || baseUrl === '') return { problem: `方案 '${id}' 缺 baseUrl` }

  const modelMap = parseModelMap(value.modelMap)
  if (modelMap.chat === undefined) return { problem: `方案 '${id}' 的 modelMap.chat 未指定` }

  const headers = parseHeaders(value.headers)
  return {
    profile: {
      id,
      name: asString(value.name) ?? id,
      provider: 'openai-compat',
      baseUrl,
      // keyRef 缺省为空串 = 该上游不需要鉴权（本地 vLLM / Ollama）
      keyRef: asString(value.keyRef) ?? '',
      modelMap,
      ...(headers === undefined ? {} : { headers }),
      isActive: value.isActive === true,
    },
  }
}

/**
 * 从环境变量装载方案。**永不抛错**：坏配置只被跳过并记入 problems，
 * 由启动流程打印出来（服务照常起，问题可见——与 MCP Gateway 的处理一致）。
 */
export function loadProfiles(env: NodeJS.ProcessEnv = process.env): {
  profiles: ApiProfile[]
  problems: string[]
} {
  const raw = env[PROFILES_ENV_KEY]
  if (raw === undefined || raw.trim() === '') return { profiles: [], problems: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      profiles: [],
      problems: [`${PROFILES_ENV_KEY} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`],
    }
  }
  if (!Array.isArray(parsed)) {
    return { profiles: [], problems: [`${PROFILES_ENV_KEY} 应为 JSON 数组`] }
  }

  const profiles: ApiProfile[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  parsed.forEach((item, index) => {
    const result = parseProfile(item, index)
    if ('problem' in result) {
      problems.push(result.problem)
      return
    }
    if (seen.has(result.profile.id)) {
      problems.push(`方案 id '${result.profile.id}' 重复，已忽略后者`)
      return
    }
    seen.add(result.profile.id)
    profiles.push(result.profile)
  })
  return { profiles, problems }
}

export class LlmRegistry {
  private readonly byId = new Map<string, ApiProfile>()

  constructor(
    profiles: ApiProfile[],
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    for (const profile of profiles) this.byId.set(profile.id, profile)
  }

  list(): ApiProfilePublic[] {
    return [...this.byId.values()].map((profile) => this.toPublic(profile))
  }

  /** 未显式标记 isActive 时退化为第一个方案，省得单方案场景还要写这个字段 */
  active(): ApiProfilePublic | null {
    const found = [...this.byId.values()].find((profile) => profile.isActive)
    const profile = found ?? [...this.byId.values()][0]
    return profile === undefined ? null : this.toPublic(profile)
  }

  require(id: string): ApiProfile {
    const profile = this.byId.get(id)
    if (profile === undefined) {
      throw new ProviderError(ErrorCodes.ProviderNotFound, `未知的 LLM 方案 '${id}'`)
    }
    return profile
  }

  /** Adapter 工厂：业务代码只拿 LLMProvider，不碰具体服务商 */
  provider(id: string): LLMProvider {
    const profile = this.require(id)
    return new OpenAICompatProvider(profile, this.resolveKey(profile))
  }

  /** 脱敏视图：密钥永不下发；header 只给**名字**，因为值里可能藏着凭证 */
  toPublic(profile: ApiProfile): ApiProfilePublic {
    return {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      keyRef: profile.keyRef,
      hasKey: this.resolveKey(profile) !== null,
      modelMap: { ...profile.modelMap },
      headerNames: Object.keys(profile.headers ?? {}),
      isActive: profile.isActive,
    }
  }

  /** keyRef 留空 = 明确表示「不需要鉴权」，与「配了但没设」区分开 */
  private resolveKey(profile: ApiProfile): string | null {
    if (profile.keyRef === '') return ''
    const value = this.env[profile.keyRef]
    return value === undefined || value === '' ? null : value
  }
}
