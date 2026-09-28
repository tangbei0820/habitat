/** ElevenLabs 原生 TTS Adapter。
 *
 * 只实现 Provider Center / 异步朗读需要的同步语音接口；聊天、识图、生图与转写
 * 明确拒绝，不把一个语音连接伪装成全能力 Provider。
 */
import { ErrorCodes } from '@shared/errors.js'
import type {
  ImageProvider,
  LLMProvider,
  LlmChatMessage,
  LlmStreamChunk,
  StreamChatOptions,
  TTSProvider,
  TranscriptionProvider,
  VoiceCatalogProvider,
} from '@shared/providers.js'
import type { ApiProfile, ElevenLabsVoiceOption } from '@shared/types.js'
import { ProviderError } from './errors.js'

const HEADER_TIMEOUT_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

async function responseSnippet(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).trim()
    return text === '' ? null : text.slice(0, 400)
  } catch {
    return null
  }
}

export class ElevenLabsProvider implements LLMProvider, TTSProvider, TranscriptionProvider, ImageProvider, VoiceCatalogProvider {
  constructor(
    private readonly profile: ApiProfile,
    private readonly key: string | null,
  ) {}

  get profileId(): string {
    return this.profile.id
  }

  get defaultModel(): string {
    return this.profile.modelMap.chat ?? ''
  }

  async listModels(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string[]> {
    const response = await this.request('/models', { signal: opts?.signal, timeoutMs: opts?.timeoutMs })
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, '解析 ElevenLabs 模型列表失败', String(error))
    }
    const rows = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.models) ? body.models : []
    return rows
      .map((item) => isRecord(item) ? (asString(item.model_id) ?? asString(item.id)) : undefined)
      .filter((model): model is string => model !== undefined && model.trim() !== '')
  }

  async listVoices(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ElevenLabsVoiceOption[]> {
    const response = await this.request('/voices', { signal: opts?.signal, timeoutMs: opts?.timeoutMs })
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new ProviderError(ErrorCodes.ProviderUpstreamError, '解析 ElevenLabs 音色列表失败', String(error))
    }
    const rows = isRecord(body) && Array.isArray(body.voices) ? body.voices : []
    return rows.flatMap((item): ElevenLabsVoiceOption[] => {
      if (!isRecord(item)) return []
      const id = asString(item.voice_id) ?? asString(item.id)
      const name = asString(item.name) ?? id
      if (id === undefined || id.trim() === '' || name === undefined || name.trim() === '') return []
      const rawLabels = isRecord(item.labels) ? item.labels : {}
      const labels = Object.fromEntries(Object.entries(rawLabels).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []))
      return [{
        id: id.trim(),
        name: name.trim(),
        category: asString(item.category) ?? null,
        description: asString(item.description) ?? null,
        labels,
      }]
    })
  }

  async synthesize(text: string, voice?: string): Promise<{ audio: Uint8Array; mimeType: string; model: string }> {
    const model = this.profile.modelMap.tts
    const voiceId = voice?.trim() || this.profile.modelMap.voice
    if (model === undefined || model.trim() === '') {
      throw new ProviderError(ErrorCodes.ProviderNotConfigured, `方案 '${this.profile.id}' 未配置 ElevenLabs 语音模型`)
    }
    if (voiceId === undefined || voiceId.trim() === '') {
      throw new ProviderError(ErrorCodes.ProviderNotConfigured, `方案 '${this.profile.id}' 未配置 ElevenLabs voice ID`)
    }
    const response = await this.request(`/text-to-speech/${encodeURIComponent(voiceId.trim())}`, {
      method: 'POST',
      body: {
        text,
        model_id: model,
        ...(this.profile.modelMap.voiceSettings === undefined ? {} : {
          voice_settings: {
            ...(this.profile.modelMap.voiceSettings.stability === undefined ? {} : { stability: this.profile.modelMap.voiceSettings.stability }),
            ...(this.profile.modelMap.voiceSettings.similarityBoost === undefined ? {} : { similarity_boost: this.profile.modelMap.voiceSettings.similarityBoost }),
            ...(this.profile.modelMap.voiceSettings.speed === undefined ? {} : { speed: this.profile.modelMap.voiceSettings.speed }),
          },
        }),
      },
    })
    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg',
      model,
    }
  }

  async *streamChat(_messages: LlmChatMessage[], _opts: StreamChatOptions = {}): AsyncIterable<LlmStreamChunk> {
    throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'ElevenLabs 连接只支持语音能力，不能作为聊天 Provider')
  }

  async transcribe(_data: Uint8Array, _mimeType: string, _fileName = 'voice.webm'): Promise<{ text: string; model: string }> {
    throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'ElevenLabs 原生连接未提供语音转写能力，请为转写单独绑定 OpenAI-compatible Provider')
  }

  async vision(_dataUrl: string, _prompt?: string): Promise<{ description: string; model: string }> {
    throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'ElevenLabs 连接只支持语音能力，不能用于识图')
  }

  async generate(_prompt: string): Promise<{ dataUrl: string; model: string }> {
    throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'ElevenLabs 连接只支持语音能力，不能用于生图')
  }

  private endpoint(path: string): string {
    const base = this.profile.baseUrl.replace(/\/+$/, '')
    return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`
  }

  private async request(path: string, opts: {
    method?: 'GET' | 'POST'
    body?: unknown
    signal?: AbortSignal
    timeoutMs?: number
  } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      accept: opts.method === 'POST' ? 'audio/mpeg, application/json' : 'application/json',
      ...(this.profile.headers ?? {}),
    }
    if (this.key !== null && this.key !== '') {
      headers['xi-api-key'] = this.key
    } else {
      throw new ProviderError(ErrorCodes.ProviderNotConfigured, `方案 '${this.profile.id}' 未配置 ElevenLabs API Key`)
    }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? HEADER_TIMEOUT_MS)
    const signal = opts.signal === undefined ? controller.signal : AbortSignal.any([opts.signal, controller.signal])
    let response: Response
    try {
      response = await fetch(this.endpoint(path), {
        method: opts.method ?? 'GET',
        headers,
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal,
      })
    } catch (error) {
      throw new ProviderError(
        ErrorCodes.ProviderUpstreamError,
        controller.signal.aborted ? `连接 '${this.profile.id}' 超过 ${opts.timeoutMs ?? HEADER_TIMEOUT_MS}ms 未响应` : `连接 '${this.profile.id}' 失败`,
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new ProviderError(
        response.status === 401 || response.status === 403 ? ErrorCodes.ProviderUnauthorized : ErrorCodes.ProviderUpstreamError,
        `ElevenLabs 上游返回 ${response.status}（方案 '${this.profile.id}'）`,
        await responseSnippet(response),
      )
    }
    return response
  }
}
