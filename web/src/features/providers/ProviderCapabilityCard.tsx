import { useMemo, useState, type ChangeEvent } from 'react'
import type {
  ApiProfileModelMap,
  ApiProfilePublic,
  ProviderCapability,
  ProviderCapabilityBinding,
  ProviderDraftInput,
  ProviderDraftModelsResult,
  ProviderDraftTestResult,
  LlmProviderKind,
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

function modelMap(capability: ProviderCapability, model: string, secondaryModel: string, voiceId: string): ApiProfileModelMap {
  if (capability === 'chat') return { chat: model }
  if (capability === 'voice') return { tts: model, ...(voiceId === '' ? {} : { voice: voiceId }), ...(secondaryModel === '' ? {} : { transcription: secondaryModel }) }
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

interface Props {
  capability: ProviderCapability
  profiles: ApiProfilePublic[]
  binding?: ProviderCapabilityBinding
  busy: boolean
  onChanged: () => void
}

export function ProviderCapabilityCard({ capability, profiles, binding, busy, onChanged }: Props) {
  const availableProfiles = capability === 'voice' ? profiles : profiles.filter((profile) => profile.provider === 'openai-compat')
  const initialProfile = availableProfiles.find((profile) => profile.id === binding?.profileId) ?? availableProfiles[0]
  const [profileId, setProfileId] = useState(initialProfile?.id ?? '__new__')
  const [providerKind, setProviderKind] = useState<LlmProviderKind>(capability === 'voice' ? initialProfile?.provider ?? 'openai-compat' : 'openai-compat')
  const [connectionName, setConnectionName] = useState('')
  const [baseUrl, setBaseUrl] = useState(initialProfile?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [model, setModel] = useState(binding?.model ?? '')
  const [secondaryModel, setSecondaryModel] = useState(binding?.secondaryModel ?? '')
  const [voiceId, setVoiceId] = useState(capability === 'voice' ? initialProfile?.modelMap.voice ?? '' : '')
  const [models, setModels] = useState<string[]>([])
  const [modelResult, setModelResult] = useState<ProviderDraftModelsResult | null>(null)
  const [testResult, setTestResult] = useState<ProviderDraftTestResult | null>(null)
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null)
  const [testImage, setTestImage] = useState<string | undefined>()
  const [working, setWorking] = useState<'models' | 'test' | 'save' | null>(null)
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

  const fingerprint = JSON.stringify({ draft, capability, model: model.trim(), secondaryModel: secondaryModel.trim(), voiceId: voiceId.trim(), testImage })
  const canSave = testResult?.ok === true && testedFingerprint === fingerprint && model.trim() !== '' && baseUrl.trim() !== '' && (capability !== 'voice' || providerKind !== 'elevenlabs' || voiceId.trim() !== '')

  function selectProfile(next: string): void {
    setProfileId(next)
    const profile = availableProfiles.find((item) => item.id === next)
    setProviderKind(capability === 'voice' ? profile?.provider ?? 'openai-compat' : 'openai-compat')
    setBaseUrl(profile?.baseUrl ?? '')
    setModel(capability === 'voice' ? profile?.modelMap.tts ?? '' : profile?.modelMap[capability] ?? '')
    setSecondaryModel(capability === 'voice' ? profile?.modelMap.transcription ?? '' : '')
    setVoiceId(capability === 'voice' ? profile?.modelMap.voice ?? '' : '')
    setConnectionName('')
    setApiKey('')
    setHeadersText('')
    setModels([])
    setModelResult(null)
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
          name: connectionName.trim(), provider: providerKind, baseUrl: baseUrl.trim(), modelMap: modelMap(capability, model.trim(), secondaryModel.trim(), voiceId.trim()),
          ...(headers === undefined ? {} : { headers }),
        })
        targetId = created.id
      } else {
        const current = availableProfiles.find((profile) => profile.id === profileId)
        if (current === undefined) throw new Error('选择的连接已不存在')
        if (current.provider !== providerKind) throw new Error('不能在已有连接上切换 Provider 类型，请新建连接')
        await api.updateProvider(profileId, {
          baseUrl: baseUrl.trim(),
          modelMap: { ...current.modelMap, ...modelMap(capability, model.trim(), secondaryModel.trim(), voiceId.trim()) },
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
    setProviderKind(capability === 'voice' ? profile?.provider ?? 'openai-compat' : 'openai-compat')
    setBaseUrl(profile?.baseUrl ?? '')
    setModel(binding?.model ?? '')
    setSecondaryModel(binding?.secondaryModel ?? '')
    setVoiceId(capability === 'voice' ? profile?.modelMap.voice ?? '' : '')
    setConnectionName('')
    setApiKey('')
    setHeadersText('')
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
        <label className="text-xs">Provider 类型{capability === 'voice' ? <select className={INPUT} style={INPUT_STYLE} value={providerKind} onChange={(event) => { const next = event.target.value as LlmProviderKind; setProviderKind(next); if (next === 'elevenlabs' && baseUrl.trim() === '') setBaseUrl('https://api.elevenlabs.io/v1'); if (next === 'elevenlabs' && model.trim() === '') setModel('eleven_multilingual_v2'); setTestResult(null); setTestedFingerprint(null) }}><option value="openai-compat">OpenAI-compatible</option><option value="elevenlabs">ElevenLabs（原生 TTS）</option></select> : <input className={INPUT} style={INPUT_STYLE} value="OpenAI-compatible" disabled />}</label>
        <label className="text-xs">连接<select className={INPUT} style={INPUT_STYLE} value={profileId} onChange={(event) => selectProfile(event.target.value)}><option value="__new__">+ 新建连接</option>{availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        {profileId === '__new__' && <label className="text-xs">连接名称<input className={INPUT} style={INPUT_STYLE} value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="例如：OpenAI 语音" /></label>}
        <label className="text-xs">Base URL<input className={INPUT} style={INPUT_STYLE} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={providerKind === 'elevenlabs' ? 'https://api.elevenlabs.io/v1' : 'https://api.openai.com/v1'} /></label>
        <label className="text-xs">API Key<input className={INPUT} style={INPUT_STYLE} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected?.hasKey === true ? '已保存；留空沿用' : '粘贴密钥（本地服务可留空）'} /></label>
        <label className="text-xs sm:col-span-2">自定义 Headers（JSON，可选）<textarea className={INPUT} style={INPUT_STYLE} value={headersText} onChange={(event) => setHeadersText(event.target.value)} placeholder={selected?.headerNames.length ? `已保存：${selected.headerNames.join('、')}；留空沿用` : '{"X-Header":"value"}'} rows={2} /></label>
        <label className="text-xs">{meta.model}<input className={INPUT} style={INPUT_STYLE} list={`models-${capability}`} value={model} onChange={(event) => setModel(event.target.value)} placeholder="可拉取，也可手填模型 ID" /><datalist id={`models-${capability}`}>{models.map((item) => <option key={item} value={item} />)}</datalist></label>
        {capability === 'voice' && providerKind === 'elevenlabs' && <label className="text-xs">Voice ID<input className={INPUT} style={INPUT_STYLE} value={voiceId} onChange={(event) => setVoiceId(event.target.value)} placeholder="例如：21m00Tcm4TlvDq8ikWAM" /></label>}
        {capability === 'voice' && <label className="text-xs">语音转写模型（可选）<input className={INPUT} style={INPUT_STYLE} value={secondaryModel} onChange={(event) => setSecondaryModel(event.target.value)} placeholder="例如 whisper-1" /></label>}
        {capability === 'vision' && <label className="text-xs sm:col-span-2">测试图片（可选）<input className="mt-1 block text-xs" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void readTestImage(event)} /></label>}
      </div>

      {modelResult !== null && <p className="mt-2 text-xs" style={{ color: modelResult.ok ? 'var(--accent-strong)' : 'var(--danger)' }}>{modelResult.ok ? `已拉取 ${modelResult.models.length} 个模型（${modelResult.latencyMs}ms）` : `${modelResult.errorCategory ?? 'unknown'}：${modelResult.error}`}</p>}
      {testResult !== null && <div className="mt-2 text-xs" style={{ color: testResult.ok ? 'var(--accent-strong)' : 'var(--danger)' }} data-testid={`provider-test-${capability}`}>{testResult.ok ? `真实调用通过（${testResult.latencyMs}ms）` : `${testResult.errorCategory ?? 'unknown'}：${testResult.error}`}{testResult.description !== null && <p>{testResult.description}</p>}{testResult.previewDataUrl !== null && (capability === 'voice' ? <audio className="mt-2 w-full" controls src={testResult.previewDataUrl} /> : <img className="mt-2 max-h-32 rounded-md" src={testResult.previewDataUrl} alt="能力测试预览" />)}</div>}
      {error !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy || working !== null || baseUrl.trim() === ''} onClick={() => void pullModels()}>{working === 'models' ? '拉取中…' : '拉取模型'}</button>
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={busy || working !== null || baseUrl.trim() === '' || model.trim() === ''} onClick={() => void test()}>{working === 'test' ? '测试中…' : '测试连接'}</button>
        <button type="button" className="rounded-md px-3 py-1.5 text-xs" style={{ background: 'var(--accent-strong)', color: 'var(--accent-on-strong)', opacity: canSave ? 1 : 0.5 }} disabled={busy || working !== null || !canSave} onClick={() => void save()}>{working === 'save' ? '保存中…' : '保存'}</button>
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={working !== null} onClick={restore}>恢复上次保存</button>
      </div>
      {!canSave && testResult?.ok !== true && <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>真实能力测试通过后才可保存，避免把仅能列模型的连接当成可用。</p>}
      </div>}
    </article>
  )
}
