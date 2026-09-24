import type { MediaImageResult, MediaTranscriptionResult, MediaVisionResult } from '@shared/types'
import { ApiRequestError, assertOnline, fetchJson } from './api'
import { ErrorCodes, type ApiError } from '@shared/errors'

export function transcribeAudio(dataUrl: string): Promise<MediaTranscriptionResult> {
  return fetchJson('/api/media/transcriptions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl }),
  })
}

export function describeImage(dataUrl: string): Promise<MediaVisionResult> {
  return fetchJson('/api/media/vision', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl }),
  })
}

export function generateImage(prompt: string): Promise<MediaImageResult> {
  return fetchJson('/api/media/images', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }),
  })
}

export async function synthesizeSpeech(text: string): Promise<Blob> {
  assertOnline()
  const res = await fetch('/api/media/speech', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    let body: Partial<ApiError> | null = null
    try { body = await res.json() as Partial<ApiError> } catch { /* non-JSON upstream error */ }
    throw new ApiRequestError(
      body?.error?.code ?? ErrorCodes.UpstreamError,
      body?.error?.message ?? `朗读请求失败：HTTP ${res.status}`,
      body?.error?.detail,
    )
  }
  return res.blob()
}
