/**
 * 聊天输入区（SPEC §2.4）
 *
 * 结构（第 3 批换装后对齐设计 §11.3「浮起胶囊」）：
 * **轻控件行**（表情包 / 请求回复）→ 贴着胶囊长出来的**卡片**（表情面板 / 生图提示条）→
 * **输入胶囊**（＋ / 文本 / 语音 / 圆形主按钮）。胶囊留在整屏最底部 —— 拇指热区。
 *
 * 为什么把输入区整个抽出来：它此前长在 `ChatWindowPage` 里，而页面已经承担了
 * 「生成生命周期 / 消息对象操作 / 跨模块收录 / 会话设置」四件事。输入区自己又新添了
 * 录音、表情面板、次级菜单三份局部状态 —— 再堆在页面里，页面就没法读了。
 * 抽出的边界是：**这一层只负责「怎么输入、点了什么」**，不知道消息怎么落库、
 * 更不知道生成怎么跑；这些一律通过回调交回页面。
 *
 * 一个刻意的克制：**不做「发送 / 请求回复」双主按钮的形态切换**。
 * 主按钮永远只有一颗（圆形，发送 / 生成中变停止），「请求回复」永远是控件行里那个固定位置 ——
 * 一个按钮两副面孔，会让人每次点之前都要先看一眼它现在是什么。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionSheet, type SheetAction } from '../../components/ActionSheet'
import {
  IconClose,
  IconMic,
  IconPlus,
  IconSend,
  IconSmile,
  IconStop,
} from '../../components/qixi/Icons'
import { formatDuration } from '../../lib/format'
import { log } from '../../lib/log'
import { useOnlineStatus } from '../offline/useOnlineStatus'
import { MAX_PHOTO_BYTES, type PhotoMime } from '@shared/types'

/** 语音条时长上限（SPEC §2.4.4）：到点自动停止，免得一条录音把备份撑爆 */
const VOICE_MAX_MS = 60_000
/** 太短的录音（按下就没）多半是误触，不发出去 */
const VOICE_MIN_MS = 400
/** 输入框自增高上限（与 `.chat-inputbar textarea` 的 `max-height` 对齐） */
const TEXTAREA_MAX_PX = 108
/**
 * 录音格式候选，按优先级取第一个被支持的。
 * ⚠️ 实测 Edge（Chromium）**不支持 `audio/ogg;codecs=opus`**，
 * 支持的是 `audio/webm;codecs=opus` / `audio/webm` / `audio/mp4`。
 * 所以这里不能只给一个 ogg —— 那样在 Chromium 系上会直接抛 `NotSupportedError`。
 */
const VOICE_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

/** 表情面板：先给一屏常用的，够聊就行（分类 / 搜索 / 自定义表情是另一件事，不在本切片） */
const EMOJI_ROWS = [
  ['😊', '😄', '🥰', '😍', '😘', '😳', '🥺', '😭'],
  ['😅', '🤔', '😴', '😤', '😮', '🙃', '😔', '🫠'],
  ['❤️', '💛', '💔', '✨', '🌸', '🍃', '☀️', '🌙'],
  ['👍', '👏', '🤝', '🙏', '🫂', '💪', '🐦', '🎈'],
]

export interface ComposerProps {
  draft: string
  onDraftChange: (value: string) => void
  /** 正在生成（或正在录音后发送）：主按钮变「停止」 */
  sending: boolean
  /** 待回复消息条数（SPEC §2.4.3）：> 0 时「请求回复」可用 */
  unrepliedCount: number
  /** 发一条文本消息。`requestReply` 为 false = 「只发送」 */
  onSend: (text: string, options: { requestReply: boolean }) => void
  onRequestReply: () => void
  /** 语音条：内联 data URL + 实测时长（SPEC §2.4.4） */
  onSendVoice: (dataUrl: string, durationMs: number) => void
  onSendImage: (dataUrl: string) => void
  onGenerateImage: (prompt: string) => void
  onAbort: () => void
  /**
   * 原生能力失败（录音权限 / 设备 / 读文件）走这里，由页面统一显示。
   * 不许只 `console.error` 了事 —— 那样用户看到的是一次「点了没反应」。
   */
  onError: (text: string) => void
}

export function Composer({
  draft,
  onDraftChange,
  sending,
  unrepliedCount,
  onSend,
  onRequestReply,
  onSendVoice,
  onSendImage,
  onGenerateImage,
  onAbort,
  onError,
}: ComposerProps) {
  /** 离线时：凡点了会发 HTTP 请求的动作一律禁用，纯本地动作（写草稿 / 插入时间）照常 */
  const online = useOnlineStatus()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [imagePromptOpen, setImagePromptOpen] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  /* ---------- 语音条录制 ---------- */
  const [recordingSince, setRecordingSince] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [voicePreview, setVoicePreview] = useState<{ dataUrl: string; durationMs: number } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingSinceRef = useRef<number | null>(null)
  /** 取消 → 抛弃已经录到的数据，别让「取消」变成「照发」 */
  const discardRef = useRef(false)

  // 录音计时 + 到点自动停。用 interval 而不是 CSS 动画：时长要落进 block，得是真数值
  useEffect(() => {
    if (recordingSince === null) return
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - recordingSince
      setElapsedMs(elapsed)
      if (elapsed >= VOICE_MAX_MS) stopRecording()
    }, 200)
    return () => window.clearInterval(tick)
    // stopRecording 每次渲染都是新函数，但它只读 ref —— 依赖它会让 interval 反复重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingSince])

  // 离开页面时别把麦克风开着（浏览器地址栏的录音指示灯会一直亮着）
  useEffect(
    () => () => {
      const recorder = recorderRef.current
      if (recorder !== null && recorder.state !== 'inactive') {
        discardRef.current = true
        recorder.stop()
      }
      releaseStream()
    },
    [],
  )

  /**
   * 草稿变化时把输入框撑到内容高度（设计里输入框是自增高的）。
   * ⚠️ 先把高度归零再读 `scrollHeight`：不归零的话它只会越撑越长，删字也缩不回去。
   */
  useEffect(() => {
    const el = textareaRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`
  }, [draft])

  function releaseStream(): void {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }

  function setRecording(since: number | null): void {
    recordingSinceRef.current = since
    setRecordingSince(since)
  }

  async function startRecording(): Promise<void> {
    if (sending || recordingSince !== null) return
    // 非安全上下文里 `navigator.mediaDevices` 整个是 undefined（不是「权限被拒」），
    // 所以先判能力再判权限，报错才能说清是「环境不支持」还是「你拒绝了」
    const media: MediaDevices | undefined = navigator.mediaDevices
    if (media === undefined || typeof media.getUserMedia !== 'function') {
      onError('当前环境不支持录音：需要 https / localhost 且浏览器提供录音能力')
      return
    }
    try {
      const stream = await media.getUserMedia({ audio: true })
      const mimeType = VOICE_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder =
        mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      discardRef.current = false
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => finishRecording(recorder.mimeType)
      recorderRef.current = recorder
      streamRef.current = stream
      // 分片（1s）：长录音不至于全压在最后一块里，中途出错也能留住已录到的部分
      recorder.start(1000)
      setElapsedMs(0)
      setRecording(Date.now())
    } catch (err) {
      releaseStream()
      log.error('开始录音失败', err)
      onError(`无法开始录音：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 停止并**发出**（到点自动停走的也是这条） */
  function stopRecording(): void {
    const recorder = recorderRef.current
    if (recorder === null || recorder.state === 'inactive') return
    discardRef.current = false
    recorder.stop()
  }

  function cancelRecording(): void {
    const recorder = recorderRef.current
    discardRef.current = true
    if (recorder === null || recorder.state === 'inactive') {
      releaseStream()
      setRecording(null)
      setElapsedMs(0)
      return
    }
    recorder.stop()
  }

  function finishRecording(mimeType: string): void {
    const chunks = discardRef.current ? [] : chunksRef.current
    discardRef.current = false
    chunksRef.current = []

    const startedAt = recordingSinceRef.current
    const durationMs = startedAt === null ? 0 : Date.now() - startedAt
    releaseStream()
    setRecording(null)
    setElapsedMs(0)

    if (chunks.length === 0) return
    if (durationMs < VOICE_MIN_MS) {
      onError('录音太短了，没有发出')
      return
    }
    const blob = new Blob(chunks, { type: mimeType })
    if (blob.size === 0) {
      onError('录音没有采到声音，没有发出')
      return
    }
    // 与相册图片同样的做法（内联 data URL）：IndexedDB 与 JSON 备份都能原样恢复
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      if (url === '') {
        onError('录音读取失败，没有发出')
        return
      }
      setVoicePreview({ dataUrl: url, durationMs })
    }
    reader.onerror = () => {
      log.error('录音读取失败', reader.error)
      onError('录音读取失败，没有发出')
    }
    reader.readAsDataURL(blob)
  }

  function chooseImage(file: File | undefined): void {
    if (file === undefined) return
    const allowed: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] satisfies readonly PhotoMime[]
    if (!allowed.includes(file.type)) {
      onError('只支持 JPEG、PNG、WebP 或 GIF 图片')
      return
    }
    if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
      onError('图片必须在 1 B–3 MB 之间')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') onSendImage(reader.result)
      else onError('图片读取失败，没有发出')
    }
    reader.onerror = () => onError('图片读取失败，没有发出')
    reader.readAsDataURL(file)
  }

  /* ---------- 插入（表情 / 时间）都要落在光标处，不能一律追加到末尾 ---------- */
  function insertAtCursor(text: string): void {
    const el = textareaRef.current
    if (el === null) {
      onDraftChange(draft + text)
      return
    }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? start
    onDraftChange(draft.slice(0, start) + text + draft.slice(end))
    // 光标落到插入内容之后：连续点几个表情才不会全挤在最前面。
    // 用 rAF 等 value 真正写进 DOM 再设选区，否则会被 React 的受控回写冲掉
    window.requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  function nowText(): string {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }

  /**
   * 菜单项按当前状态增减（与消息菜单同一套做法），而不是渲染出来再置灰。
   *
   * ⚠️ 生成中**不提供「只发送」**：发送链路在 `sending` 时是直接返回的，
   * 留着这一项等于给用户一个点了没反应的按钮。宁可它此刻不存在。
   */
  const moreActions = useMemo<SheetAction[] | null>(() => {
    if (!moreOpen) return null
    const items: SheetAction[] = []
    // 「只发送，不请求回复」只落本地、不发请求 —— 离线时保留（离线也能先把想说的话记下来）
    if (!sending && draft.trim() !== '') items.push({ id: 'silent-send', label: '只发送，不请求回复' })
    // 发图会顺带请求 AI 回复、生成图片要打生图接口，两者都会发请求 —— 离线时不给
    if (!sending && online) items.push({ id: 'choose-image', label: '发送图片' })
    if (!sending && online) items.push({ id: 'generate-image', label: '生成图片' })
    items.push({ id: 'insert-time', label: `插入当前时间（${nowText()}）` })
    if (draft !== '') items.push({ id: 'clear-draft', label: '清空输入' })
    return items
    // nowText() 只用于展示，分钟级变化不值得重建菜单 —— draft / sending / online / moreOpen 才是真依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreOpen, draft, sending, online])

  function runMoreAction(actionId: string): void {
    setMoreOpen(false)
    switch (actionId) {
      case 'silent-send':
        onSend(draft.trim(), { requestReply: false })
        break
      case 'insert-time':
        insertAtCursor(nowText())
        break
      case 'choose-image':
        imageInputRef.current?.click()
        break
      case 'generate-image':
        setImagePromptOpen(true)
        break
      case 'clear-draft':
        onDraftChange('')
        break
      default:
        break
    }
  }

  const canSend = draft.trim() !== '' && !sending && online
  const recording = recordingSince !== null

  return (
    /*
      安全区在这一层统一承担（胶囊自己的 margin 里**不**夹 env()）：
      两处都加就会凭空多出一条空白 —— 底栏那次踩过同样的坑。
      输入区不再是「贴底一条带顶边框的横条」，而是浮起的玻璃胶囊（设计 §11.3）。
    */
    <div
      className="flex shrink-0 flex-col"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {recording ? (
        <div
          data-testid="voice-recording"
          className="chat-inputbar chat-inputbar--docked"
          style={{ alignItems: 'center' }}
        >
          {/* 红点走设计的 `.dot.pulse`，不用一个「●」字符 —— 字符会跟着字体变形状 */}
          <span className="dot pulse shrink-0" style={{ backgroundColor: 'var(--danger)' }} />
          <span data-testid="voice-time" className="flex-1 px-3 text-sm" style={{ color: 'var(--text-primary)' }}>
            录音中 {formatDuration(elapsedMs)} / {formatDuration(VOICE_MAX_MS)}
          </span>
          <button
            type="button"
            data-testid="voice-cancel"
            onClick={cancelRecording}
            className="btn-pill btn-ghost shrink-0"
            style={{ minHeight: 36, padding: '0 18px', fontSize: 13.5 }}
          >
            取消
          </button>
          {/* 刻意不叫「发送」：全局唯一的「发送」主按钮是输入区那颗圆形按钮，
              多一个同名按钮会让「按文案找按钮」的脚本抓错对象 */}
          <button
            type="button"
            data-testid="voice-send"
            onClick={stopRecording}
            className="btn-pill btn-strong shrink-0"
            style={{ minHeight: 36, padding: '0 18px', fontSize: 13.5 }}
          >
            发出
          </button>
        </div>
      ) : voicePreview !== null ? (
        <div data-testid="voice-preview" className="card chat-panel flex flex-col gap-2" style={{ padding: '12px 14px' }}>
          <audio controls src={voicePreview.dataUrl} className="w-full" />
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              录音预览 · {formatDuration(voicePreview.durationMs)}
            </span>
            <button type="button" data-testid="voice-rerecord" onClick={() => { setVoicePreview(null); void startRecording() }} className="btn-pill btn-ghost" style={{ minHeight: 34, padding: '0 16px', fontSize: 13 }}>重录</button>
            <button type="button" data-testid="voice-preview-send" onClick={() => { const value = voicePreview; setVoicePreview(null); onSendVoice(value.dataUrl, value.durationMs) }} className="btn-pill btn-strong" style={{ minHeight: 34, padding: '0 16px', fontSize: 13 }}>发送</button>
          </div>
        </div>
      ) : (
        <>
          {/*
            快捷操作栏（SPEC §2.4.2）：表情包 / 请求回复。
            ⚠️ 位置相对旧版**挪到了胶囊上方**：设计里浮起的输入胶囊是页面最底部那一条，
            控件行若还放在它下面，等于把输入框往上顶、让手在最下面摸到一排次要按钮。
            顺序改成「先控件、后胶囊」，胶囊留在拇指热区。
          */}
          <div data-testid="quick-bar" className="chat-quickbar">
            <button
              type="button"
              data-testid="quick-emoji"
              aria-label="表情包"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((prev) => !prev)}
              className="icon-btn"
              style={{
                width: 32,
                height: 32,
                color: emojiOpen ? 'var(--accent-strong)' : 'var(--text-secondary)',
              }}
            >
              <IconSmile size={18} />
            </button>
            <span className="flex-1" />
            <button
              type="button"
              data-testid="request-reply"
              disabled={sending || unrepliedCount === 0 || !online}
              onClick={onRequestReply}
              title={online ? undefined : '当前离线，联网后才能请求回复'}
              className="chip pressable disabled:opacity-40"
              style={
                // 有待回复的消息时它是这一屏唯一的强调色元素 —— 那是此刻最该被点的东西
                unrepliedCount > 0 && !sending && online
                  ? {
                      backgroundColor: 'var(--accent-strong)',
                      color: 'var(--accent-on-strong)',
                      borderColor: 'transparent',
                    }
                  : undefined
              }
            >
              {unrepliedCount > 0 ? `请求回复 (${unrepliedCount})` : '请求回复'}
            </button>
          </div>

          {/* 表情面板：浮起卡片，紧贴胶囊上方（像键盘那样贴着输入框长出来） */}
          {emojiOpen && (
            <div data-testid="emoji-panel" className="card chat-panel">
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_ROWS.flat().map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    data-testid="emoji-option"
                    aria-label={`插入 ${emoji}`}
                    onClick={() => insertAtCursor(emoji)}
                    className="rounded py-1 text-lg"
                    style={{ backgroundColor: 'transparent' }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {imagePromptOpen && voicePreview === null && (
            <div data-testid="image-prompt" className="card chat-panel flex items-center gap-2">
              <input
                value={imagePrompt}
                onChange={(event) => setImagePrompt(event.target.value)}
                placeholder="描述想生成的图片…"
                className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm outline-none"
                style={{
                  border: '1px solid var(--border-soft)',
                  backgroundColor: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                disabled={imagePrompt.trim() === '' || sending}
                onClick={() => {
                  const prompt = imagePrompt.trim()
                  setImagePrompt('')
                  setImagePromptOpen(false)
                  onGenerateImage(prompt)
                }}
                className="btn-pill btn-strong shrink-0 disabled:opacity-40"
                style={{ minHeight: 34, padding: '0 16px', fontSize: 13 }}
              >
                生成
              </button>
              <button
                type="button"
                onClick={() => setImagePromptOpen(false)}
                className="icon-btn shrink-0"
                aria-label="取消"
                style={{ width: 34, height: 34, color: 'var(--text-tertiary)' }}
              >
                <IconClose size={16} />
              </button>
            </div>
          )}

          {/* 输入胶囊（设计 §11.3）：浮起、玻璃、圆角拉满 */}
          <div className="chat-inputbar chat-inputbar--docked">
            <button
              type="button"
              data-testid="quick-more"
              aria-label="更多功能"
              onClick={() => setMoreOpen(true)}
              className="icon-btn"
            >
              <IconPlus size={20} />
            </button>
            <textarea
              ref={textareaRef}
              data-testid="composer"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              rows={1}
              placeholder={online ? '输入消息…' : '离线中 —— 联网后才能发送'}
              onKeyDown={(e) => {
                // isComposing：中文输入法选词时的回车不能当发送（否则一句话被切两半）
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (canSend) onSend(draft.trim(), { requestReply: true })
                  // 离线时回车不会有任何反应，得说出来 —— 否则看起来像「键盘坏了」
                  else if (!online && draft.trim() !== '') onError('当前离线，联网后才能发送')
                }
              }}
            />
            <button
              type="button"
              data-testid="quick-voice"
              aria-label="录一条语音"
              disabled={sending || !online}
              title={online ? undefined : '当前离线，联网后才能发送语音'}
              onClick={() => void startRecording()}
              className="icon-btn disabled:opacity-40"
            >
              <IconMic size={19} />
            </button>
            {sending ? (
              /*
                生成中：主按钮换成「停止」。
                ⚠️ 用的是 `IconStop`（方块，一轮到此为止），**不是** `IconPause`（双竖条，待会儿接着来）——
                栖息地的中止只结束当前这轮流式输出，图标用错会把这件事说反。
              */
              <button
                type="button"
                data-testid="composer-abort"
                aria-label="停止"
                onClick={onAbort}
                className="send-btn"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
              >
                <IconStop size={16} filled />
              </button>
            ) : (
              <button
                type="button"
                data-testid="send"
                aria-label="发送"
                onClick={() => onSend(draft.trim(), { requestReply: true })}
                disabled={!canSend}
                className="send-btn"
              >
                <IconSend size={18} />
              </button>
            )}
          </div>
        </>
      )}

      <input
        ref={imageInputRef}
        data-testid="image-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          chooseImage(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {/* 表情面板 / 生图提示条都已经挂进上面的常规输入分支里，
          不再是「浮在底栏之上的独立浮层」——它们现在是贴着胶囊长出来的卡片 */}

      <ActionSheet
        actions={moreActions}
        title="更多功能"
        onSelect={runMoreAction}
        onClose={() => setMoreOpen(false)}
      />
    </div>
  )
}
