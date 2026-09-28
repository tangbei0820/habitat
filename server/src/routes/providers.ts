/**
 * LLM 方案路由（技术方案 §6.2 / §7.1）
 *
 * 三类：**读**（列表 / 模型列表）、**写**（增删改 / 设为默认 / 密钥）、**探测**（连通性）。
 * 注意「探测失败」是**结果**不是异常 —— 与 `/api/health/mcp` 的处理保持一致，
 * 由前端把 ok=false 渲染成 ⚠️ + 原因，而不是让请求整体失败。
 *
 * 凭据的接口设计：**只进不出**。写入走 `PUT /:id/secret`，清除走 `DELETE /:id/secret`，
 * 没有任何端点会把密钥读回来 —— 前端永远只能拿到 `hasKey` / `keySource`（铁律 3）。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type {
  ApiProfile,
  ApiProfileCreateInput,
  ApiProfileModelMap,
  ApiProfilePublic,
  ApiProfileUpdateInput,
  LlmProbeResult,
  ProviderCapability,
  ProviderCenterState,
  ProviderDraftErrorCategory,
  ProviderDraftModelsResult,
  ProviderDraftVoicesResult,
  ProviderDraftTestInput,
  ProviderDraftTestResult,
  ProviderScheme,
  ElevenLabsVoiceSettings,
} from '@shared/types'
import {
  activateProviderScheme,
  copyProviderScheme,
  createProviderScheme,
  deleteProviderScheme,
  listCapabilityBindings,
  listProviderSchemes,
  profileBindingReferences,
  renameProviderScheme,
  saveCapabilityBinding,
  seedCapabilityBindings,
} from '../db/provider-center.js'
import { createProfile, clearSecret, setSecret, updateProfile } from '../db/profiles.js'
import { activateProfile, deleteProfile } from '../db/profiles.js'
import { ProviderError } from '../providers/errors.js'
import type { LlmRegistry } from '../providers/registry'

/** 探测结果里最多带几个模型名（够 UI 展示，不刷屏） */
const PROBE_SAMPLE_SIZE = 5

const NAME_MAX_LENGTH = 60
/** 环境变量名规范（POSIX 的保守子集） */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const EXTRA_MODEL_SLOTS = ['tts', 'voice', 'transcription', 'vision', 'image', 'embedding'] as const
const CAPABILITIES = new Set<ProviderCapability>(['chat', 'voice', 'vision', 'image'])
const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

interface IdParams {
  id: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function requireRecord(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw)
  if (record === null) throw new ProviderError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  return record
}

function parseName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ProviderError(ErrorCodes.BadRequest, 'name 必填')
  }
  const name = raw.trim()
  if (name.length > NAME_MAX_LENGTH) {
    throw new ProviderError(ErrorCodes.BadRequest, `name 最长 ${NAME_MAX_LENGTH} 字（收到 ${name.length} 字）`)
  }
  return name
}

function parseProvider(raw: unknown): 'openai-compat' | 'elevenlabs' | 'codex-subscription' {
  if (raw === undefined || raw === 'openai-compat') return 'openai-compat'
  if (raw === 'elevenlabs') return 'elevenlabs'
  if (raw === 'codex-subscription') return 'codex-subscription'
  throw new ProviderError(ErrorCodes.BadRequest, 'provider 必须是 openai-compat、elevenlabs 或 codex-subscription')
}

function parseVoiceSettings(raw: unknown): ElevenLabsVoiceSettings | undefined {
  if (raw === undefined) return undefined
  const record = asRecord(raw)
  if (record === null) throw new ProviderError(ErrorCodes.BadRequest, 'voiceSettings 必须是对象')
  const settings: ElevenLabsVoiceSettings = {}
  const number = (key: string, min: number, max: number): void => {
    if (record[key] === undefined) return
    if (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || record[key] < min || record[key] > max) {
      throw new ProviderError(ErrorCodes.BadRequest, `voiceSettings.${key} 必须在 ${min}–${max} 之间`)
    }
    if (key === 'stability') settings.stability = record[key] as number
    else if (key === 'similarityBoost') settings.similarityBoost = record[key] as number
    else settings.speed = record[key] as number
  }
  number('stability', 0, 1)
  number('similarityBoost', 0, 1)
  number('style', 0, 1)
  if (record.useSpeakerBoost !== undefined) {
    if (typeof record.useSpeakerBoost !== 'boolean') throw new ProviderError(ErrorCodes.BadRequest, 'voiceSettings.useSpeakerBoost 必须是布尔值')
    settings.useSpeakerBoost = record.useSpeakerBoost
  }
  number('speed', 0.7, 1.2)
  return Object.keys(settings).length === 0 ? undefined : settings
}

/** 只接受 http/https；顺手去掉结尾斜杠，否则会拼出 `//chat/completions` */
function parseBaseUrl(raw: unknown, _provider?: 'openai-compat' | 'elevenlabs' | 'codex-subscription'): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ProviderError(ErrorCodes.BadRequest, 'baseUrl 必填')
  }
  const trimmed = raw.trim().replace(/\/+$/, '')
  let url: URL
  if (trimmed === 'codex://local') return trimmed
  try {
    url = new URL(trimmed)
  } catch {
    throw new ProviderError(
      ErrorCodes.BadRequest,
      `baseUrl 不是合法 URL：${raw}（示例：https://api.deepseek.com/v1）`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError(ErrorCodes.BadRequest, `baseUrl 只支持 http / https，收到 ${url.protocol}`)
  }
  return trimmed
}

function parseModelMapInput(raw: unknown): ApiProfileModelMap {
  const record = asRecord(raw)
  if (record === null) throw new ProviderError(ErrorCodes.BadRequest, 'modelMap 必须是对象')
  const map: ApiProfileModelMap = {}
  const chat = record.chat
  if (typeof chat === 'string' && chat.trim() !== '') map.chat = chat.trim()
  for (const slot of EXTRA_MODEL_SLOTS) {
    const value = record[slot]
    if (typeof value === 'string' && value.trim() !== '') map[slot] = value.trim()
  }
  if (Object.keys(map).length === 0) {
    throw new ProviderError(ErrorCodes.BadRequest, 'modelMap 至少要配置一个能力模型')
  }
  return map
}

/** 留空串是合法值 = 该上游不需要鉴权；填了就必须是合法的环境变量名 */
function parseKeyRefInput(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ProviderError(ErrorCodes.BadRequest, 'keyRef 必须是字符串')
  }
  const ref = raw.trim()
  if (ref === '') return ''
  if (!ENV_NAME_RE.test(ref)) {
    throw new ProviderError(
      ErrorCodes.BadRequest,
      `keyRef 必须是环境变量名（字母 / 数字 / 下划线，不以数字开头）：${raw}`,
    )
  }
  return ref
}

function parseHeadersInput(raw: unknown): Record<string, string> {
  const record = asRecord(raw)
  if (record === null) throw new ProviderError(ErrorCodes.BadRequest, 'headers 必须是对象')
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      throw new ProviderError(ErrorCodes.BadRequest, `headers['${key}'] 必须是字符串`)
    }
    headers[key] = value
  }
  return headers
}

/** 兼容开关：只接受布尔值。缺省不传 = 开（默认值由仓储层兜） */
function parseStreamOptions(raw: unknown): boolean {
  if (typeof raw !== 'boolean') {
    throw new ProviderError(ErrorCodes.BadRequest, 'streamOptions 必须是布尔值')
  }
  return raw
}

function parseCreateInput(raw: unknown): ApiProfileCreateInput {
  const record = requireRecord(raw)
  return {
    name: parseName(record.name),
    provider: parseProvider(record.provider),
    baseUrl: parseBaseUrl(record.baseUrl, parseProvider(record.provider)),
    modelMap: parseModelMapInput(record.modelMap),
    ...(record.keyRef === undefined ? {} : { keyRef: parseKeyRefInput(record.keyRef) }),
    ...(record.headers === undefined ? {} : { headers: parseHeadersInput(record.headers) }),
    ...(record.streamOptions === undefined
      ? {}
      : { streamOptions: parseStreamOptions(record.streamOptions) }),
    ...(record.isActive === undefined ? {} : { isActive: record.isActive === true }),
  }
}

/** PATCH 语义：字段**不出现**= 不改（显式传空串才是「清空」） */
function parseUpdateInput(raw: unknown): ApiProfileUpdateInput {
  const record = requireRecord(raw)
  const patch: ApiProfileUpdateInput = {}
  if (record.name !== undefined) patch.name = parseName(record.name)
  if (record.provider !== undefined) patch.provider = parseProvider(record.provider)
  if (record.baseUrl !== undefined) patch.baseUrl = parseBaseUrl(record.baseUrl, patch.provider ?? undefined)
  if (record.modelMap !== undefined) patch.modelMap = parseModelMapInput(record.modelMap)
  if (record.keyRef !== undefined) patch.keyRef = parseKeyRefInput(record.keyRef)
  if (record.headers !== undefined) patch.headers = parseHeadersInput(record.headers)
  if (record.streamOptions !== undefined) patch.streamOptions = parseStreamOptions(record.streamOptions)
  if (record.isActive !== undefined) patch.isActive = record.isActive === true
  if (Object.keys(patch).length === 0) {
    throw new ProviderError(ErrorCodes.BadRequest, '没有要更新的字段')
  }
  return patch
}

function parseSecretInput(raw: unknown): string {
  const record = requireRecord(raw)
  const secret = record.secret
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new ProviderError(ErrorCodes.BadRequest, 'secret 必填且不能为空字符串')
  }
  return secret.trim()
}

function parseCapability(raw: unknown): ProviderCapability {
  if (typeof raw !== 'string' || !CAPABILITIES.has(raw as ProviderCapability)) {
    throw new ProviderError(ErrorCodes.BadRequest, 'capability 必须是 chat / voice / vision / image')
  }
  return raw as ProviderCapability
}

function parseRequiredModel(raw: unknown, field = 'model'): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ProviderError(ErrorCodes.BadRequest, `${field} 必填`)
  }
  return raw.trim()
}

function parseOptionalProfileId(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.trim() === '') throw new ProviderError(ErrorCodes.BadRequest, 'profileId 不能为空')
  return raw.trim()
}

function draftProfile(raw: unknown, registry: LlmRegistry, capability?: ProviderCapability): {
  profile: ApiProfile
  apiKey?: string
  record: Record<string, unknown>
} {
  const record = requireRecord(raw)
  const profileId = parseOptionalProfileId(record.profileId)
  const existing = profileId === undefined ? undefined : registry.require(profileId)
  const provider = record.provider === undefined ? existing?.provider ?? 'openai-compat' : parseProvider(record.provider)
  const baseUrl = record.baseUrl === undefined
    ? existing?.baseUrl
    : parseBaseUrl(record.baseUrl, provider)
  if (baseUrl === undefined) throw new ProviderError(ErrorCodes.BadRequest, 'baseUrl 必填')
  if (provider === 'elevenlabs' && capability !== undefined && capability !== 'voice') {
    throw new ProviderError(ErrorCodes.BadRequest, 'ElevenLabs 连接只能绑定语音能力')
  }
  if (provider === 'codex-subscription' && capability !== undefined && capability !== 'chat') {
    throw new ProviderError(ErrorCodes.BadRequest, 'Codex Subscription 只能绑定主聊天能力')
  }
  const headers = record.headers === undefined ? existing?.headers : parseHeadersInput(record.headers)
  const streamOptions = record.streamOptions === undefined
    ? existing?.streamOptions ?? true
    : parseStreamOptions(record.streamOptions)
  const modelMap = { ...(existing?.modelMap ?? {}) }
  if (capability !== undefined) {
    const model = parseRequiredModel(record.model)
    if (capability === 'chat') modelMap.chat = model
    else if (capability === 'voice') {
      modelMap.tts = model
      if (provider === 'elevenlabs') {
        const voiceId = typeof record.voiceId === 'string' ? record.voiceId.trim() : ''
        if (voiceId === '') throw new ProviderError(ErrorCodes.BadRequest, 'ElevenLabs voiceId 必填')
        modelMap.voice = voiceId
        const voiceSettings = parseVoiceSettings(record.voiceSettings)
        if (voiceSettings !== undefined) modelMap.voiceSettings = voiceSettings
      }
      if (record.secondaryModel !== undefined && String(record.secondaryModel).trim() !== '') {
        modelMap.transcription = parseRequiredModel(record.secondaryModel, 'secondaryModel')
      }
    } else if (capability === 'vision') modelMap.vision = model
    else modelMap.image = model
  }
  const apiKey = typeof record.apiKey === 'string' && record.apiKey.trim() !== '' ? record.apiKey.trim() : undefined
  return {
    profile: {
      id: existing?.id ?? 'unsaved-draft',
      name: existing?.name ?? '未保存草稿',
      provider,
      baseUrl,
      keyRef: existing?.keyRef ?? '',
      modelMap,
      ...(headers === undefined ? {} : { headers }),
      streamOptions,
      isActive: false,
    },
    ...(apiKey === undefined ? {} : { apiKey }),
    record,
  }
}

function errorCategory(err: unknown): ProviderDraftErrorCategory {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  if (err instanceof ProviderError && err.code === ErrorCodes.ProviderUnauthorized) return 'authentication'
  if (message.includes('超时') || message.includes('timeout') || message.includes('未响应')) return 'timeout'
  if (message.includes('/models') && (message.includes('404') || message.includes('405'))) return 'unsupported'
  if (message.includes('解析') || message.includes('json') || message.includes('响应体')) return 'protocol'
  if (message.includes('连接') || message.includes('fetch') || message.includes('network')) return 'network'
  return 'unknown'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function parseBindingInput(raw: unknown): {
  capability: ProviderCapability
  profileId: string
  model: string
  secondaryModel: string | null
  lastTestedAt: number | null
  lastLatencyMs: number | null
  lastError: string | null
} {
  const record = requireRecord(raw)
  const capability = parseCapability(record.capability)
  const profileId = parseOptionalProfileId(record.profileId)
  if (profileId === undefined) throw new ProviderError(ErrorCodes.BadRequest, 'profileId 必填')
  const numericOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    capability,
    profileId,
    model: parseRequiredModel(record.model),
    secondaryModel: typeof record.secondaryModel === 'string' && record.secondaryModel.trim() !== ''
      ? record.secondaryModel.trim()
      : null,
    lastTestedAt: numericOrNull(record.lastTestedAt),
    lastLatencyMs: numericOrNull(record.lastLatencyMs),
    lastError: typeof record.lastError === 'string' && record.lastError.trim() !== '' ? record.lastError.trim() : null,
  }
}

function parseSchemeName(raw: unknown): string {
  return parseName(requireRecord(raw).name)
}

export function registerProviderRoutes(app: FastifyInstance, registry: LlmRegistry): void {
  /* ---------- 读 ---------- */

  app.get('/api/providers', async (): Promise<{
    active: ApiProfilePublic | null
    profiles: ApiProfilePublic[]
  }> => ({
    active: registry.active(),
    profiles: registry.list(),
  }))

  app.get('/api/provider-center', async (): Promise<ProviderCenterState> => {
    const active = registry.active()
    seedCapabilityBindings(active === null ? null : registry.require(active.id))
    return { bindings: listCapabilityBindings(), schemes: listProviderSchemes() }
  })

  /* ---------- 未保存草稿：拉模型 / 真实能力测试 ---------- */

  app.post('/api/providers/draft/models', async (request): Promise<ProviderDraftModelsResult> => {
    const draft = draftProfile(request.body, registry)
    const provider = registry.draftProvider(draft.profile, draft.apiKey)
    const started = Date.now()
    try {
      const models = await provider.listModels()
      if (models.length === 0) {
        return { ok: false, latencyMs: Date.now() - started, models: [], errorCategory: 'empty-models', error: '上游返回了空模型列表，可继续手填模型 ID' }
      }
      return { ok: true, latencyMs: Date.now() - started, models, errorCategory: null, error: null }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, models: [], errorCategory: errorCategory(err), error: errorMessage(err) }
    }
  })

  app.post('/api/providers/draft/voices', async (request): Promise<ProviderDraftVoicesResult> => {
    const draft = draftProfile(request.body, registry)
    const started = Date.now()
    if (draft.profile.provider !== 'elevenlabs') {
      return { ok: false, latencyMs: Date.now() - started, voices: [], errorCategory: 'unsupported', error: '只有 ElevenLabs 原生连接支持拉取音色' }
    }
    const provider = registry.draftProvider(draft.profile, draft.apiKey)
    if (!('listVoices' in provider)) {
      return { ok: false, latencyMs: Date.now() - started, voices: [], errorCategory: 'unsupported', error: '当前 ElevenLabs 适配器未提供音色目录' }
    }
    try {
      const voices = await provider.listVoices()
      if (voices.length === 0) {
        return { ok: false, latencyMs: Date.now() - started, voices: [], errorCategory: 'empty-voices', error: '上游返回了空音色列表，可继续手填 Voice ID' }
      }
      return { ok: true, latencyMs: Date.now() - started, voices, errorCategory: null, error: null }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, voices: [], errorCategory: errorCategory(err), error: errorMessage(err) }
    }
  })

  app.post('/api/providers/draft/test', async (request): Promise<ProviderDraftTestResult> => {
    const raw = requireRecord(request.body)
    const capability = parseCapability(raw.capability)
    const draft = draftProfile(request.body, registry, capability)
    const input = draft.record as unknown as ProviderDraftTestInput
    const provider = registry.draftProvider(draft.profile, draft.apiKey)
    const started = Date.now()
    const testedAt = Date.now()
    try {
      let previewDataUrl: string | null = null
      let description: string | null = null
      if (capability === 'chat') {
        let sawReply = false
        for await (const chunk of provider.streamChat([{ role: 'user', content: '请只回复 OK' }], { maxTokens: 8 })) {
          if (chunk.type === 'delta' && (chunk.delta.content ?? '') !== '') sawReply = true
        }
        if (!sawReply) throw new ProviderError(ErrorCodes.ProviderUpstreamError, '流式请求完成，但没有返回正文')
      } else if (capability === 'voice') {
        if (!('synthesize' in provider)) throw new ProviderError(ErrorCodes.BadRequest, 'Codex Subscription 不支持语音测试')
        const result = await provider.synthesize('这是栖息地的语音连接测试。')
        previewDataUrl = `data:${result.mimeType};base64,${Buffer.from(result.audio).toString('base64')}`
      } else if (capability === 'vision') {
        if (!('vision' in provider)) throw new ProviderError(ErrorCodes.BadRequest, 'Codex Subscription 不支持识图测试')
        const result = await provider.vision(typeof input.dataUrl === 'string' ? input.dataUrl : TEST_IMAGE, '请用一句话描述测试图片。')
        description = result.description
      } else {
        if (!('generate' in provider)) throw new ProviderError(ErrorCodes.BadRequest, 'Codex Subscription 不支持生图测试')
        const result = await provider.generate('A tiny warm lamp icon on a plain background')
        previewDataUrl = result.dataUrl
      }
      return {
        capability,
        ok: true,
        latencyMs: Date.now() - started,
        testedAt,
        errorCategory: null,
        error: null,
        previewDataUrl,
        description,
      }
    } catch (err) {
      return {
        capability,
        ok: false,
        latencyMs: Date.now() - started,
        testedAt,
        errorCategory: errorCategory(err),
        error: errorMessage(err),
        previewDataUrl: null,
        description: null,
      }
    }
  })

  /* ---------- 四通道绑定与方案 ---------- */

  app.put('/api/provider-center/bindings', async (request) => {
    const input = parseBindingInput(request.body)
    const profile = registry.require(input.profileId)
    if (profile.provider === 'elevenlabs' && input.capability !== 'voice') {
      throw new ProviderError(ErrorCodes.BadRequest, 'ElevenLabs 连接只能绑定语音能力')
    }
    return saveCapabilityBinding(input)
  })

  app.post('/api/provider-center/schemes', async (request, reply): Promise<ProviderScheme> => {
    try {
      const scheme = createProviderScheme(parseSchemeName(request.body))
      reply.status(201)
      return scheme
    } catch (err) {
      throw new ProviderError(ErrorCodes.BadRequest, errorMessage(err))
    }
  })

  app.patch<{ Params: IdParams }>('/api/provider-center/schemes/:id', async (request): Promise<ProviderScheme> => {
    try {
      const scheme = renameProviderScheme(request.params.id, parseSchemeName(request.body))
      if (scheme === null) throw new ProviderError(ErrorCodes.NotFound, '方案不存在')
      return scheme
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw new ProviderError(ErrorCodes.BadRequest, errorMessage(err))
    }
  })

  app.post<{ Params: IdParams }>('/api/provider-center/schemes/:id/copy', async (request, reply): Promise<ProviderScheme> => {
    try {
      const scheme = copyProviderScheme(request.params.id, parseSchemeName(request.body))
      if (scheme === null) throw new ProviderError(ErrorCodes.NotFound, '方案不存在')
      reply.status(201)
      return scheme
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw new ProviderError(ErrorCodes.BadRequest, errorMessage(err))
    }
  })

  app.post<{ Params: IdParams }>('/api/provider-center/schemes/:id/activate', async (request): Promise<ProviderScheme> => {
    try {
      const scheme = activateProviderScheme(request.params.id)
      if (scheme === null) throw new ProviderError(ErrorCodes.NotFound, '方案不存在')
      return scheme
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw new ProviderError(ErrorCodes.BadRequest, errorMessage(err))
    }
  })

  app.delete<{ Params: IdParams }>('/api/provider-center/schemes/:id', async (request): Promise<{ deleted: true }> => {
    if (!deleteProviderScheme(request.params.id)) throw new ProviderError(ErrorCodes.NotFound, '方案不存在')
    return { deleted: true }
  })

  app.get<{ Params: IdParams }>(
    '/api/providers/:id/models',
    async (request): Promise<{ profileId: string; models: string[] }> => {
      const provider = registry.provider(request.params.id)
      const models = await provider.listModels()
      return { profileId: request.params.id, models }
    },
  )

  /* ---------- 写 ---------- */

  app.post('/api/providers', async (request, reply): Promise<ApiProfilePublic> => {
    const created = createProfile(parseCreateInput(request.body))
    reply.status(201)
    return registry.toPublic(created)
  })

  app.patch<{ Params: IdParams }>(
    '/api/providers/:id',
    async (request): Promise<ApiProfilePublic> => {
      const { id } = request.params
      registry.require(id) // 未知 id 走 404，而不是让仓储层抛通用错误
      return registry.toPublic(updateProfile(id, parseUpdateInput(request.body)))
    },
  )

  app.delete<{ Params: IdParams }>(
    '/api/providers/:id',
    async (request): Promise<{ deleted: true; id: string; active: ApiProfilePublic | null }> => {
      const { id } = request.params
      const references = profileBindingReferences(id)
      if (references.length > 0) {
        throw new ProviderError(ErrorCodes.BadRequest, `连接仍被引用，不能删除：${references.join('、')}`)
      }
      if (!deleteProfile(id)) {
        throw new ProviderError(ErrorCodes.ProviderNotFound, `未知的 LLM 方案 '${id}'`)
      }
      // 顺带把「删完之后谁是默认」告诉前端，省一次往返
      return { deleted: true, id, active: registry.active() }
    },
  )

  app.post<{ Params: IdParams }>(
    '/api/providers/:id/activate',
    async (request): Promise<{ active: ApiProfilePublic }> => ({
      active: registry.toPublic(activateProfile(request.params.id)),
    }),
  )

  /* ---------- 凭据（只进不出） ---------- */

  app.put<{ Params: IdParams }>(
    '/api/providers/:id/secret',
    async (request): Promise<Pick<ApiProfilePublic, 'id' | 'hasKey' | 'keySource'>> => {
      const { id } = request.params
      const profile = registry.require(id)
      setSecret(id, parseSecretInput(request.body))
      // 回执只给「现在能不能用」，绝不回显密钥本身
      const view = registry.toPublic(profile)
      return { id: view.id, hasKey: view.hasKey, keySource: view.keySource }
    },
  )

  app.delete<{ Params: IdParams }>(
    '/api/providers/:id/secret',
    async (request): Promise<Pick<ApiProfilePublic, 'id' | 'hasKey' | 'keySource'>> => {
      const { id } = request.params
      const profile = registry.require(id)
      clearSecret(id)
      // 删掉表内密钥后可能回落到 keyRef 指向的环境变量，所以重新解析一次
      const view = registry.toPublic(profile)
      return { id: view.id, hasKey: view.hasKey, keySource: view.keySource }
    },
  )

  /* ---------- 探测 ---------- */

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
