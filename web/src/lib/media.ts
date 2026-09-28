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
  const res = await fetch('/api/media/speech/stream', {
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
  // Keep the transport streaming even though the browser starts playback after
  // a complete decodable Blob is available. This lets the server forward
  // provider chunks immediately without pretending that a Blob is progressive
  // playback; call mode can therefore show an honest “receiving audio” state.
  if (res.body === null) return res.blob()
  const reader = res.body.getReader()
  const chunks: ArrayBuffer[] = []
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (next.value !== undefined && next.value.byteLength > 0) {
        // Copy into a plain ArrayBuffer: TS 5.7's BlobPart excludes
        // SharedArrayBuffer-backed Uint8Array values from ReadableStream.
        const bytes = new Uint8Array(next.value.byteLength)
        bytes.set(next.value)
        chunks.push(bytes.buffer)
      }
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(chunks, { type: res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg' })
}
