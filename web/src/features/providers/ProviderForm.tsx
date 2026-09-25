/**
 * 方案表单（新建 / 编辑共用）
 *
 * 设计取向：**主路径只让填「人话能懂」的四项** —— 名称、Base URL、模型、API Key。
 * 「从环境变量读密钥」（keyRef）收进折叠的「高级」：个人自用下手填密钥才是常态，
 * 把「环境变量名」摆到主路径上只会让人犹豫该往哪填。
 */
import { useState, type FormEvent } from 'react'
import type { ApiProfileCreateInput, ApiProfilePublic } from '@shared/types'

interface Preset {
  label: string
  baseUrl: string
  model: string
}

/** 常见上游的快捷填充：省得手打 baseUrl（模型名填完还能改） */
const PRESETS: readonly Preset[] = [
  { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
]

const INPUT_CLS = 'w-full rounded-md border px-3 py-2 text-sm'
const INPUT_STYLE = {
  borderColor: 'var(--border-soft)',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--text-primary)',
} as const
const LABEL_STYLE = { color: 'var(--text-secondary)' } as const

export interface ProviderFormProps {
  /** 传了就是编辑；不传就是新建 */
  initial?: ApiProfilePublic
  busy: boolean
  onSubmit: (input: ApiProfileCreateInput, secret: string | null) => void
  onCancel: () => void
}

export function ProviderForm({ initial, busy, onSubmit, onCancel }: ProviderFormProps) {
  const isEdit = initial !== undefined
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [chatModel, setChatModel] = useState(initial?.modelMap.chat ?? '')
  const [ttsModel, setTtsModel] = useState(initial?.modelMap.tts ?? '')
  const [transcriptionModel, setTranscriptionModel] = useState(initial?.modelMap.transcription ?? '')
  const [visionModel, setVisionModel] = useState(initial?.modelMap.vision ?? '')
  const [imageModel, setImageModel] = useState(initial?.modelMap.image ?? '')
  const [secret, setSecret] = useState('')
  const [keyRef, setKeyRef] = useState(initial?.keyRef ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? false)
  /** 缺省开；关掉只为了让「见到 stream_options 就报 400」的老自建上游能用 */
  const [streamOptions, setStreamOptions] = useState(initial?.streamOptions ?? true)

  const canSubmit = name.trim() !== '' && baseUrl.trim() !== '' && chatModel.trim() !== ''

  function applyPreset(preset: Preset): void {
    setBaseUrl(preset.baseUrl)
    setChatModel(preset.model)
    if (name.trim() === '') setName(preset.label)
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    if (!canSubmit || busy) return
    onSubmit(
      {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        modelMap: {
          chat: chatModel.trim(),
          ...(ttsModel.trim() === '' ? {} : { tts: ttsModel.trim() }),
          ...(transcriptionModel.trim() === '' ? {} : { transcription: transcriptionModel.trim() }),
          ...(visionModel.trim() === '' ? {} : { vision: visionModel.trim() }),
          ...(imageModel.trim() === '' ? {} : { image: imageModel.trim() }),
        },
        // 编辑时**总是**带上 keyRef，这样把它清空才生效；新建时空串就不必传
        ...(isEdit || keyRef.trim() !== '' ? { keyRef: keyRef.trim() } : {}),
        streamOptions,
        isActive,
      },
      secret.trim() === '' ? null : secret.trim(),
    )
  }

  const secretPlaceholder = !isEdit
    ? '粘贴 API Key（也可先留空，之后再填）'
    : initial?.hasKey === true
      ? '已配置 —— 留空表示不修改'
      : '粘贴 API Key'

  return (
    <form
      className="mb-3 rounded-md border p-3"
      style={{ borderColor: 'var(--accent-strong)', backgroundColor: 'var(--bg-subtle)' }}
      onSubmit={handleSubmit}
    >
      <p className="mb-3 text-xs font-semibold" style={LABEL_STYLE}>
        {isEdit ? `编辑「${initial?.name ?? ''}」` : '新建方案'}
      </p>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs" style={LABEL_STYLE}>
          名称
        </span>
        <input
          className={INPUT_CLS}
          style={INPUT_STYLE}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：DeepSeek 官方"
        />
      </label>

      <label className="mb-1 block">
        <span className="mb-1 block text-xs" style={LABEL_STYLE}>
          Base URL
        </span>
        <input
          className={INPUT_CLS}
          style={INPUT_STYLE}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.deepseek.com/v1"
          autoComplete="off"
        />
      </label>
      <div className="mb-3 flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs" style={LABEL_STYLE}>
          对话模型
        </span>
        <input
          className={INPUT_CLS}
          style={INPUT_STYLE}
          value={chatModel}
          onChange={(event) => setChatModel(event.target.value)}
          placeholder="deepseek-chat"
          autoComplete="off"
        />
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs" style={LABEL_STYLE}>
          API Key
        </span>
        <input
          className={INPUT_CLS}
          style={INPUT_STYLE}
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={secretPlaceholder}
          autoComplete="off"
        />
        <span className="mt-1 block text-xs" style={LABEL_STYLE}>
          密钥只保存在你自己的服务端，保存后不会再显示出来。
        </span>
      </label>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        <span>设为默认方案</span>
      </label>

      <details className="mb-3">
        <summary className="cursor-pointer text-xs" style={LABEL_STYLE}>
          高级：语音 / 图片模型与兼容设置
        </summary>
        <div className="mt-2">
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <input className={INPUT_CLS} style={INPUT_STYLE} value={transcriptionModel} onChange={(event) => setTranscriptionModel(event.target.value)} placeholder="语音转写模型（如 whisper-1）" autoComplete="off" />
            <input className={INPUT_CLS} style={INPUT_STYLE} value={ttsModel} onChange={(event) => setTtsModel(event.target.value)} placeholder="朗读模型（如 gpt-4o-mini-tts）" autoComplete="off" />
            <input className={INPUT_CLS} style={INPUT_STYLE} value={visionModel} onChange={(event) => setVisionModel(event.target.value)} placeholder="视觉模型（留空则不用）" autoComplete="off" />
            <input className={INPUT_CLS} style={INPUT_STYLE} value={imageModel} onChange={(event) => setImageModel(event.target.value)} placeholder="图片生成模型（留空则不用）" autoComplete="off" />
          </div>
          <input
            className={INPUT_CLS}
            style={INPUT_STYLE}
            value={keyRef}
            onChange={(event) => setKeyRef(event.target.value)}
            placeholder="例如：DEEPSEEK_API_KEY（留空即可）"
            autoComplete="off"
          />
          <p className="mt-1 text-xs" style={LABEL_STYLE}>
            上面填了 API Key 就用那个；只有没填时才会去读这个名字对应的环境变量。
            一般用不到 —— 除非密钥要留在服务端启动环境里（容器部署等）。
          </p>
        </div>

        <label className="mt-3 flex items-start gap-2 text-xs" style={LABEL_STYLE}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={streamOptions}
            onChange={(event) => setStreamOptions(event.target.checked)}
          />
          <span>
            请求里带 <code>stream_options</code>（默认开）—— 靠它才能在末包拿到 token 用量，账本要用。
            <strong>只有</strong>老自建上游（老版 vLLM、部分中转）因此报 400 时才关掉。
          </span>
        </label>
      </details>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className="rounded-md px-4 py-2 text-sm"
          style={{
            backgroundColor: 'var(--accent-strong)',
            color: 'var(--accent-on-strong)',
            opacity: !canSubmit || busy ? 0.5 : 1,
          }}
        >
          {busy ? '保存中…' : isEdit ? '保存' : '创建'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border px-4 py-2 text-sm"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          取消
        </button>
      </div>
    </form>
  )
}
