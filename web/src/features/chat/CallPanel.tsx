import { useEffect, useRef, useState } from 'react'
import { IconClose, IconMic, IconStop } from '../../components/qixi/Icons'
import { formatDuration } from '../../lib/format'
import { log } from '../../lib/log'
import { synthesizeSpeech } from '../../lib/media'

const MAX_CALL_TURN_MS = 60_000
const MIN_CALL_TURN_MS = 400
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

type CallStatus = 'idle' | 'recording' | 'processing' | 'playing' | 'error'

export interface CallPanelProps {
  open: boolean
  disabled: boolean
  onClose: () => void
  /** 落库并生成一轮回复；返回正文供通话模式朗读。 */
  onTurn: (dataUrl: string, durationMs: number) => Promise<string>
  onError: (text: string) => void
}

/**
 * 聊天内的通话模式：明确的按轮录音 → 服务端转写 / 生成 → 服务端 TTS → 播放。
 *
 * 这是可取消边界清晰的 in-app call，不伪装成 WebSocket 全双工或手机来电。
 * 每一轮都作为普通语音消息落在当前会话里，用户随时可以挂断。
 */
export function CallPanel({ open, disabled, onClose, onTurn, onError }: CallPanelProps) {
  const [status, setStatus] = useState<CallStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorText, setErrorText] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number | null>(null)
  const discardRef = useRef(false)
  const closedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const audioRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null)

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
    if (current === null) return
    current.audio.pause()
    URL.revokeObjectURL(current.url)
    audioRef.current = null
    setStatus('idle')
  }

  useEffect(() => () => {
    releaseRecorder()
    stopPlayback()
  }, [])

  useEffect(() => {
    if (!open) return
    closedRef.current = false
    setErrorText(null)
    setStatus('idle')
  }, [open])

  useEffect(() => {
    if (!open && status === 'recording') {
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
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (audioRef.current?.url === url) audioRef.current = null
      setStatus('idle')
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      if (audioRef.current?.url === url) audioRef.current = null
      fail('通话回复播放失败，请重试')
    }
    setStatus('playing')
    await audio.play()
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
        .then((reply) => playReply(reply))
        .catch((error: unknown) => {
          log.error('通话这一轮失败', error)
          fail(error instanceof Error ? error.message : String(error))
        })
    }
    reader.onerror = () => fail('录音读取失败，请再试一次')
    reader.readAsDataURL(blob)
  }

  async function startRecording(): Promise<void> {
    if (disabled || status === 'recording' || status === 'processing' || status === 'playing') return
    const media = navigator.mediaDevices
    if (media === undefined || typeof media.getUserMedia !== 'function') {
      fail('当前环境不支持通话录音：需要 https / localhost 且浏览器提供录音能力')
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
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== 'inactive') recorder.stop()
    else releaseRecorder()
    stopPlayback()
    onClose()
  }

  if (!open) return null

  const statusText = status === 'recording'
    ? `正在听你说话 · ${formatDuration(elapsedMs)}`
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
          {errorText !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{errorText}</p>}
        </div>

        <div className="flex items-center justify-center gap-2">
          {status === 'recording' ? (
            <button type="button" className="btn-pill btn-danger" data-testid="call-stop-recording" onClick={stopRecording}>
              <IconStop size={16} />
              结束这一轮
            </button>
          ) : status === 'playing' ? (
            <button type="button" className="btn-pill btn-ghost" data-testid="call-stop-playback" onClick={stopPlayback}>停止播放</button>
          ) : (
            <button type="button" className="btn-pill btn-strong" data-testid="call-start-recording" disabled={disabled || status === 'processing'} onClick={() => void startRecording()}>
              <IconMic size={16} />
              {status === 'processing' ? '处理中…' : '开始说话'}
            </button>
          )}
          <button type="button" className="btn-pill btn-ghost" data-testid="call-hangup" onClick={close}>结束通话</button>
        </div>
      </section>
    </div>
  )
}
