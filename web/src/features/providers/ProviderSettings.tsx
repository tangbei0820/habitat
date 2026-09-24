/**
 * 设置页的「API 方案」区块：列表 + 行内表单。
 *
 * 交互取舍：
 * - **行内展开**而不是弹窗 —— 移动端弹窗要处理滚动锁、焦点陷阱、层叠顺序，收益却只是「看起来更高级」
 * - **删除用两步确认**而不用 `window.confirm` —— 原生弹窗会阻塞页面、在无头浏览器里还得额外处理，
 *   而「点一次变『确认删除？』」既够拦住误触，又能被自动化验收直接驱动
 */
import { useState, type ComponentType, type ReactNode } from 'react'
import type { ApiKeySource, ApiProfileCreateInput, ApiProfilePublic, LlmProbeResult } from '@shared/types'
import { IconAlert, IconCheck, IconClose, IconKey, type IconProps } from '../../components/qixi/Icons'
import { ProviderForm } from './ProviderForm'
import { useProviders } from './useProviders'
import { useOnlineStatus } from '../offline/useOnlineStatus'

const LABEL_STYLE = { color: 'var(--color-text-dim)' } as const
const SECTION_STYLE = {
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
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
        borderColor: danger ? 'var(--color-danger)' : 'var(--color-border)',
        color: danger ? 'var(--color-danger)' : 'var(--color-text)',
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
    <li className="rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{profile.name}</span>
        {profile.isActive && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}
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
        style={{ color: profile.keySource === 'missing' ? 'var(--color-danger)' : 'var(--color-text-dim)' }}
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
          style={{ color: probe.ok ? 'var(--color-primary)' : 'var(--color-danger)' }}
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

  async function handleCreate(input: ApiProfileCreateInput, secret: string | null): Promise<void> {
    if (await ctrl.create(input, secret)) setCreating(false)
  }

  return (
    <section className="mb-4 rounded-lg border p-4" style={SECTION_STYLE}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={LABEL_STYLE}>
          API 方案
        </h2>
        <button
          type="button"
          className="rounded-full border px-3 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={() => {
            setCreating((value) => !value)
            setEditingId(null)
          }}
        >
          {creating ? '收起' : '+ 新建'}
        </button>
      </div>

      {ctrl.error !== null && (
        <p className="mb-2 flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-danger)' }}>
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
  )
}
