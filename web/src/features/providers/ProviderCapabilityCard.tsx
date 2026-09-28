import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import type {
  ApiProfileModelMap,
  ApiProfilePublic,
  ProviderCapability,
  ProviderCapabilityBinding,
  ProviderDraftInput,
  ProviderDraftModelsResult,
  ProviderDraftVoicesResult,
  ProviderDraftTestResult,
  LlmProviderKind,
  ElevenLabsVoiceSettings,
  ElevenLabsVoiceOption,
} from '@shared/types'
import { ApiRequestError } from '../../lib/api'
import { IconChevronDown } from '../../components/qixi/Icons'
import * as api from './api'

const INPUT = 'w-full rounded-md border px-3 py-2 text-sm'
const INPUT_STYLE = { borderColor: 'var(--border-soft)', background: 'var(--bg-base)', color: 'var(--text-primary)' } as const

const META: Record<ProviderCapability, { title: string; note: string; model: string }> = {
  chat: { title: '主聊天 API', note: '普通聊天、Wake 与后台自主决策', model: '对话模型' },
  voice: { title: '语音 API', note: '文字转语音；可选再绑定语音转写', model: 'TTS 模型' },
  vision: { title: '识图 API', note: '理解聊天中发送的图片', model: '视觉模型' },
  image: { title: '生图 API', note: '生成可保存到聊天与相册的图片', model: '生图模型' },
}

function toMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : String(error)
}

function modelMap(capability: ProviderCapability, model: string, secondaryModel: string, voiceId: string, voiceSettings?: ElevenLabsVoiceSettings): ApiProfileModelMap {
  if (capability === 'chat') return { chat: model }
  if (capability === 'voice') return { tts: model, ...(voiceId === '' ? {} : { voice: voiceId }), ...(voiceSettings === undefined ? {} : { voiceSettings }), ...(secondaryModel === '' ? {} : { transcription: secondaryModel }) }
  if (capability === 'vision') return { vision: model }
  return { image: model }
}

function parseHeaders(raw: string): Record<string, string> | undefined {
  if (raw.trim() === '') return undefined
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('自定义 Headers 必须是 JSON 对象')
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error(`Header「${key}」的值必须是字符串`)
    result[key] = value
  }
  return result
}

interface HeaderRow {
  id: number
  key: string
  value: string
}

interface Props {
  capability: ProviderCapability
  profiles: ApiProfilePublic[]
  binding?: ProviderCapabilityBinding
  busy: boolean
  onChanged: () => void
}

export function ProviderCapabilityCard({ capability, profiles, binding, busy, onChanged }: Props) {
  const availableProfiles = capability === 'chat'
    ? profiles.filter((profile) => profile.provider === 'openai-compat' || profile.provider === 'codex-subscription')
    : capability === 'voice'
      ? profiles.filter((profile) => profile.provider !== 'codex-subscription')
      : profiles.filter((profile) => profile.provider === 'openai-compat')
  const initialProfile = availableProfiles.find((profile) => profile.id === binding?.profileId) ?? availableProfiles[0]
  const [profileId, setProfileId] = useState(initialProfile?.id ?? '__new__')
  const [providerKind, setProviderKind] = useState<LlmProviderKind>(initialProfile?.provider ?? 'openai-compat')
  const [connectionName, setConnectionName] = useState('')
  const [baseUrl, setBaseUrl] = useState(initialProfile?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([])
  const nextHeaderId = useRef(1)
  const [model, setModel] = useState(binding?.model ?? '')
  const [secondaryModel, setSecondaryModel] = useState(binding?.secondaryModel ?? '')
  const [voiceId, setVoiceId] = useState(capability === 'voice' ? initialProfile?.modelMap.voice ?? '' : '')
  const [voiceStability, setVoiceStability] = useState(String(initialProfile?.modelMap.voiceSettings?.stability ?? 0.5))
  const [voiceSimilarity, setVoiceSimilarity] = useState(String(initialProfile?.modelMap.voiceSettings?.similarityBoost ?? 0.75))
  const [voiceStyle, setVoiceStyle] = useState(String(initialProfile?.modelMap.voiceSettings?.style ?? 0))
  const [voiceSpeakerBoost, setVoiceSpeakerBoost] = useState(initialProfile?.modelMap.voiceSettings?.useSpeakerBoost ?? true)
  const [voiceSpeed, setVoiceSpeed] = useState(String(initialProfile?.modelMap.voiceSettings?.speed ?? 1))
  const [models, setModels] = useState<string[]>([])
  const [modelResult, setModelResult] = useState<ProviderDraftModelsResult | null>(null)
  const [voices, setVoices] = useState<ElevenLabsVoiceOption[]>([])
  const [voiceResult, setVoiceResult] = useState<ProviderDraftVoicesResult | null>(null)
  const [testResult, setTestResult] = useState<ProviderDraftTestResult | null>(null)
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null)
  const [testImage, setTestImage] = useState<string | undefined>()
  const [working, setWorking] = useState<'models' | 'voices' | 'test' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(() => capability === 'chat')
  const meta = META[capability]
  const selected = availableProfiles.find((profile) => profile.id === profileId)
  const panelId = `provider-capability-${capability}-panel`

  const draft = useMemo<ProviderDraftInput>(() => ({
    ...(profileId === '__new__' ? {} : { profileId }),
    provider: providerKind,
    baseUrl: baseUrl.trim(),
    ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
    ...(headersText.trim() === '' ? {} : { headers: (() => { try { return parseHeaders(headersText) } catch { return undefined } })() }),
  }), [apiKey, baseUrl, headersText, profileId, providerKind])

  function currentVoiceSettings(): ElevenLabsVoiceSettings | undefined {
    if (capability !== 'voice' || providerKind !== 'elevenlabs') return undefined
    return { stability: Number(voiceStability), similarityBoost: Number(voiceSimilarity), style: Number(voiceStyle), useSpeakerBoost: voiceSpeakerBoost, speed: Number(voiceSpeed) }
  }

  function voiceSettingsValid(): boolean {
    const settings = currentVoiceSettings()
    return settings === undefined || (
      settings.stability !== undefined && settings.stability >= 0 && settings.stability <= 1 &&
      settings.similarityBoost !== undefined && settings.similarityBoost >= 0 && settings.similarityBoost <= 1 &&
      settings.style !== undefined && settings.style >= 0 && settings.style <= 1 &&
      settings.useSpeakerBoost !== undefined &&
      settings.speed !== undefined && settings.speed >= 0.7 && settings.speed <= 1.2
    )
  }

  const fingerprint = JSON.stringify({ draft, capability, model: model.trim(), secondaryModel: secondaryModel.trim(), voiceId: voiceId.trim(), voiceSettings: currentVoiceSettings(), testImage })
  const canSave = testResult?.ok === true && testedFingerprint === fingerprint && model.trim() !== '' && baseUrl.trim() !== '' && voiceSettingsValid() && (capability !== 'voice' || providerKind !== 'elevenlabs' || voiceId.trim() !== '')

  function selectProfile(next: string): void {
    setProfileId(next)
    const profile = availableProfiles.find((item) => item.id === next)
    setProviderKind(profile?.provider ?? 'openai-compat')
    setBaseUrl(profile?.baseUrl ?? '')
    setModel(capability === 'voice' ? profile?.modelMap.tts ?? '' : profile?.modelMap[capability] ?? '')
    setSecondaryModel(capability === 'voice' ? profile?.modelMap.transcription ?? '' : '')
    setVoiceId(capability === 'voice' ? profile?.modelMap.voice ?? '' : '')
    setVoiceStability(String(profile?.modelMap.voiceSettings?.stability ?? 0.5))
    setVoiceSimilarity(String(profile?.modelMap.voiceSettings?.similarityBoost ?? 0.75))
    setVoiceStyle(String(profile?.modelMap.voiceSettings?.style ?? 0))
    setVoiceSpeakerBoost(profile?.modelMap.voiceSettings?.useSpeakerBoost ?? true)
    setVoiceSpeed(String(profile?.modelMap.voiceSettings?.speed ?? 1))
    setConnectionName('')
    setApiKey('')
    setHeadersText('')
    setHeaderRows([])
    setModels([])
    setModelResult(null)
    setVoices([])
    setVoiceResult(null)
    setTestResult(null)
    setTestedFingerprint(null)
  }

  function strictDraft(): ProviderDraftInput {
    const headers = parseHeaders(headersText)
    return {
      ...(profileId === '__new__' ? {} : { profileId }),
      provider: providerKind,
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
      ...(headers === undefined ? {} : { headers }),
    }
  }

  async function pullModels(): Promise<void> {
    setWorking('models')
    setError(null)
    try {
      const result = await api.pullDraftModels(strictDraft())
      setModelResult(result)
      setModels(result.models)
      if (!result.ok) setError(result.error)
    } catch (cause) {
      setError(toMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  async function pullVoices(): Promise<void> {
    if (providerKind !== 'elevenlabs') return
    setWorking('voices')
    setError(null)
    try {
      const result = await api.pullDraftVoices(strictDraft())
      setVoiceResult(result)
      setVoices(result.voices)
      if (!result.ok) setError(result.error)
    } catch (cause) {
      setError(toMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  async function test(): Promise<void> {
    if (model.trim() === '') return setError('请先选择或填写模型 ID')
    setWorking('test')
    setError(null)
    try {
      const currentFingerprint = fingerprint
      const result = await api.testDraft({
      ...strictDraft(), capability, model: model.trim(),
        ...(secondaryModel.trim() === '' ? {} : { secondaryModel: secondaryModel.trim() }),
        ...(voiceId.trim() === '' ? {} : { voiceId: voiceId.trim() }),
        ...(currentVoiceSettings() === undefined ? {} : { voiceSettings: currentVoiceSettings() }),
        ...(testImage === undefined ? {} : { dataUrl: testImage }),
      })
      setTestResult(result)
      setTestedFingerprint(currentFingerprint)
      if (!result.ok) setError(result.error)
    } catch (cause) {
      setError(toMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  async function save(): Promise<void> {
    if (!canSave || testResult === null) return
    setWorking('save')
    setError(null)
    try {
      const headers = parseHeaders(headersText)
      let targetId = profileId
      if (profileId === '__new__') {
        if (connectionName.trim() === '') throw new Error('新连接需要填写名称')
        const created = await api.createProvider({
          name: connectionName.trim(), provider: providerKind, baseUrl: baseUrl.trim(), modelMap: modelMap(capability, model.trim(), secondaryModel.trim(), voiceId.trim(), currentVoiceSettings()),
          ...(headers === undefined ? {} : { headers }),
        })
        targetId = created.id
      } else {
        const current = availableProfiles.find((profile) => profile.id === profileId)
        if (current === undefined) throw new Error('选择的连接已不存在')
        if (current.provider !== providerKind) throw new Error('不能在已有连接上切换 Provider 类型，请新建连接')
        await api.updateProvider(profileId, {
          baseUrl: baseUrl.trim(),
          modelMap: { ...current.modelMap, ...modelMap(capability, model.trim(), secondaryModel.trim(), voiceId.trim(), currentVoiceSettings()) },
          ...(headers === undefined ? {} : { headers }),
        })
      }
      if (apiKey.trim() !== '') await api.setProviderSecret(targetId, apiKey.trim())
      await api.saveCapabilityBinding({
        capability,
        profileId: targetId,
        model: model.trim(),
        secondaryModel: secondaryModel.trim() === '' ? null : secondaryModel.trim(),
        lastTestedAt: testResult.testedAt,
        lastLatencyMs: testResult.latencyMs,
        lastError: testResult.error,
      })
      setProfileId(targetId)
      setApiKey('')
      onChanged()
    } catch (cause) {
      setError(toMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  function restore(): void {
    const profile = availableProfiles.find((item) => item.id === binding?.profileId) ?? availableProfiles[0]
    setProfileId(profile?.id ?? '__new__')
    setProviderKind(profile?.provider ?? 'openai-compat')
    setBaseUrl(profile?.baseUrl ?? '')
    setModel(binding?.model ?? '')
    setSecondaryModel(binding?.secondaryModel ?? '')
    setVoiceId(capability === 'voice' ? profile?.modelMap.voice ?? '' : '')
    setVoiceStability(String(profile?.modelMap.voiceSettings?.stability ?? 0.5))
    setVoiceSimilarity(String(profile?.modelMap.voiceSettings?.similarityBoost ?? 0.75))
    setVoiceStyle(String(profile?.modelMap.voiceSettings?.style ?? 0))
    setVoiceSpeakerBoost(profile?.modelMap.voiceSettings?.useSpeakerBoost ?? true)
    setVoiceSpeed(String(profile?.modelMap.voiceSettings?.speed ?? 1))
    setConnectionName('')
    setApiKey('')
    setHeadersText('')
    setHeaderRows([])
    setVoices([])
    setVoiceResult(null)
    setTestResult(null)
    setTestedFingerprint(null)
    setError(null)
  }

  async function readTestImage(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (file === undefined) return setTestImage(undefined)
    const reader = new FileReader()
    reader.onload = () => setTestImage(typeof reader.result === 'string' ? reader.result : undefined)
    reader.readAsDataURL(file)
  }

  function syncHeaderRows(next: HeaderRow[]): void {
    setHeaderRows(next)
    const headers = Object.fromEntries(next
      .map((row) => [row.key.trim(), row.value])
      .filter(([key]) => key !== ''))
    setHeadersText(Object.keys(headers).length === 0 ? '' : JSON.stringify(headers, null, 2))
  }

  function addHeaderRow(): void {
    const id = nextHeaderId.current++
    syncHeaderRows([...headerRows, { id, key: '', value: '' }])
  }

  function updateHeaderRow(id: number, field: 'key' | 'value', value: string): void {
    syncHeaderRows(headerRows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  }

  function removeHeaderRow(id: number): void {
    syncHeaderRows(headerRows.filter((row) => row.id !== id))
  }

  function applyHeadersJson(): void {
    try {
      const parsed = parseHeaders(headersText) ?? {}
      syncHeaderRows(Object.entries(parsed).map(([key, value]) => ({ id: nextHeaderId.current++, key, value })))
      setError(null)
    } catch (cause) {
      setError(toMessage(cause))
    }
  }

  return (
    <article className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface-solid)' }} data-testid={`provider-card-${capability}`}>
      <button
        type="button"
        className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid={`provider-card-toggle-${capability}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{meta.title}</span>
          <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-secondary)' }}>{meta.note}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full px-2 py-1 text-xs" style={{ background: binding?.lastError == null && binding?.lastTestedAt != null ? 'var(--bg-subtle)' : 'var(--bg-base)', color: binding?.lastError == null && binding?.lastTestedAt != null ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>
            {binding?.lastTestedAt == null ? '未连接' : binding.lastError === null ? '已连接' : '连接失败'}
          </span>
          <IconChevronDown size={18} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />
        </span>
      </button>

      {expanded && <div id={panelId} data-testid={`provider-card-panel-${capability}`}>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Provider 类型{capability === 'voice' || capability === 'chat' ? <select className={INPUT} style={INPUT_STYLE} value={providerKind} onChange={(event) => { const next = event.target.value as LlmProviderKind; setProviderKind(next); if (next === 'elevenlabs') { setBaseUrl('https://api.elevenlabs.io/v1'); setModel('eleven_multilingual_v2'); setVoiceStability('0.5'); setVoiceSimilarity('0.75'); setVoiceStyle('0'); setVoiceSpeakerBoost(true); setVoiceSpeed('1') } else if (next === 'codex-subscription') { setBaseUrl('codex://local'); setApiKey(''); } setVoices([]); setVoiceResult(null); setTestResult(null); setTestedFingerprint(null) }}><option value="openai-compat">OpenAI-compatible</option>{capability === 'voice' && <option value="elevenlabs">ElevenLabs（原生 TTS）</option>}{capability === 'chat' && <option value="codex-subscription">Codex Subscription（实验性）</option>}</select> : <input className={INPUT} style={INPUT_STYLE} value="OpenAI-compatible" disabled />}</label>
        <label className="text-xs">连接<select className={INPUT} style={INPUT_STYLE} value={profileId} onChange={(event) => selectProfile(event.target.value)}><option value="__new__">+ 新建连接</option>{availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        {profileId === '__new__' && <label className="text-xs">连接名称<input className={INPUT} style={INPUT_STYLE} value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="例如：OpenAI 语音" /></label>}
        <label className="text-xs">Base URL<input className={INPUT} style={INPUT_STYLE} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={providerKind === 'elevenlabs' ? 'https://api.elevenlabs.io/v1' : providerKind === 'codex-subscription' ? 'codex://local' : 'https://api.openai.com/v1'} /></label>
        <label className="text-xs">API Key<input className={INPUT} style={INPUT_STYLE} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected?.hasKey === true ? '已保存；留空沿用' : '粘贴密钥（本地服务可留空）'} /></label>
        <div className="text-xs sm:col-span-2" data-testid={`provider-headers-${capability}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span>自定义 Headers（可选）</span>
            <button type="button" className="rounded border px-2 py-1 text-xs" onClick={addHeaderRow}>添加 Header</button>
          </div>
          {selected?.headerNames.length ? <p className="mb-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>已保存：{selected.headerNames.join('、')}；新增或覆盖时只需填写同名 Header。</p> : null}
          <div className="flex flex-col gap-2" data-testid={`provider-header-editor-${capability}`}>
            {headerRows.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>暂无草稿 Header，可直接添加；已有 Header 不会在页面上回显密钥值。</p>}
            {headerRows.map((row, index) => <div className="flex items-center gap-2" key={row.id}>
              <input className={`${INPUT} min-w-0 flex-1`} style={INPUT_STYLE} value={row.key} onChange={(event) => updateHeaderRow(row.id, 'key', event.target.value)} placeholder="Header 名称" aria-label={`Header 名称 ${index + 1}`} />
              <input className={`${INPUT} min-w-0 flex-1`} style={INPUT_STYLE} value={row.value} onChange={(event) => updateHeaderRow(row.id, 'value', event.target.value)} placeholder="Header 值" aria-label={`Header 值 ${index + 1}`} />
              <button type="button" className="rounded border px-2 py-2 text-xs" onClick={() => removeHeaderRow(row.id)} aria-label={`删除 Header ${index + 1}`}>删除</button>
            </div>)}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--text-secondary)' }}>高级 JSON（兼容已有配置）</summary>
            <textarea className={`${INPUT} mt-1`} style={INPUT_STYLE} value={headersText} onChange={(event) => setHeadersText(event.target.value)} placeholder={selected?.headerNames.length ? '留空沿用已保存值' : '{"X-Header":"value"}'} rows={2} />
            <button type="button" className="mt-1 rounded border px-2 py-1 text-[11px]" onClick={applyHeadersJson}>应用到键值编辑器</button>
          </details>
        </div>
        <label className="text-xs">{meta.model}<input className={INPUT} style={INPUT_STYLE} list={`models-${capability}`} value={model} onChange={(event) => setModel(event.target.value)} placeholder="可拉取，也可手填模型 ID" /><datalist id={`models-${capability}`}>{models.map((item) => <option key={item} value={item} />)}</datalist>{models.length > 0 && <select className={`${INPUT} mt-2`} style={INPUT_STYLE} data-testid={`provider-model-select-${capability}`} value={models.includes(model) ? model : ''} onChange={(event) => { if (event.target.value !== '') setModel(event.target.value) }} aria-label="已拉取模型"><option value="">从已拉取列表选择</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select>}</label>
        {capability === 'voice' && providerKind === 'elevenlabs' && <label className="text-xs">Voice ID<input className={INPUT} style={INPUT_STYLE} value={voiceId} onChange={(event) => setVoiceId(event.target.value)} placeholder="例如：21m00Tcm4TlvDq8ikWAM" />{voices.length > 0 && <select className={INPUT} style={INPUT_STYLE} value={voiceId} onChange={(event) => setVoiceId(event.target.value)} aria-label="已拉取音色"><option value="">从已拉取音色中选择</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.id}{voice.category === null ? '' : ` · ${voice.category}`}</option>)}</select>}</label>}
        {capability === 'voice' && providerKind === 'elevenlabs' && <>
          <label className="text-xs">稳定性（0–1）<input className={INPUT} style={INPUT_STYLE} type="number" min="0" max="1" step="0.05" value={voiceStability} onChange={(event) => setVoiceStability(event.target.value)} /></label>
          <label className="text-xs">相似度（0–1）<input className={INPUT} style={INPUT_STYLE} type="number" min="0" max="1" step="0.05" value={voiceSimilarity} onChange={(event) => setVoiceSimilarity(event.target.value)} /></label>
          <label className="text-xs">风格增强（0–1）<input className={INPUT} style={INPUT_STYLE} type="number" min="0" max="1" step="0.05" value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value)} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={voiceSpeakerBoost} onChange={(event) => setVoiceSpeakerBoost(event.target.checked)} />说话人增强</label>
          <label className="text-xs">语速（0.7–1.2）<input className={INPUT} style={INPUT_STYLE} type="number" min="0.7" max="1.2" step="0.05" value={voiceSpeed} onChange={(event) => setVoiceSpeed(event.target.value)} /></label>
        </>}
        {capability === 'voice' && <label className="text-xs">语音转写模型（可选）<input className={INPUT} style={INPUT_STYLE} value={secondaryModel} onChange={(event) => setSecondaryModel(event.target.value)} placeholder="例如 whisper-1" /></label>}
        {capability === 'vision' && <label className="text-xs sm:col-span-2">测试图片（可选）<input className="mt-1 block text-xs" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void readTestImage(event)} /></label>}
      </div>

      {modelResult !== null && <p className="mt-2 text-xs" style={{ color: modelResult.ok ? 'var(--accent-strong)' : 'var(--danger)' }}>{modelResult.ok ? `已拉取 ${modelResult.models.length} 个模型（${modelResult.latencyMs}ms）` : `${modelResult.errorCategory ?? 'unknown'}：${modelResult.error}`}</p>}
      {voiceResult !== null && <p className="mt-2 text-xs" style={{ color: voiceResult.ok ? 'var(--accent-strong)' : 'var(--danger)' }} data-testid="provider-voices-result">{voiceResult.ok ? `已拉取 ${voiceResult.voices.length} 个音色（${voiceResult.latencyMs}ms）` : `${voiceResult.errorCategory ?? 'unknown'}：${voiceResult.error}`}</p>}
      {testResult !== null && <div className="mt-2 text-xs" style={{ color: testResult.ok ? 'var(--accent-strong)' : 'var(--danger)' }} data-testid={`provider-test-${capability}`}>{testResult.ok ? `真实调用通过（${testResult.latencyMs}ms）` : `${testResult.errorCategory ?? 'unknown'}：${testResult.error}`}{testResult.description !== null && <p>{testResult.description}</p>}{testResult.previewDataUrl !== null && (capability === 'voice' ? <audio className="mt-2 w-full" controls src={testResult.previewDataUrl} /> : <img className="mt-2 max-h-32 rounded-md" src={testResult.previewDataUrl} alt="能力测试预览" />)}</div>}
      {error !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy || working !== null || baseUrl.trim() === ''} onClick={() => void pullModels()}>{working === 'models' ? '拉取中…' : '拉取模型'}</button>
        {capability === 'voice' && providerKind === 'elevenlabs' && <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy || working !== null || baseUrl.trim() === ''} onClick={() => void pullVoices()}>{working === 'voices' ? '拉取中…' : '拉取音色'}</button>}
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy || working !== null || baseUrl.trim() === '' || model.trim() === ''} onClick={() => void test()}>{working === 'test' ? '测试中…' : '测试连接'}</button>
        <button type="button" className="rounded-md px-3 py-1.5 text-xs" style={{ background: 'var(--accent-strong)', color: 'var(--accent-on-strong)', opacity: canSave ? 1 : 0.5 }} disabled={busy || working !== null || !canSave} onClick={() => void save()}>{working === 'save' ? '保存中…' : '保存'}</button>
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={working !== null} onClick={restore}>恢复上次保存</button>
      </div>
      {!canSave && testResult?.ok !== true && <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>真实能力测试通过后才可保存，避免把仅能列模型的连接当成可用。</p>}
      </div>}
    </article>
  )
}
