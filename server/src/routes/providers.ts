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
  ApiProfileCreateInput,
  ApiProfileModelMap,
  ApiProfilePublic,
  ApiProfileUpdateInput,
  LlmProbeResult,
} from '@shared/types'
import { createProfile, clearSecret, setSecret, updateProfile } from '../db/profiles.js'
import { activateProfile, deleteProfile } from '../db/profiles.js'
import { ProviderError } from '../providers/errors.js'
import type { LlmRegistry } from '../providers/registry'

/** 探测结果里最多带几个模型名（够 UI 展示，不刷屏） */
const PROBE_SAMPLE_SIZE = 5

const NAME_MAX_LENGTH = 60
/** 环境变量名规范（POSIX 的保守子集） */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const EXTRA_MODEL_SLOTS = ['tts', 'transcription', 'vision', 'image', 'embedding'] as const

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

/** 只接受 http/https；顺手去掉结尾斜杠，否则会拼出 `//chat/completions` */
function parseBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ProviderError(ErrorCodes.BadRequest, 'baseUrl 必填')
  }
  const trimmed = raw.trim().replace(/\/+$/, '')
  let url: URL
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
  const chat = record.chat
  if (typeof chat !== 'string' || chat.trim() === '') {
    throw new ProviderError(ErrorCodes.BadRequest, 'modelMap.chat 必填（该方案用哪个模型对话）')
  }
  const map: ApiProfileModelMap = { chat: chat.trim() }
  for (const slot of EXTRA_MODEL_SLOTS) {
    const value = record[slot]
    if (typeof value === 'string' && value.trim() !== '') map[slot] = value.trim()
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
    baseUrl: parseBaseUrl(record.baseUrl),
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
  if (record.baseUrl !== undefined) patch.baseUrl = parseBaseUrl(record.baseUrl)
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

export function registerProviderRoutes(app: FastifyInstance, registry: LlmRegistry): void {
  /* ---------- 读 ---------- */

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
