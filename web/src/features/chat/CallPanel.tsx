import { useEffect, useRef, useState } from 'react'
import { IconClose, IconMic, IconStop } from '../../components/qixi/Icons'
import { formatDuration } from '../../lib/format'
import { log } from '../../lib/log'
import { appendCallTurn, answerCall, createCall, hangupCall, loadCall, subscribeCallEvents, type CallEventConnection } from '../../lib/calls'
import { CallSpeechQueue } from '../../lib/callSpeechQueue'
import { callStateLabel, reduceCallState, type CallClientState } from '../../lib/callState'
import type { CallEvent } from '@shared/types'

const MAX_CALL_TURN_MS = 60_000
const MIN_CALL_TURN_MS = 400
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

interface SpeechRecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechRecognitionEventLike extends Event { resultIndex: number; results: { length: number; [index: number]: SpeechRecognitionResultLike } }
interface SpeechRecognitionErrorEventLike extends Event { error: string }
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
  const browserWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null
}

export interface CallPanelProps {
  open: boolean
  disabled: boolean
  chatSessionId: string
  incomingCallId?: string | null
  onClose: () => void
  onTurn: (dataUrl: string, durationMs: number, onReplyChunk?: (text: string) => void) => Promise<{ reply: string; transcript: string }>
  onTurnText: (text: string, onReplyChunk?: (text: string) => void) => Promise<string>
  onError: (text: string) => void
}

/** Application-local call surface with an explicit FSM and cancellable TTS. */
export function CallPanel({ open, disabled, chatSessionId, incomingCallId = null, onClose, onTurn, onTurnText, onError }: CallPanelProps) {
  const [clientState, setClientState] = useState<CallClientState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [interimText, setInterimText] = useState('')
  const [muted, setMuted] = useState(false)
  const [speakerEnabled, setSpeakerEnabled] = useState(true)
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [inputDeviceId, setInputDeviceId] = useState('')
  const [outputDeviceId, setOutputDeviceId] = useState('')
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
  const callIdRef = useRef<string | null>(null)
  const callUnsubscribeRef = useRef<(() => void) | null>(null)
  const turnWriteChainRef = useRef(Promise.resolve())
  const speakerEnabledRef = useRef(speakerEnabled)
  const inputDeviceIdRef = useRef(inputDeviceId)
  const speechQueueRef = useRef<CallSpeechQueue | null>(null)

  if (speechQueueRef.current === null) {
    speechQueueRef.current = new CallSpeechQueue({
      onState: (state) => {
        if (state === 'loading') transition({ type: 'process' })
        else if (state === 'playing') transition({ type: 'speak' })
        else if (state === 'error') transition({ type: 'error' })
      },
    })
  }

  function transition(event: Parameters<typeof reduceCallState>[1]): void {
    setClientState((current) => reduceCallState(current, event))
  }

  function clearCallTimer(): void {
    if (callTimerRef.current !== null) window.clearInterval(callTimerRef.current)
    callTimerRef.current = null
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

  function releaseRecorder(): void {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    startedAtRef.current = null
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  function recordTurn(speaker: 'user' | 'companion', text: string): Promise<void> {
    const activeCallId = callIdRef.current
    if (activeCallId === null || text.trim() === '') return Promise.resolve()
    turnWriteChainRef.current = turnWriteChainRef.current
      .then(() => appendCallTurn(activeCallId, speaker, text.trim()))
      .then(() => undefined)
      .catch((error: unknown) => { log.warn('通话逐句记录失败', error) })
    return turnWriteChainRef.current
  }

  function endServerCall(): void {
    const activeCallId = callIdRef.current
    callIdRef.current = null
    callUnsubscribeRef.current?.()
    callUnsubscribeRef.current = null
    if (activeCallId !== null) void hangupCall(activeCallId).catch((error: unknown) => log.warn('结束通话记录失败', error))
  }

  function fail(message: string): void {
    setErrorText(message)
    transition({ type: 'error' })
    onError(message)
  }

  async function handleCallConnection(state: CallEventConnection, activeCallId: string): Promise<void> {
    if (state === 'reconnecting') { transition({ type: 'reconnect' }); return }
    if (state !== 'connected') return
    setClientState((current) => current === 'reconnecting' ? reduceCallState(current, { type: 'resume' }) : current)
    try {
      const latest = (await loadCall(activeCallId)).call
      if (latest.status === 'ended' || latest.status === 'rejected' || latest.status === 'missed' || latest.status === 'cancelled') {
        stopNativeCall(); releaseRecorder(); speechQueueRef.current?.stop(); transition({ type: 'end' })
      }
    } catch (error) { log.warn('通话重连后读取状态失败', error) }
  }

  async function ensureServerCall(): Promise<string> {
    if (callIdRef.current !== null) return callIdRef.current
    transition({ type: 'connect' })
    let call = incomingCallId === null ? await createCall(chatSessionId) : (await loadCall(incomingCallId)).call
    if (call.status === 'ringing') call = await answerCall(call.id)
    callIdRef.current = call.id
    callUnsubscribeRef.current?.()
    callUnsubscribeRef.current = subscribeCallEvents(call.id, (event: CallEvent) => {
      if (event.type !== 'state' || event.call.id !== call.id) return
      const terminal = event.call.status === 'ended' || event.call.status === 'rejected' || event.call.status === 'missed' || event.call.status === 'cancelled'
      if (terminal) {
        stopNativeCall(); releaseRecorder(); speechQueueRef.current?.stop(); setErrorText('通话已结束'); transition({ type: 'end' })
      } else if (event.call.status === 'ringing') transition({ type: 'server', call: event.call })
    }, { onConnectionChange: (state) => { void handleCallConnection(state, call.id) } })
    if (call.status === 'active') transition({ type: 'connect' })
    return call.id
  }

  function resumeNativeListening(): void {
    if (!nativeActiveRef.current || muted || closedRef.current || nativeProcessingRef.current) return
    const recognition = nativeRecognitionRef.current
    if (recognition === null) return
    try { recognition.start(); transition({ type: 'listen' }) } catch (error) {
      if (!(error instanceof DOMException && error.name === 'InvalidStateError')) { log.warn('恢复连续语音识别失败', error); fail('连续语音识别已停止，请重新开始通话') }
    }
  }

  async function playReply(text: string, streaming = false): Promise<void> {
    if (closedRef.current || !speakerEnabledRef.current) { if (nativeActiveRef.current) resumeNativeListening(); else setClientState('idle'); return }
    const result = streaming
      ? await speechQueueRef.current?.finishStreaming()
      : await speechQueueRef.current?.play(text)
    if (closedRef.current) return
    if (result === 'interrupted') { transition({ type: 'interrupt' }); return }
    if (nativeActiveRef.current) resumeNativeListening(); else setClientState('idle')
  }

  function finishRecording(mimeType: string): void {
    const chunks = chunksRef.current; chunksRef.current = []
    const discarded = discardRef.current; discardRef.current = false
    const startedAt = startedAtRef.current
    const durationMs = startedAt === null ? 0 : Date.now() - startedAt
    releaseRecorder(); setElapsedMs(0)
    if (discarded || closedRef.current) return
    if (chunks.length === 0) { fail('没有采到声音，请再试一次'); return }
    if (durationMs < MIN_CALL_TURN_MS) { fail('这一轮太短了，请至少说半秒'); return }
    const blob = new Blob(chunks, { type: mimeType })
    const reader = new FileReader()
    reader.onload = () => {
      if (closedRef.current) return
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (dataUrl === '') { fail('录音读取失败，请再试一次'); return }
      setErrorText(null); transition({ type: 'process' })
      speechQueueRef.current?.startStreaming()
      let streamed = false
      void onTurn(dataUrl, durationMs, (chunk) => { streamed = true; speechQueueRef.current?.append(chunk) }).then(async ({ reply, transcript }) => {
        if (!streamed) speechQueueRef.current?.append(reply)
        await recordTurn('user', transcript); await recordTurn('companion', reply); await playReply(reply, true)
      }).catch((error: unknown) => { speechQueueRef.current?.stop(); log.error('通话这一轮失败', error); fail(error instanceof Error ? error.message : String(error)) })
    }
    reader.onerror = () => fail('录音读取失败，请再试一次')
    reader.readAsDataURL(blob)
  }

  async function handleNativeTurn(text: string): Promise<void> {
    const normalized = text.trim()
    if (normalized === '' || nativeProcessingRef.current || closedRef.current) return
    nativeProcessingRef.current = true; setInterimText(''); transition({ type: 'process' })
    try {
      speechQueueRef.current?.startStreaming()
      let streamed = false
      const reply = await onTurnText(normalized, (chunk) => { streamed = true; speechQueueRef.current?.append(chunk) })
      if (!streamed) speechQueueRef.current?.append(reply)
      await recordTurn('user', normalized); await recordTurn('companion', reply); await playReply(reply, true)
      if (!closedRef.current) { nativeProcessingRef.current = false; resumeNativeListening() }
    } catch (error) {
      nativeActiveRef.current = false; nativeProcessingRef.current = false; clearCallTimer()
      log.error('连续通话这一轮失败', error); fail(error instanceof Error ? error.message : String(error))
    }
  }

  async function startNativeCall(): Promise<void> {
    if (disabled || muted) return
    try { await ensureServerCall() } catch (error) { fail(`无法接通通话：${error instanceof Error ? error.message : String(error)}`); return }
    const Constructor = getSpeechRecognitionConstructor()
    if (Constructor === null) { await startRecording(); return }
    closedRef.current = false; nativeActiveRef.current = true; nativeProcessingRef.current = false
    setErrorText(null); setInterimText(''); callStartedAtRef.current = Date.now(); setElapsedMs(0)
    callTimerRef.current = window.setInterval(() => { const startedAt = callStartedAtRef.current; setElapsedMs(startedAt === null ? 0 : Date.now() - startedAt) }, 250)
    const recognition = nativeRecognitionRef.current ?? new Constructor()
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'zh-CN'
    recognition.onresult = (event) => {
      let interim = ''; let finalText = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) finalText += result[0]?.transcript ?? ''
        else interim += result[0]?.transcript ?? ''
      }
      setInterimText(interim.trim())
      if (finalText.trim() !== '') { try { recognition.stop() } catch { /* 已经停止 */ }; void handleNativeTurn(finalText) }
    }
    recognition.onend = () => { if (nativeActiveRef.current && !nativeProcessingRef.current && !closedRef.current) resumeNativeListening() }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      nativeActiveRef.current = false; clearCallTimer()
      if (event.error === 'not-allowed') endServerCall()
      fail(event.error === 'not-allowed' ? '麦克风权限被拒绝，请在浏览器设置中允许后重试' : `连续语音识别失败：${event.error}`)
    }
    nativeRecognitionRef.current = recognition
    try { recognition.start(); transition({ type: 'listen' }) } catch (error) {
      nativeActiveRef.current = false; clearCallTimer(); endServerCall(); fail(`无法开始通话：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function stopListeningOnly(): void { stopNativeCall(); setClientState('idle') }

  async function startRecording(): Promise<void> {
    if (disabled || clientState === 'processing' || clientState === 'reconnecting') return
    if (clientState === 'speaking') speechQueueRef.current?.stop()
    const media = navigator.mediaDevices
    if (media === undefined || typeof media.getUserMedia !== 'function') { fail('当前环境不支持通话录音：需要 https / localhost 且浏览器提供录音能力'); return }
    try { await ensureServerCall() } catch (error) { fail(`无法接通通话：${error instanceof Error ? error.message : String(error)}`); return }
    try {
      discardRef.current = false
      const audio = inputDeviceIdRef.current === '' ? true : { deviceId: { exact: inputDeviceIdRef.current } }
      const stream = await media.getUserMedia({ audio })
      if (closedRef.current || !open) { stream.getTracks().forEach((track) => track.stop()); return }
      const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      recorder.ondataavailable = (event: BlobEvent) => { if (event.data.size > 0) chunksRef.current.push(event.data) }
      recorder.onstop = () => finishRecording(recorder.mimeType)
      recorderRef.current = recorder; streamRef.current = stream
      stream.getAudioTracks().forEach((track) => { track.enabled = !muted })
      recorder.start(500); startedAtRef.current = Date.now(); setElapsedMs(0); setErrorText(null); setClientState('listening')
      timerRef.current = window.setInterval(() => { const startedAt = startedAtRef.current; const next = startedAt === null ? 0 : Date.now() - startedAt; setElapsedMs(next); if (next >= MAX_CALL_TURN_MS) stopRecording() }, 250)
    } catch (error) {
      releaseRecorder(); endServerCall(); log.error('开始通话录音失败', error)
      fail(error instanceof DOMException && error.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器设置中允许后重试' : `无法开始通话：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function stopRecording(): void { const recorder = recorderRef.current; if (recorder !== null && recorder.state !== 'inactive') recorder.stop() }
  function close(): void {
    closedRef.current = true; discardRef.current = true; stopNativeCall()
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== 'inactive') recorder.stop(); else releaseRecorder()
    speechQueueRef.current?.stop(); endServerCall(); transition({ type: 'end' }); onClose()
  }
  function toggleMute(): void {
    const next = !muted; setMuted(next); streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next })
    if (nativeActiveRef.current) { if (next) stopNativeCall(); else resumeNativeListening() }
  }
  async function changeOutputDevice(deviceId: string): Promise<void> {
    setOutputDeviceId(deviceId)
    try { const supported = await speechQueueRef.current?.setOutputDevice(deviceId); if (supported === false) setErrorText('当前浏览器不支持切换输出设备，已保留默认扬声器') }
    catch (error) { setErrorText(error instanceof Error ? error.message : '输出设备切换失败') }
  }

  useEffect(() => { speakerEnabledRef.current = speakerEnabled; speechQueueRef.current?.setVolume(speakerEnabled ? 1 : 0) }, [speakerEnabled])
  useEffect(() => { inputDeviceIdRef.current = inputDeviceId }, [inputDeviceId])
  useEffect(() => {
    if (!open) return
    closedRef.current = false; setErrorText(null); setInterimText(''); setClientState('idle')
    void navigator.mediaDevices?.enumerateDevices().then((devices) => { setInputDevices(devices.filter((device) => device.kind === 'audioinput')); setOutputDevices(devices.filter((device) => device.kind === 'audiooutput')) }).catch(() => { /* 未授权时设备标签可能不可读 */ })
  }, [open])
  useEffect(() => () => { stopNativeCall(); releaseRecorder(); speechQueueRef.current?.stop(); endServerCall(); callUnsubscribeRef.current?.(); callUnsubscribeRef.current = null }, [])
  useEffect(() => {
    if (!open && (clientState === 'listening' || clientState === 'speaking')) { stopNativeCall(); const recorder = recorderRef.current; if (recorder !== null && recorder.state !== 'inactive') recorder.stop(); speechQueueRef.current?.stop() }
  }, [open, clientState])

  if (!open) return null
  const statusText = callStateLabel(clientState, formatDuration(elapsedMs))
  const canStart = !disabled && clientState !== 'processing' && clientState !== 'reconnecting' && !muted
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25 p-3 sm:items-center" data-testid="call-panel">
      <section className="card w-full max-w-md space-y-4" aria-label="通话模式">
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">通话模式</p><p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>句级语音会连续播放；可随时打断、静音或切换设备。</p></div><button type="button" className="icon-btn" aria-label="结束通话" data-testid="call-close" onClick={close}><IconClose size={18} /></button></div>
        <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--bg-subtle)' }}><div className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full ${clientState === 'listening' ? 'is-recording' : ''}`} style={{ background: 'var(--bg-surface-solid)', color: 'var(--accent-strong)' }}>{clientState === 'listening' ? <IconMic size={28} filled /> : <IconMic size={28} />}</div><p className="text-sm" data-testid="call-status">{statusText}</p>{interimText !== '' && <p className="mt-2 text-xs italic" style={{ color: 'var(--text-secondary)' }} data-testid="call-interim">{interimText}</p>}{errorText !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{errorText}</p>}</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {clientState === 'listening' && nativeRecognitionRef.current === null ? <button type="button" className="btn-pill btn-danger" data-testid="call-stop-recording" onClick={stopRecording}><IconStop size={16} />结束这一轮</button> : clientState === 'listening' ? <button type="button" className="btn-pill btn-danger" data-testid="call-stop-listening" onClick={stopListeningOnly}><IconStop size={16} />停止听取</button> : clientState === 'speaking' ? <button type="button" className="btn-pill btn-strong" data-testid="call-interrupt" onClick={() => { speechQueueRef.current?.stop(); transition({ type: 'interrupt' }); void startNativeCall() }}>打断并说话</button> : <button type="button" className="btn-pill btn-strong" data-testid="call-start-recording" disabled={!canStart} onClick={() => void startNativeCall()}><IconMic size={16} />{clientState === 'processing' ? '处理中…' : incomingCallId !== null ? '接听来电' : '开始通话'}</button>}
          <button type="button" className="btn-pill btn-ghost" aria-pressed={muted} onClick={toggleMute}>{muted ? '解除静音' : '静音'}</button><button type="button" className="btn-pill btn-ghost" aria-pressed={!speakerEnabled} onClick={() => setSpeakerEnabled((value) => !value)}>{speakerEnabled ? '关闭扬声器' : '打开扬声器'}</button><button type="button" className="btn-pill btn-ghost" data-testid="call-hangup" onClick={close}>结束通话</button>
        </div>
        {(inputDevices.length > 1 || outputDevices.length > 1) && <div className="grid gap-2 sm:grid-cols-2">{inputDevices.length > 1 && <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>输入设备<select className="input mt-1 w-full" value={inputDeviceId} onChange={(event) => setInputDeviceId(event.target.value)}><option value="">系统默认麦克风</option>{inputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${device.deviceId.slice(0, 6)}`}</option>)}</select></label>}{outputDevices.length > 1 && <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>输出设备<select className="input mt-1 w-full" value={outputDeviceId} onChange={(event) => void changeOutputDevice(event.target.value)}><option value="">系统默认扬声器</option>{outputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || `扬声器 ${device.deviceId.slice(0, 6)}`}</option>)}</select></label>}</div>}
      </section>
    </div>
  )
}
