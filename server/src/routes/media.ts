import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type { ApiProfilePublic, MediaImageResult, MediaTranscriptionResult, MediaVisionResult, ProviderCapability } from '@shared/types'
import { recordUsage } from '../db/usage.js'
import { ProviderError } from '../providers/errors.js'
import type { LlmRegistry } from '../providers/registry.js'
import type { OpenAICompatProvider } from '../providers/openai-compat.js'
import type { ElevenLabsProvider } from '../providers/elevenlabs.js'

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_SPEECH_CHARS = 4_000
const MAX_PROMPT_CHARS = 2_000
const AUDIO_MIMES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg'])
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new ProviderError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ProviderError(ErrorCodes.BadRequest, `${name} 必填`)
  const result = value.trim()
  if (result.length > max) throw new ProviderError(ErrorCodes.BadRequest, `${name} 最长 ${max} 字`)
  return result
}

type MediaProvider = OpenAICompatProvider | ElevenLabsProvider

function active(registry: LlmRegistry, capability: ProviderCapability, profileId: unknown): { profile: ApiProfilePublic; provider: MediaProvider } {
  if (typeof profileId === 'string' && profileId !== '') {
    const profile = registry.toPublic(registry.require(profileId))
    return { profile, provider: registry.mediaProvider(profile.id) }
  }
  const resolved = registry.capabilityProvider(capability)
  if (resolved === null) throw new ProviderError(ErrorCodes.ProviderNotConfigured, `没有可用的${capability} API 绑定`)
  if (!('transcribe' in resolved.provider)) {
    throw new ProviderError(ErrorCodes.ProviderNotConfigured, 'Codex Subscription 仅支持聊天能力，请为媒体能力绑定其它 Provider')
  }
  return { ...resolved, provider: resolved.provider as OpenAICompatProvider | ElevenLabsProvider }
}

function parseDataUrl(value: unknown, allowed: ReadonlySet<string>, maxBytes: number, label: string): { data: Uint8Array; mimeType: string } {
  if (typeof value !== 'string') throw new ProviderError(ErrorCodes.BadRequest, 'dataUrl 必填')
  // MediaRecorder 会产出 `audio/webm;codecs=opus`；参数属于 MIME，不应被误判成非法 data URL。
  const match = /^data:([^;,]+)(?:;[^,;]+)*;base64,([A-Za-z0-9+/=]+)$/.exec(value)
  const mimeType = match?.[1]?.toLowerCase()
  if (match === null || mimeType === undefined || !allowed.has(mimeType)) {
    throw new ProviderError(ErrorCodes.BadRequest, `不支持的${label}格式`)
  }
  const data = Buffer.from(match[2] ?? '', 'base64')
  if (data.byteLength === 0 || data.byteLength > maxBytes) {
    throw new ProviderError(ErrorCodes.BadRequest, `文件必须在 1 B–${Math.floor(maxBytes / 1024 / 1024)} MB 之间`)
  }
  return { data, mimeType }
}

export function registerMediaRoutes(app: FastifyInstance, registry: LlmRegistry): void {
  app.post('/api/media/transcriptions', async (request): Promise<MediaTranscriptionResult> => {
    const body = record(request.body)
    const { profile, provider } = active(registry, 'voice', body.profileId)
    const parsed = parseDataUrl(body.dataUrl, AUDIO_MIMES, MAX_AUDIO_BYTES, '音频')
    const result = await provider.transcribe(parsed.data, parsed.mimeType)
    recordUsage({ profileId: profile.id, service: 'transcription', model: result.model })
    return result
  })

  app.post('/api/media/vision', async (request): Promise<MediaVisionResult> => {
    const body = record(request.body)
    const { profile, provider } = active(registry, 'vision', body.profileId)
    parseDataUrl(body.dataUrl, IMAGE_MIMES, MAX_IMAGE_BYTES, '图片')
    const result = await provider.vision(body.dataUrl as string, typeof body.prompt === 'string' ? body.prompt : undefined)
    recordUsage({ profileId: profile.id, service: 'vision', model: result.model })
    return result
  })

  app.post('/api/media/images', async (request): Promise<MediaImageResult> => {
    const body = record(request.body)
    const { profile, provider } = active(registry, 'image', body.profileId)
    const result = await provider.generate(text(body.prompt, 'prompt', MAX_PROMPT_CHARS))
    parseDataUrl(result.dataUrl, IMAGE_MIMES, MAX_IMAGE_BYTES, '图片')
    recordUsage({ profileId: profile.id, service: 'image', model: result.model })
    return result
  })

  app.post('/api/media/speech', async (request, reply): Promise<void> => {
    const body = record(request.body)
    const { profile, provider } = active(registry, 'voice', body.profileId)
    const result = await provider.synthesize(
      text(body.text, 'text', MAX_SPEECH_CHARS),
      typeof body.voice === 'string' && body.voice.trim() !== '' ? body.voice.trim() : undefined,
    )
    recordUsage({ profileId: profile.id, service: 'tts', model: result.model })
    reply.header('content-type', result.mimeType).header('cache-control', 'no-store').send(Buffer.from(result.audio))
  })

  app.post('/api/media/speech/stream', async (request, reply): Promise<void> => {
    const body = record(request.body)
    const { profile, provider } = active(registry, 'voice', body.profileId)
    const speechText = text(body.text, 'text', MAX_SPEECH_CHARS)
    const voice = typeof body.voice === 'string' && body.voice.trim() !== '' ? body.voice.trim() : undefined
    if (!('streamSynthesize' in provider)) {
      const result = await provider.synthesize(speechText, voice)
      recordUsage({ profileId: profile.id, service: 'tts', model: result.model })
      reply.header('content-type', result.mimeType).header('cache-control', 'no-store').header('x-habitat-tts-mode', 'fallback').send(Buffer.from(result.audio))
      return
    }

    const result = await provider.streamSynthesize(speechText, voice)
    reply.hijack()
    const response = reply.raw
    response.writeHead(200, {
      'content-type': result.mimeType,
      'cache-control': 'no-store, no-transform',
      'x-habitat-tts-mode': 'native-stream',
      'x-accel-buffering': 'no',
    })
    try {
      for await (const chunk of result.stream) {
        if (!response.write(chunk)) await new Promise<void>((resolve) => response.once('drain', resolve))
      }
      recordUsage({ profileId: profile.id, service: 'tts', model: result.model })
      response.end()
    } catch (error) {
      request.log.warn({ error, profileId: profile.id }, '流式 TTS 在音频中途失败')
      response.destroy(error instanceof Error ? error : undefined)
    }
  })
}
