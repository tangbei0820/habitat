/**
 * LLM 方案注册表（技术方案 §6.2 ApiProfile / §7.1 Adapter 装配）
 *
 * 职责：装载方案 → 按 id 取方案 → 按方案装配 LLMProvider Adapter → 产出脱敏视图。
 *
 * 数据源演进：切片一是环境变量 `HABITAT_LLM_PROFILES`（先把链路跑通），
 * 切片三换成**服务端 SQLite**（`db/profiles.ts`）。对外接口一字未改，调用方无感。
 * 环境变量降级为**首次种子**（见 `importProfiles`）。
 *
 * 为什么每次都读库而不是缓存在内存：方案改动是低频操作，而 better-sqlite3 是同步的、
 * 本地读在微秒级；省掉缓存失效逻辑换来的确定性远比这点开销值。
 */
import { ErrorCodes } from '@shared/errors.js'
import type { LLMProvider } from '@shared/providers.js'
import type {
  ApiKeySource,
  ApiProfile,
  ApiProfileModelMap,
  ApiProfilePublic,
  ElevenLabsVoiceSettings,
  ProviderCapability,
  ProviderCapabilityBinding,
} from '@shared/types.js'
import { getCapabilityBinding, seedCapabilityBindings } from '../db/provider-center.js'
import { getProfile, getSecret, listProfiles } from '../db/profiles.js'
import { ProviderError } from './errors.js'
import { ElevenLabsProvider } from './elevenlabs.js'
import { OpenAICompatProvider } from './openai-compat.js'

const PROFILES_ENV_KEY = 'HABITAT_LLM_PROFILES'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseVoiceSettings(value: unknown): ElevenLabsVoiceSettings | undefined {
  if (!isRecord(value)) return undefined
  const settings: ElevenLabsVoiceSettings = {}
  const stability = value.stability
  const similarityBoost = value.similarityBoost
  const style = value.style
  const useSpeakerBoost = value.useSpeakerBoost
  const speed = value.speed
  if (typeof stability === 'number' && Number.isFinite(stability) && stability >= 0 && stability <= 1) settings.stability = stability
  if (typeof similarityBoost === 'number' && Number.isFinite(similarityBoost) && similarityBoost >= 0 && similarityBoost <= 1) settings.similarityBoost = similarityBoost
  if (typeof style === 'number' && Number.isFinite(style) && style >= 0 && style <= 1) settings.style = style
  if (typeof useSpeakerBoost === 'boolean') settings.useSpeakerBoost = useSpeakerBoost
  if (typeof speed === 'number' && Number.isFinite(speed) && speed >= 0.7 && speed <= 1.2) settings.speed = speed
  return Object.keys(settings).length === 0 ? undefined : settings
}

/** 只认已知的模型槽位；未知键忽略而不是报错，方便以后加槽位不破坏旧配置 */
function parseModelMap(value: unknown): ApiProfileModelMap {
  const source = isRecord(value) ? value : {}
  const map: ApiProfileModelMap = {}
  const chat = asString(source.chat)
  const tts = asString(source.tts)
  const voice = asString(source.voice)
  const voiceSettings = parseVoiceSettings(source.voiceSettings)
  const transcription = asString(source.transcription)
  const vision = asString(source.vision)
  const image = asString(source.image)
  const embedding = asString(source.embedding)
  if (chat !== undefined && chat !== '') map.chat = chat
  if (tts !== undefined && tts !== '') map.tts = tts
  if (voice !== undefined && voice !== '') map.voice = voice
  if (voiceSettings !== undefined) map.voiceSettings = voiceSettings
  if (transcription !== undefined && transcription !== '') map.transcription = transcription
  if (vision !== undefined && vision !== '') map.vision = vision
  if (image !== undefined && image !== '') map.image = image
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
  if (provider !== 'openai-compat' && provider !== 'elevenlabs') {
    return { problem: `方案 '${id}' 的 provider='${provider}' 暂不支持` }
  }

  const baseUrl = asString(value.baseUrl)
  if (baseUrl === undefined || baseUrl === '') return { problem: `方案 '${id}' 缺 baseUrl` }

  const modelMap = parseModelMap(value.modelMap)
  if (Object.keys(modelMap).length === 0) return { problem: `方案 '${id}' 未指定任何能力模型` }

  const headers = parseHeaders(value.headers)
  return {
    profile: {
      id,
      name: asString(value.name) ?? id,
      provider,
      baseUrl,
      // keyRef 缺省为空串 = 该上游不需要鉴权（本地 vLLM / Ollama）
      keyRef: asString(value.keyRef) ?? '',
      modelMap,
      ...(headers === undefined ? {} : { headers }),
      // 只在显式 `false` 时记下来；其余一律走「缺省 = 开」，免得默认值在多处各写一遍
      ...(value.streamOptions === false ? { streamOptions: false } : {}),
      isActive: value.isActive === true,
    },
  }
}

/**
 * 从环境变量装载方案（**仅用于首次种子导入**）。**永不抛错**：坏配置只被跳过并记入 problems，
 * 由启动流程打印出来（服务照常起，问题可见——与 MCP Gateway 的处理一致）。
 *
 * 注意：`.env` 里这一行必须是**单行 JSON**（`server/src/lib/env.ts` 是逐行解析的）。
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
      problems: [
        `${PROFILES_ENV_KEY} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}` +
          '（提示：本变量必须写成**单行** JSON，换行会被 .env 解析器截断）',
      ],
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

/** 凭据解析结果：密钥值 + 来源。来源要下发给前端，值只留在服务端 */
interface ResolvedKey {
  key: string | null
  source: ApiKeySource
}

export class LlmRegistry {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  list(): ApiProfilePublic[] {
    return listProfiles().map((profile) => this.toPublic(profile))
  }

  /** DB 里正常只会有 0~1 条 isActive（`activateProfile` 保证互斥），兜底退化为第一条 */
  active(): ApiProfilePublic | null {
    const profiles = listProfiles()
    const profile = profiles.find((p) => p.isActive) ?? profiles[0]
    return profile === undefined ? null : this.toPublic(profile)
  }

  /** 读取四通道绑定；老库首次访问时从原 active profile 安全补种。 */
  binding(capability: ProviderCapability): ProviderCapabilityBinding | null {
    const active = listProfiles().find((profile) => profile.isActive) ?? listProfiles()[0] ?? null
    seedCapabilityBindings(active)
    return getCapabilityBinding(capability)
  }

  require(id: string): ApiProfile {
    const profile = getProfile(id)
    if (profile === null) {
      throw new ProviderError(ErrorCodes.ProviderNotFound, `未知的 LLM 方案 '${id}'`)
    }
    return profile
  }

  /** Adapter 工厂：业务代码只拿 LLMProvider，不碰具体服务商 */
  provider(id: string): LLMProvider {
    const profile = this.require(id)
    return this.adapter(profile, this.resolveKey(profile).key)
  }

  /** Phase 5 媒体能力与聊天共用同一方案 / 凭据，但拿到完整兼容适配器。 */
  mediaProvider(id: string): OpenAICompatProvider | ElevenLabsProvider {
    const profile = this.require(id)
    return this.adapter(profile, this.resolveKey(profile).key)
  }

  /** 默认业务调用按能力绑定解析；没绑定时兼容回退到旧 active profile。 */
  capabilityProvider(capability: ProviderCapability): {
    profile: ApiProfilePublic
    provider: OpenAICompatProvider | ElevenLabsProvider
    binding: ProviderCapabilityBinding | null
  } | null {
    const binding = this.binding(capability)
    const fallback = this.active()
    if (binding === null) {
      if (fallback === null) return null
      const fallbackModel = capability === 'chat'
        ? fallback.modelMap.chat
        : capability === 'voice'
          ? fallback.modelMap.tts
          : capability === 'vision'
            ? fallback.modelMap.vision
            : fallback.modelMap.image
      if (fallbackModel === undefined || fallbackModel === '') return null
      return { profile: fallback, provider: this.mediaProvider(fallback.id), binding: null }
    }
    const profile = this.require(binding.profileId)
    const modelMap = { ...profile.modelMap }
    if (capability === 'chat') modelMap.chat = binding.model
    else if (capability === 'voice') {
      modelMap.tts = binding.model
      if (binding.secondaryModel !== null) modelMap.transcription = binding.secondaryModel
    } else if (capability === 'vision') modelMap.vision = binding.model
    else modelMap.image = binding.model
    const resolved = { ...profile, modelMap }
    return {
      profile: this.toPublic(resolved),
      provider: this.adapter(resolved, this.resolveKey(profile).key),
      binding,
    }
  }

  /** 未保存草稿专用 Adapter。apiKey 不落库，也不进入任何返回值。 */
  draftProvider(profile: ApiProfile, apiKey?: string): OpenAICompatProvider | ElevenLabsProvider {
    const key = apiKey === undefined ? this.resolveKey(profile).key : apiKey
    return this.adapter(profile, key)
  }

  /** 脱敏视图：密钥永不下发；header 只给**名字**，因为值里可能藏着凭证 */
  toPublic(profile: ApiProfile): ApiProfilePublic {
    const resolved = this.resolveKey(profile)
    return {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      keyRef: profile.keyRef,
      hasKey: resolved.key !== null,
      keySource: resolved.source,
      modelMap: { ...profile.modelMap },
      headerNames: Object.keys(profile.headers ?? {}),
      // 库里的列非空且带默认值，解析出来的域类型却允许缺省 —— 统一在出口补成布尔值
      streamOptions: profile.streamOptions ?? true,
      isActive: profile.isActive,
    }
  }

  /**
   * 凭据来源优先级：**表内密钥 > keyRef 环境变量**。
   *
   * 这个顺序让 UI 可以为已有的 env 方案补填密钥（覆盖生效），同时不退化为「必须把密钥搬进库里」。
   * `keyRef` 留空 = 明确表示「不需要鉴权」，与「配了但没设」区分开 —— 前者可用，后者不可用。
   */
  private resolveKey(profile: ApiProfile): ResolvedKey {
    const stored = getSecret(profile.id)
    if (stored !== null && stored !== '') return { key: stored, source: 'stored' }
    if (profile.keyRef === '') return { key: '', source: 'not-required' }
    const value = this.env[profile.keyRef]
    if (value === undefined || value === '') return { key: null, source: 'missing' }
    return { key: value, source: 'env' }
  }

  private adapter(profile: ApiProfile, key: string | null): OpenAICompatProvider | ElevenLabsProvider {
    return profile.provider === 'elevenlabs'
      ? new ElevenLabsProvider(profile, key)
      : new OpenAICompatProvider(profile, key)
  }
}
