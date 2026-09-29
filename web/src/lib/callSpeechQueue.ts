import { synthesizeSpeech } from './media'

export type CallSpeechState = 'idle' | 'loading' | 'playing' | 'interrupted' | 'error'

export interface CallSpeechQueueOptions {
  onState?: (state: CallSpeechState, text?: string) => void
}

/** Keep punctuation with each sentence so the first audio can start early. */
export function splitSpeechSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized === '') return []
  const pieces = normalized.match(/[^。！？!?；;….]+[。！？!?；;….]+|[^。！？!?；;….]+$/gu) ?? [normalized]
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== '')
}

function extractCompleteSentences(text: string): { sentences: string[]; remainder: string } {
  const matches = [...text.matchAll(/[。！？!?；;….]+/gu)]
  const last = matches.at(-1)
  if (last === undefined || last.index === undefined) return { sentences: [], remainder: text }
  const boundary = last.index + last[0].length
  return { sentences: splitSpeechSentences(text.slice(0, boundary)), remainder: text.slice(boundary) }
}

/**
 * Sentence-level TTS.  It intentionally uses the existing server TTS
 * contract, but starts playing sentence 1 before sentence 2 is synthesized.
 * `stop()` is an explicit barge-in boundary: it aborts fetch, pauses audio and
 * invalidates every late promise from the previous reply.
 */
export class CallSpeechQueue {
  private generation = 0
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private controller: AbortController | null = null
  private playbackResolve: (() => void) | null = null
  private outputDeviceId: string | null = null
  private options: CallSpeechQueueOptions
  private streamBuffer = ''
  private streamQueue: string[] = []
  private streamActive = false
  private streamDone = false
  private streamWake: (() => void) | null = null
  private streamResolve: ((result: 'completed' | 'interrupted') => void) | null = null
  private streamReject: ((error: unknown) => void) | null = null
  private streamPumpRunning = false

  constructor(options: CallSpeechQueueOptions = {}) {
    this.options = options
  }

  async play(text: string): Promise<'completed' | 'interrupted'> {
    this.startStreaming()
    this.append(text)
    return this.finishStreaming()
  }

  /** Start feeding model deltas before the full reply is available. */
  startStreaming(): void {
    this.stop(false)
    const generation = ++this.generation
    this.streamBuffer = ''
    this.streamQueue = []
    this.streamActive = true
    this.streamDone = false
    this.streamResolve = null
    this.streamReject = null
    void this.ensureStreamingPump(generation)
  }

  append(text: string): void {
    if (!this.streamActive || text === '') return
    this.streamBuffer += text
    const extracted = extractCompleteSentences(this.streamBuffer)
    this.streamBuffer = extracted.remainder
    this.streamQueue.push(...extracted.sentences)
    this.streamWake?.()
    this.streamWake = null
  }

  finishStreaming(): Promise<'completed' | 'interrupted'> {
    if (!this.streamActive) return Promise.resolve('interrupted')
    const result = new Promise<'completed' | 'interrupted'>((resolve, reject) => { this.streamResolve = resolve; this.streamReject = reject })
    if (this.streamBuffer.trim() !== '') this.streamQueue.push(this.streamBuffer.trim())
    this.streamBuffer = ''
    this.streamDone = true
    this.streamWake?.()
    this.streamWake = null
    void this.ensureStreamingPump(this.generation)
    return result
  }

  private async ensureStreamingPump(generation: number): Promise<void> {
    if (this.streamPumpRunning) return
    this.streamPumpRunning = true
    try {
      for (;;) {
        if (generation !== this.generation) { this.resolveStream('interrupted'); return }
        const sentence = this.streamQueue.shift()
        if (sentence === undefined) {
          if (this.streamDone) { this.resolveStream('completed'); return }
          await new Promise<void>((resolve) => { this.streamWake = resolve })
          continue
        }
        this.options.onState?.('loading', sentence)
        this.controller = new AbortController()
        const blob = await synthesizeSpeech(sentence, { signal: this.controller.signal })
        this.controller = null
        if (generation !== this.generation) { this.resolveStream('interrupted'); return }
        await this.playBlob(blob, generation, sentence)
      }
    } catch (error) {
      this.controller = null
      if (generation !== this.generation || isAbortError(error)) { this.resolveStream('interrupted'); return }
      this.options.onState?.('error')
      this.rejectStream(error)
    } finally {
      if (generation === this.generation) this.cleanupAudio()
      this.streamPumpRunning = false
    }
  }

  stop(notify = true): void {
    this.generation += 1
    this.streamActive = false
    this.streamDone = true
    this.streamWake?.()
    this.streamWake = null
    this.resolveStream('interrupted')
    this.controller?.abort()
    this.controller = null
    this.cleanupAudio()
    if (notify) this.options.onState?.('interrupted')
  }

  private resolveStream(result: 'completed' | 'interrupted'): void {
    const resolve = this.streamResolve
    this.streamResolve = null
    this.streamReject = null
    this.streamActive = false
    resolve?.(result)
  }

  private rejectStream(error: unknown): void {
    const reject = this.streamReject
    this.streamResolve = null
    this.streamReject = null
    this.streamActive = false
    reject?.(error)
  }

  setVolume(volume: number): void {
    if (this.audio !== null) this.audio.volume = Math.max(0, Math.min(1, volume))
  }

  async setOutputDevice(deviceId: string): Promise<boolean> {
    this.outputDeviceId = deviceId === '' ? null : deviceId
    const audio = this.audio
    if (audio === null) return true
    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (typeof sinkAudio.setSinkId !== 'function') return false
    await sinkAudio.setSinkId(deviceId)
    return true
  }

  private async playBlob(blob: Blob, generation: number, sentence: string): Promise<void> {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    this.audio = audio
    this.objectUrl = url
    if (this.outputDeviceId !== null) {
      const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (typeof sinkAudio.setSinkId === 'function') await sinkAudio.setSinkId(this.outputDeviceId)
    }
    this.options.onState?.('playing', sentence)
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        callback()
      }
      this.playbackResolve = () => settle(resolve)
      audio.onended = () => settle(resolve)
      audio.onerror = () => settle(() => reject(new Error('通话回复播放失败，请重试')))
      void audio.play().catch((error: unknown) => settle(() => reject(error)))
      if (generation !== this.generation) settle(resolve)
    })
    if (generation !== this.generation) return
    this.cleanupAudio()
  }

  private cleanupAudio(): void {
    if (this.audio !== null) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.src = ''
      this.audio = null
    }
    this.playbackResolve?.()
    this.playbackResolve = null
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
