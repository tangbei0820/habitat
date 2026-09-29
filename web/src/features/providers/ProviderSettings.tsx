/**
 * 设置页的「API 方案」区块：列表 + 行内表单。
 *
 * 交互取舍：
 * - **行内展开**而不是弹窗 —— 移动端弹窗要处理滚动锁、焦点陷阱、层叠顺序，收益却只是「看起来更高级」
 * - **删除用两步确认**而不用 `window.confirm` —— 原生弹窗会阻塞页面、在无头浏览器里还得额外处理，
 *   而「点一次变『确认删除？』」既够拦住误触，又能被自动化验收直接驱动
 */
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import type { ApiKeySource, ApiProfileCreateInput, ApiProfilePublic, LlmProbeResult, ProviderCenterState } from '@shared/types'
import { IconAlert, IconCheck, IconClose, IconKey, type IconProps } from '../../components/qixi/Icons'
import { ProviderForm } from './ProviderForm'
import { ProviderCapabilityCard } from './ProviderCapabilityCard'
import { useProviders } from './useProviders'
import { useOnlineStatus } from '../offline/useOnlineStatus'
import * as api from './api'
import { ApiRequestError } from '../../lib/api'

const LABEL_STYLE = { color: 'var(--text-secondary)' } as const
const SECTION_STYLE = {
  borderColor: 'var(--border-soft)',
  backgroundColor: 'var(--bg-surface-solid)',
} as const

/**
 * 凭据状态的用户可见文案。用 `keySource` 而不是 `hasKey`，才能把「无需密钥」与「已配好」分开说。
 *
 * ⚠️ 图标与文字分开存：拼进字符串（`'🔑 ' + 文案`）就没法换成 SVG，
 * 而验收脚本是对着**文字**断言的 —— 图标跟着文字一起变会连带把断言搞挂。
 */
const KEY_TEXT: Record<ApiKeySource, { text: string; Icon: ComponentType<IconProps> | null }> = {
  stored: { text: '密钥已保存', Icon: IconKey },
  env: { text: '密钥来自环境变量', Icon: IconKey },
  missing: { text: '缺密钥，现在调不通', Icon: IconAlert },
  'not-required': { text: '无需密钥', Icon: null },
}

interface RowButtonProps {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

function RowButton({ children, onClick, disabled = false, danger = false }: RowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border px-2 py-1 text-xs"
      style={{
        borderColor: danger ? 'var(--danger)' : 'var(--border-soft)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

/** 探测结果文案。**只返回文字**：成功 / 失败的图标由视图层按 `ok` 选（不再往字符串里拼 ✓/✗） */
function probeText(probe: LlmProbeResult): string {
  if (!probe.ok) return probe.error ?? '未知原因'
  const models = probe.sampleModels.length > 0 ? ` · ${probe.sampleModels.join(' / ')}` : ''
  return `连接正常（${probe.latencyMs}ms，${probe.modelCount} 个模型）${models}`
}

interface ProviderRowProps {
  profile: ApiProfilePublic
  probe: LlmProbeResult | undefined
  probing: boolean
  busy: boolean
  confirmingDelete: boolean
  onTest: () => void
  onEdit: () => void
  onActivate: () => void
  onClearKey: () => void
  /** 进入「确认删除？」状态 */
  onRequestDelete: () => void
  /** 真正删除 */
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function ProviderRow({
  profile,
  probe,
  probing,
  busy,
  confirmingDelete,
  onTest,
  onEdit,
  onActivate,
  onClearKey,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: ProviderRowProps) {
  /** 「测试连接」要打后端探测上游，离线时必然失败 —— 直接禁掉，别让用户白点 */
  const online = useOnlineStatus()
  const keyView = KEY_TEXT[profile.keySource]
  return (
    <li className="rounded-md border p-3" style={{ borderColor: 'var(--border-soft)' }}>
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{profile.name}</span>
        {profile.isActive && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs"
            style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}
          >
            默认
          </span>
        )}
      </div>
      <p className="truncate text-xs" style={LABEL_STYLE}>
        {profile.baseUrl}
      </p>
      <p className="truncate text-xs" style={LABEL_STYLE}>
        模型：{profile.modelMap.chat ?? '（未指定）'}
      </p>
      <p
        className="flex items-center gap-1.5 text-xs"
        style={{ color: profile.keySource === 'missing' ? 'var(--danger)' : 'var(--text-secondary)' }}
      >
        {keyView.Icon !== null && <keyView.Icon size={13} />}
        {keyView.text}
        {profile.keySource === 'env' && profile.keyRef !== '' && (
          <span>（{profile.keyRef}）</span>
        )}
      </p>
      {probe !== undefined && (
        <p
          className="mt-1 flex items-center gap-1.5 text-xs"
          data-testid="provider-probe"
          data-probe-ok={String(probe.ok)}
          style={{ color: probe.ok ? 'var(--accent-strong)' : 'var(--danger)' }}
        >
          {probe.ok ? <IconCheck size={13} /> : <IconClose size={13} />}
          <span>{probeText(probe)}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        <RowButton onClick={onTest} disabled={probing || busy || !online}>
          {probing ? '测试中…' : '测试连接'}
        </RowButton>
        <RowButton onClick={onEdit} disabled={busy}>
          编辑
        </RowButton>
        {!profile.isActive && (
          <RowButton onClick={onActivate} disabled={busy}>
            设为默认
          </RowButton>
        )}
        {profile.keySource === 'stored' && (
          <RowButton onClick={onClearKey} disabled={busy}>
            清除密钥
          </RowButton>
        )}
        {confirmingDelete ? (
          <>
            <RowButton onClick={onConfirmDelete} disabled={busy} danger>
              确认删除？
            </RowButton>
            <RowButton onClick={onCancelDelete} disabled={busy}>
              取消
            </RowButton>
          </>
        ) : (
          <RowButton onClick={onRequestDelete} disabled={busy} danger>
            删除
          </RowButton>
        )}
      </div>
    </li>
  )
}

export function ProviderSettings() {
  const ctrl = useProviders()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [center, setCenter] = useState<ProviderCenterState>({ bindings: [], schemes: [], chatFallback: { enabled: false, profileIds: [], updatedAt: null, source: 'none' } })
  const [centerLoading, setCenterLoading] = useState(true)
  const [centerError, setCenterError] = useState<string | null>(null)
  const [schemeName, setSchemeName] = useState('')
  const [fallbackEnabled, setFallbackEnabled] = useState(false)
  const [fallbackIds, setFallbackIds] = useState<string[]>([])
  const [fallbackSaving, setFallbackSaving] = useState(false)
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null)

  const reloadCenter = useCallback(() => {
    setCenterLoading(true)
    api.getProviderCenter()
      .then((value) => {
        setCenter(value)
        setFallbackEnabled(value.chatFallback.enabled)
        setFallbackIds(value.chatFallback.profileIds)
        setCenterError(null)
      })
      .catch((error: unknown) => setCenterError(error instanceof ApiRequestError ? error.message : String(error)))
      .finally(() => setCenterLoading(false))
  }, [])

  useEffect(() => reloadCenter(), [reloadCenter])

  function changed(): void {
    ctrl.reload()
    reloadCenter()
  }

  async function saveFallback(): Promise<void> {
    setFallbackSaving(true)
    setFallbackMessage(null)
    try {
      const saved = await api.saveChatFallback({ enabled: fallbackEnabled, profileIds: fallbackIds.filter((id) => id !== '') })
      setFallbackEnabled(saved.enabled)
      setFallbackIds(saved.profileIds)
      setFallbackMessage(saved.enabled ? '备用链已保存：仅首个 SSE 内容前失败时切换。' : '备用链已关闭。')
      reloadCenter()
    } catch (error) {
      setFallbackMessage(error instanceof ApiRequestError ? error.message : String(error))
    } finally {
      setFallbackSaving(false)
    }
  }

  const chatProfiles = ctrl.profiles.filter((profile) => profile.provider === 'codex-subscription' || profile.modelMap.chat !== undefined)
  const primaryChatProfileId = center.bindings.find((item) => item.capability === 'chat')?.profileId ?? null

  async function createScheme(): Promise<void> {
    if (schemeName.trim() === '') return
    try {
      await api.createScheme(schemeName.trim())
      setSchemeName('')
      reloadCenter()
    } catch (error) {
      setCenterError(error instanceof ApiRequestError ? error.message : String(error))
    }
  }

  async function handleCreate(input: ApiProfileCreateInput, secret: string | null): Promise<void> {
    if (await ctrl.create(input, secret)) setCreating(false)
  }

  return (
    <div className="mb-4">
      <div className="setting-group-label">Provider Center</div>
      <section className="flex flex-col gap-3" data-testid="provider-center">
        {(['chat', 'voice', 'vision', 'image'] as const).map((capability) => (
          <ProviderCapabilityCard
            key={`${capability}:${center.bindings.find((item) => item.capability === capability)?.updatedAt ?? 'none'}:${ctrl.profiles.length}`}
            capability={capability}
            profiles={ctrl.profiles}
            binding={center.bindings.find((item) => item.capability === capability)}
            busy={ctrl.mutating || centerLoading}
            onChanged={changed}
          />
        ))}
      </section>

      <section className="mt-3 rounded-lg border p-4" style={SECTION_STYLE} data-testid="provider-chat-fallback">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">聊天失败回退</h3>
            <p className="mt-1 text-xs" style={LABEL_STYLE}>主聊天首个内容到达前失败时，按顺序尝试备用连接；流式开始后不会中途切换。</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs">
            <input type="checkbox" checked={fallbackEnabled} onChange={(event) => setFallbackEnabled(event.target.checked)} />启用
          </label>
        </div>
        {center.chatFallback.source === 'environment' && <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>当前沿用环境变量备用连接；保存此处后改由设置页接管。</p>}
        {center.chatFallback.source === 'none' && <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>尚未配置备用连接。没有备用时，主连接失败会直接反馈错误。</p>}
        {primaryChatProfileId !== null && <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>当前主聊天：{ctrl.profiles.find((profile) => profile.id === primaryChatProfileId)?.name ?? primaryChatProfileId}</p>}
        <div className="mt-3 flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <label key={index} className="text-xs">
              <span className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>备用 {index + 1}</span>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-base)' }}
                value={fallbackIds[index] ?? ''}
                onChange={(event) => {
                  const next = [...fallbackIds]
                  while (next.length <= index) next.push('')
                  next[index] = event.target.value
                  setFallbackIds(next.slice(0, 3))
                }}
                disabled={fallbackSaving}
                data-testid={`provider-fallback-${index + 1}`}
              >
                <option value="">不设置</option>
                {chatProfiles.filter((profile) => profile.id !== primaryChatProfileId && !fallbackIds.some((id, itemIndex) => itemIndex !== index && id === profile.id)).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {fallbackMessage !== null && <p className="mt-2 text-xs" style={{ color: fallbackMessage.includes('已保存') || fallbackMessage.includes('已关闭') ? 'var(--accent-strong)' : 'var(--danger)' }}>{fallbackMessage}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-md px-3 py-1.5 text-xs" style={{ background: 'var(--accent-strong)', color: 'var(--accent-on-strong)', opacity: fallbackSaving ? 0.6 : 1 }} disabled={fallbackSaving} onClick={() => void saveFallback()}>{fallbackSaving ? '保存中…' : '保存回退策略'}</button>
          <button type="button" className="rounded-md border px-3 py-1.5 text-xs" disabled={fallbackSaving} onClick={() => { setFallbackEnabled(center.chatFallback.enabled); setFallbackIds(center.chatFallback.profileIds); setFallbackMessage(null) }}>恢复已保存</button>
        </div>
      </section>

      <section className="mt-3 rounded-lg border p-4" style={SECTION_STYLE} data-testid="provider-schemes">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold">四通道方案</h3><p className="text-xs" style={LABEL_STYLE}>一次切换主聊天、语音、识图与生图；密钥不会被复制。</p></div>
        </div>
        <div className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-base)' }} value={schemeName} onChange={(event) => setSchemeName(event.target.value)} placeholder="方案名称" />
          <button type="button" className="rounded-md border px-3 py-2 text-xs" disabled={schemeName.trim() === ''} onClick={() => void createScheme()}>存为方案</button>
        </div>
        {centerError !== null && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{centerError}</p>}
        <ul className="mt-3 flex flex-col gap-2">
          {center.schemes.map((scheme) => (
            <li key={scheme.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-soft)' }}>
              <span className="font-medium">{scheme.name}</span>{scheme.isActive && <span style={{ color: 'var(--accent-strong)' }}>当前</span>}
              <span className="ml-auto flex flex-wrap gap-1">
                {!scheme.isActive && <button type="button" className="rounded border px-2 py-1" onClick={() => void api.activateScheme(scheme.id).then(reloadCenter).catch((error: unknown) => setCenterError(String(error)))}>设为当前</button>}
                <button type="button" className="rounded border px-2 py-1" onClick={() => { const name = window.prompt('新名称', scheme.name); if (name?.trim()) void api.renameScheme(scheme.id, name.trim()).then(reloadCenter).catch((error: unknown) => setCenterError(String(error))) }}>重命名</button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => { const name = window.prompt('副本名称', `${scheme.name} 副本`); if (name?.trim()) void api.copyScheme(scheme.id, name.trim()).then(reloadCenter).catch((error: unknown) => setCenterError(String(error))) }}>复制</button>
                <button type="button" className="rounded border px-2 py-1" style={{ color: 'var(--danger)' }} onClick={() => void api.deleteScheme(scheme.id).then(reloadCenter).catch((error: unknown) => setCenterError(String(error)))}>删除</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-3 rounded-lg border p-4" style={SECTION_STYLE}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={LABEL_STYLE}>
          API 方案
        </h2>
        <button
          type="button"
          className="rounded-full border px-3 py-1 text-xs"
          style={{ borderColor: 'var(--border-soft)' }}
          onClick={() => {
            setCreating((value) => !value)
            setEditingId(null)
          }}
        >
          {creating ? '收起' : '+ 新建'}
        </button>
      </div>

      {ctrl.error !== null && (
        <p className="mb-2 flex items-center gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <IconAlert size={14} />
          <span>{ctrl.error}</span>
        </p>
      )}

      {creating && (
        <ProviderForm
          busy={ctrl.mutating}
          onSubmit={(input, secret) => void handleCreate(input, secret)}
          onCancel={() => setCreating(false)}
        />
      )}

      {ctrl.loading && ctrl.profiles.length === 0 && (
        <p className="text-sm" style={LABEL_STYLE}>
          读取中…
        </p>
      )}

      {!ctrl.loading && ctrl.profiles.length === 0 && !creating && (
        <p className="text-sm" style={LABEL_STYLE}>
          还没有任何方案。点右上「+ 新建」填一个就能开始聊天。
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {ctrl.profiles.map((profile) =>
          editingId === profile.id ? (
            <li key={profile.id}>
              <ProviderForm
                initial={profile}
                busy={ctrl.mutating}
                onSubmit={(input, secret) => {
                  void ctrl.update(profile.id, input, secret).then((ok) => {
                    if (ok) setEditingId(null)
                  })
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <ProviderRow
              key={profile.id}
              profile={profile}
              probe={ctrl.probes[profile.id]}
              probing={ctrl.probingId === profile.id}
              busy={ctrl.mutating}
              confirmingDelete={confirmingId === profile.id}
              onTest={() => void ctrl.test(profile.id)}
              onEdit={() => {
                setEditingId(profile.id)
                setCreating(false)
                setConfirmingId(null)
              }}
              onActivate={() => void ctrl.activate(profile.id)}
              onClearKey={() => void ctrl.clearKey(profile.id)}
              onRequestDelete={() => setConfirmingId(profile.id)}
              onConfirmDelete={() => {
                void ctrl.remove(profile.id).then(() => setConfirmingId(null))
              }}
              onCancelDelete={() => setConfirmingId(null)}
            />
          ),
        )}
      </ul>
      </section>
    </div>
  )
}
