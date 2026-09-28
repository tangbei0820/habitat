import { useEffect, useRef, useState } from 'react'
import { IconClose, IconMic, IconStop } from '../../components/qixi/Icons'
import { formatDuration } from '../../lib/format'
import { log } from '../../lib/log'
import { synthesizeSpeech } from '../../lib/media'
import { appendCallTurn, answerCall, createCall, hangupCall, loadCall, subscribeCallEvents } from '../../lib/calls'
import type { CallEvent } from '@shared/types'

const MAX_CALL_TURN_MS = 60_000
const MIN_CALL_TURN_MS = 400
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

type CallStatus = 'idle' | 'listening' | 'recording' | 'processing' | 'playing' | 'error'

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null
}

export interface CallPanelProps {
  open: boolean
  disabled: boolean
  chatSessionId: string
  incomingCallId?: string | null
  onClose: () => void
  /** 落库并生成一轮回复；返回正文供通话模式朗读。 */
  onTurn: (dataUrl: string, durationMs: number) => Promise<{ reply: string; transcript: string }>
  /** 浏览器原生连续识别的最终句子；与普通聊天共用同一会话。 */
  onTurnText: (text: string) => Promise<string>
  onError: (text: string) => void
}

/**
 * 聊天内的通话模式：明确的按轮录音 → 服务端转写 / 生成 → 服务端 TTS → 播放。
 *
 * 这是可取消边界清晰的 in-app call，不伪装成 WebSocket 全双工或手机来电。
 * 每一轮都作为普通语音消息落在当前会话里，用户随时可以挂断。
 */
export function CallPanel({ open, disabled, chatSessionId, incomingCallId = null, onClose, onTurn, onTurnText, onError }: CallPanelProps) {
  const [status, setStatus] = useState<CallStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [interimText, setInterimText] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number | null>(null)
  const callStartedAtRef = useRef<number | null>(null)
  const discardRef = useRef(false)
  const closedRef = useRef(false)
  const nativeRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const nativeActiveRef = useRef(false)
  const nativeProcessingRef = useRef(false)
  const callTimerRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const audioRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null)
  const playbackResolveRef = useRef<(() => void) | null>(null)
  const callIdRef = useRef<string | null>(null)
  const callUnsubscribeRef = useRef<(() => void) | null>(null)

  function clearCallTimer(): void {
    if (callTimerRef.current !== null) {
      window.clearInterval(callTimerRef.current)
      callTimerRef.current = null
    }
    callStartedAtRef.current = null
    setElapsedMs(0)
  }

  function stopNativeCall(): void {
    nativeActiveRef.current = false
    nativeProcessingRef.current = false
    const recognition = nativeRecognitionRef.current
    nativeRecognitionRef.current = null
    if (recognition !== null) {
      recognition.onend = null
      try { recognition.stop() } catch { /* 已经停止 */ }
    }
    setInterimText('')
    clearCallTimer()
  }

  async function ensureServerCall(): Promise<string> {
    if (callIdRef.current !== null) return callIdRef.current
    let call = incomingCallId === null
      ? await createCall(chatSessionId)
      : (await loadCall(incomingCallId)).call
    if (call.status === 'ringing') call = await answerCall(call.id)
    callIdRef.current = call.id
    callUnsubscribeRef.current?.()
    callUnsubscribeRef.current = subscribeCallEvents(call.id, (event: CallEvent) => {
      if (event.type !== 'state' || event.call.id !== call.id) return
      if (event.call.status === 'ended' || event.call.status === 'rejected' || event.call.status === 'missed' || event.call.status === 'cancelled') {
        nativeActiveRef.current = false
        setStatus('idle')
        setErrorText('通话已结束')
      }
    })
    return call.id
  }

  function recordTurn(speaker: 'user' | 'companion', text: string): void {
    const activeCallId = callIdRef.current
    if (activeCallId === null || text.trim() === '') return
    void appendCallTurn(activeCallId, speaker, text.trim()).catch((error: unknown) => log.warn('通话逐句记录失败', error))
  }

  function endServerCall(): void {
    const activeCallId = callIdRef.current
    callIdRef.current = null
    callUnsubscribeRef.current?.()
    callUnsubscribeRef.current = null
    if (activeCallId !== null) void hangupCall(activeCallId).catch((error: unknown) => log.warn('结束通话记录失败', error))
  }

  function resumeNativeListening(): void {
    if (!nativeActiveRef.current || closedRef.current || nativeProcessingRef.current) return
    const recognition = nativeRecognitionRef.current
    if (recognition === null) return
    try {
      recognition.start()
      setStatus('listening')
    } catch (error) {
      // Chrome 在上一次 stop 的 onend 尚未到达时会短暂抛 InvalidStateError；
      // 让 onend 再尝试一次，不把这个正常竞态显示成失败。
      if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
        log.warn('恢复连续语音识别失败', error)
        fail('连续语音识别已停止，请重新开始通话')
      }
    }
  }

  function releaseRecorder(): void {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    startedAtRef.current = null
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function stopPlayback(): void {
    const current = audioRef.current
    if (current !== null) {
      current.audio.pause()
      URL.revokeObjectURL(current.url)
      audioRef.current = null
    }
    playbackResolveRef.current?.()
    playbackResolveRef.current = null
    if (nativeActiveRef.current && !closedRef.current) {
      nativeProcessingRef.current = false
      resumeNativeListening()
    } else setStatus('idle')
  }

  useEffect(() => () => {
    stopNativeCall()
    releaseRecorder()
    stopPlayback()
    endServerCall()
    callUnsubscribeRef.current?.()
    callUnsubscribeRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return
    closedRef.current = false
    setErrorText(null)
    setInterimText('')
    setStatus('idle')
  }, [open])

  useEffect(() => {
    if (!open && (status === 'recording' || status === 'listening')) {
      stopNativeCall()
      const recorder = recorderRef.current
      if (recorder !== null && recorder.state !== 'inactive') recorder.stop()
    }
  }, [open, status])

  function fail(message: string): void {
    setErrorText(message)
    setStatus('error')
    onError(message)
  }

  async function playReply(text: string): Promise<void> {
    if (closedRef.current) return
    const normalized = text.trim()
    if (normalized === '') {
      setStatus('idle')
      return
    }
    setStatus('processing')
    const blob = await synthesizeSpeech(normalized)
    if (closedRef.current) return
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = { audio, url }
    const playbackDone = new Promise<void>((resolve) => { playbackResolveRef.current = resolve })
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (audioRef.current?.url === url) audioRef.current = null
      playbackResolveRef.current?.()
      playbackResolveRef.current = null
      setStatus('idle')
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      if (audioRef.current?.url === url) audioRef.current = null
      playbackResolveRef.current?.()
      playbackResolveRef.current = null
      nativeActiveRef.current = false
      nativeProcessingRef.current = false
      clearCallTimer()
      fail('通话回复播放失败，请重试')
    }
    setStatus('playing')
    try {
      await audio.play()
    } catch (error) {
      URL.revokeObjectURL(url)
      if (audioRef.current?.url === url) audioRef.current = null
      playbackResolveRef.current?.()
      playbackResolveRef.current = null
      throw error
    }
    await playbackDone
  }

  function finishRecording(mimeType: string): void {
    const chunks = chunksRef.current
    chunksRef.current = []
    const discarded = discardRef.current
    discardRef.current = false
    const startedAt = startedAtRef.current
    const durationMs = startedAt === null ? 0 : Date.now() - startedAt
    releaseRecorder()
    setElapsedMs(0)
    if (discarded || closedRef.current) return
    if (chunks.length === 0) {
      fail('没有采到声音，请再试一次')
      return
    }
    if (durationMs < MIN_CALL_TURN_MS) {
      fail('这一轮太短了，请至少说半秒')
      return
    }
    const blob = new Blob(chunks, { type: mimeType })
    const reader = new FileReader()
    reader.onload = () => {
      if (closedRef.current) return
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (dataUrl === '') {
        fail('录音读取失败，请再试一次')
        return
      }
      setErrorText(null)
      setStatus('processing')
      void onTurn(dataUrl, durationMs)
        .then(({ reply, transcript }) => {
          recordTurn('user', transcript)
          recordTurn('companion', reply)
          return playReply(reply)
        })
        .catch((error: unknown) => {
          log.error('通话这一轮失败', error)
          fail(error instanceof Error ? error.message : String(error))
        })
    }
    reader.onerror = () => fail('录音读取失败，请再试一次')
    reader.readAsDataURL(blob)
  }

  async function handleNativeTurn(text: string): Promise<void> {
    const normalized = text.trim()
    if (normalized === '' || nativeProcessingRef.current || closedRef.current) return
    nativeProcessingRef.current = true
    setInterimText('')
    setStatus('processing')
    recordTurn('user', normalized)
    try {
      const reply = await onTurnText(normalized)
      recordTurn('companion', reply)
      if (!closedRef.current && reply.trim() !== '') {
        await playReply(reply)
      }
      if (!closedRef.current) {
        nativeProcessingRef.current = false
        resumeNativeListening()
      }
    } catch (error) {
      nativeActiveRef.current = false
      nativeProcessingRef.current = false
      clearCallTimer()
      log.error('连续通话这一轮失败', error)
      fail(error instanceof Error ? error.message : String(error))
    }
  }

  async function startNativeCall(): Promise<void> {
    if (disabled) return
    try {
      await ensureServerCall()
    } catch (error) {
      fail(`无法接通通话：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const Constructor = getSpeechRecognitionConstructor()
    if (Constructor === null) {
      await startRecording()
      return
    }
    closedRef.current = false
    nativeActiveRef.current = true
    nativeProcessingRef.current = false
    setErrorText(null)
    setInterimText('')
    callStartedAtRef.current = Date.now()
    setElapsedMs(0)
    callTimerRef.current = window.setInterval(() => {
      const startedAt = callStartedAtRef.current
      setElapsedMs(startedAt === null ? 0 : Date.now() - startedAt)
    }, 250)

    const recognition = nativeRecognitionRef.current ?? new Constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'zh-CN'
    recognition.onresult = (event) => {
      let interim = ''
      let finalText = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) finalText += result[0]?.transcript ?? ''
        else interim += result[0]?.transcript ?? ''
      }
      setInterimText(interim.trim())
      if (finalText.trim() !== '') {
        // 停止识别但保留 active 标记：回复播放结束后会重新 start，形成真正的轮流说话。
        try { recognition.stop() } catch { /* 已经停止 */ }
        void handleNativeTurn(finalText)
      }
    }
    recognition.onend = () => {
      if (nativeActiveRef.current && !nativeProcessingRef.current && !closedRef.current) resumeNativeListening()
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      nativeActiveRef.current = false
      clearCallTimer()
      fail(`连续语音识别失败：${event.error}`)
    }
    nativeRecognitionRef.current = recognition
    try {
      recognition.start()
      setStatus('listening')
    } catch (error) {
      nativeActiveRef.current = false
      clearCallTimer()
      log.error('开始连续语音识别失败', error)
      fail(`无法开始通话：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function stopListeningOnly(): void {
    nativeActiveRef.current = false
    nativeProcessingRef.current = false
    const recognition = nativeRecognitionRef.current
    nativeRecognitionRef.current = null
    if (recognition !== null) {
      recognition.onend = null
      try { recognition.stop() } catch { /* 已经停止 */ }
    }
    setInterimText('')
    clearCallTimer()
    setStatus('idle')
  }

  async function startRecording(): Promise<void> {
    if (disabled || status === 'recording' || status === 'processing' || status === 'playing') return
    const media = navigator.mediaDevices
    if (media === undefined || typeof media.getUserMedia !== 'function') {
      fail('当前环境不支持通话录音：需要 https / localhost 且浏览器提供录音能力')
      return
    }
    try { await ensureServerCall() } catch (error) {
      fail(`无法接通通话：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    try {
      stopPlayback()
      discardRef.current = false
      const stream = await media.getUserMedia({ audio: true })
      if (closedRef.current || !open) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => finishRecording(recorder.mimeType)
      recorderRef.current = recorder
      streamRef.current = stream
      recorder.start(500)
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      setErrorText(null)
      setStatus('recording')
      timerRef.current = window.setInterval(() => {
        const startedAt = startedAtRef.current
        const next = startedAt === null ? 0 : Date.now() - startedAt
        setElapsedMs(next)
        if (next >= MAX_CALL_TURN_MS) stopRecording()
      }, 250)
    } catch (error) {
      releaseRecorder()
      // 已经创建的服务端会话不能悬空；麦克风权限 / 设备失败时立即结束它。
      endServerCall()
      log.error('开始通话录音失败', error)
      fail(`无法开始通话：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function stopRecording(): void {
    const recorder = recorderRef.current
    if (recorder === null || recorder.state === 'inactive') return
    recorder.stop()
  }

  function close(): void {
    closedRef.current = true
    discardRef.current = true
    stopNativeCall()
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== 'inactive') recorder.stop()
    else releaseRecorder()
    stopPlayback()
    endServerCall()
    onClose()
  }

  if (!open) return null

  const statusText = status === 'recording'
    ? `正在听你说话 · ${formatDuration(elapsedMs)}`
    : status === 'listening'
      ? `通话中 · 正在听你说话 · ${formatDuration(elapsedMs)}`
    : status === 'processing'
      ? '正在转写并等小栖回复…'
      : status === 'playing'
        ? '正在播放小栖的回复'
        : status === 'error'
          ? '这一轮没有完成'
          : '点击麦克风开始一轮对话'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25 p-3 sm:items-center" data-testid="call-panel">
      <section className="card w-full max-w-md space-y-4" aria-label="通话模式">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">通话模式</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              每轮按住说话，回复会自动朗读；语音和转写会保留在当前聊天中。
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="结束通话" data-testid="call-close" onClick={close}>
            <IconClose size={18} />
          </button>
        </div>

        <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--bg-subtle)' }}>
          <div className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full ${status === 'recording' ? 'is-recording' : ''}`} style={{ background: 'var(--bg-surface-solid)', color: 'var(--accent-strong)' }}>
            {status === 'recording' ? <IconMic size={28} filled /> : <IconMic size={28} />}
          </div>
          <p className="text-sm" data-testid="call-status">{statusText}</p>
          {interimText !== '' && (
            <p className="mt-2 text-xs italic" style={{ color: 'var(--text-secondary)' }} data-testid="call-interim">
              {interimText}
            </p>
          )}
          {errorText !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{errorText}</p>}
        </div>

        <div className="flex items-center justify-center gap-2">
          {status === 'recording' ? (
            <button type="button" className="btn-pill btn-danger" data-testid="call-stop-recording" onClick={stopRecording}>
              <IconStop size={16} />
              结束这一轮
            </button>
          ) : status === 'listening' ? (
            <button type="button" className="btn-pill btn-danger" data-testid="call-stop-listening" onClick={stopListeningOnly}>
              <IconStop size={16} />
              停止听取
            </button>
          ) : status === 'playing' ? (
            <button type="button" className="btn-pill btn-ghost" data-testid="call-stop-playback" onClick={stopPlayback}>停止播放</button>
          ) : (
            <button type="button" className="btn-pill btn-strong" data-testid="call-start-recording" disabled={disabled || status === 'processing'} onClick={startNativeCall}>
              <IconMic size={16} />
              {status === 'processing' ? '处理中…' : incomingCallId !== null ? '接听来电' : '开始通话'}
            </button>
          )}
          <button type="button" className="btn-pill btn-ghost" data-testid="call-hangup" onClick={close}>结束通话</button>
        </div>
      </section>
    </div>
  )
}
