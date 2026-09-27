import { useEffect, useState, type FormEvent } from 'react'
import type { BubbleMode, ChatContextCompressionState, ChatSession } from '@shared/types'
import type { ChatSessionSettingsInput } from '../../db/chat'
import { useChatDisplay } from '../../app/useChatDisplay'
import { exportSessionJson, exportSessionMarkdown } from '../../lib/exportSession'

const FIELD_CLASS = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none'
const FIELD_STYLE = {
  borderColor: 'var(--border-soft)',
  color: 'var(--text-primary)',
} as const

const BACKGROUNDS = [
  { value: '', label: '跟随主题' },
  { value: '#f7f2e8', label: '暖杏' },
  { value: '#edf4f1', label: '雾青' },
  { value: '#eef0f6', label: '薄暮' },
] as const

export function ChatSettingsSheet({
  session,
  saving,
  contextMessageCount,
  contextTokenEstimate,
  contextState,
  compacting,
  onClose,
  onSave,
  onCompact,
  onEditSummary,
  onSetSummaryActive,
}: {
  session: ChatSession
  saving: boolean
  contextMessageCount: number
  contextTokenEstimate: number
  contextState: ChatContextCompressionState
  compacting: boolean
  onClose: () => void
  onSave: (input: ChatSessionSettingsInput) => Promise<void>
  onCompact: () => void
  onEditSummary: (summaryId: string, text: string) => void
  onSetSummaryActive: (summaryId: string | null) => void
}) {
  const [remark, setRemark] = useState(session.remark ?? '')
  const [background, setBackground] = useState(session.background ?? '')
  const [bubbleMode, setBubbleMode] = useState<BubbleMode>(session.bubbleMode)

  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const activeSummary = contextState.versions.find((item) => item.id === contextState.activeSummaryId) ?? null
  const [editedSummary, setEditedSummary] = useState(activeSummary?.text ?? '')

  useEffect(() => {
    setEditedSummary(activeSummary?.text ?? '')
  }, [activeSummary?.id, activeSummary?.text])

  /** 全局显示偏好：不在表单里、不随「保存」提交 —— 点一下立刻生效（SPEC §9.1.3） */
  const showCompanionAvatar = useChatDisplay((state) => state.showCompanionAvatar)
  const showUserAvatar = useChatDisplay((state) => state.showUserAvatar)
  const showNickname = useChatDisplay((state) => state.showNickname)
  const showProviderReasoning = useChatDisplay((state) => state.showProviderReasoning)
  const toggleCompanionAvatar = useChatDisplay((state) => state.toggleCompanionAvatar)
  const toggleUserAvatar = useChatDisplay((state) => state.toggleUserAvatar)
  const toggleNickname = useChatDisplay((state) => state.toggleNickname)
  const toggleProviderReasoning = useChatDisplay((state) => state.toggleProviderReasoning)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await onSave({
      remark: remark.trim() === '' ? null : remark,
      background: background === '' ? null : background,
      bubbleMode,
    })
  }

  /**
   * 导出这段对话。
   *
   * ⚠️ 刻意**不**更新「上次导出备份」的时间：单会话导出不包含日记、相册、账本那些，
   *    拿它当「我备份过了」是错觉 —— 那个提醒只认全量备份。
   */
  async function exportAs(kind: 'markdown' | 'json'): Promise<void> {
    setExporting(true)
    setExportMessage(null)
    try {
      const result = kind === 'markdown'
        ? await exportSessionMarkdown(session.id)
        : await exportSessionJson(session.id)
      setExportMessage(`已导出「${result.title}」，共 ${result.messageCount} 条消息`)
    } catch (err: unknown) {
      setExportMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const busy = saving || compacting

  return (
    <div
      data-testid="chat-settings-backdrop"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-settings-title"
        data-testid="chat-settings-sheet"
        onSubmit={(event) => void submit(event)}
        className="safe-bottom w-full max-w-md rounded-t-2xl border p-4 shadow-xl sm:rounded-2xl"
        style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="chat-settings-title" className="font-semibold">聊天设置</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>上方三项只影响当前会话</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="关闭聊天设置" className="px-2 text-lg disabled:opacity-40">×</button>
        </div>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm" htmlFor="chat-setting-remark">
            <span>会话备注</span>
            <textarea
              id="chat-setting-remark"
              data-testid="chat-setting-remark"
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="记下这段对话的用途（可选）"
              className={`${FIELD_CLASS} resize-none`}
              style={FIELD_STYLE}
            />
          </label>

          <label className="grid gap-1.5 text-sm" htmlFor="chat-setting-background">
            <span>会话背景</span>
            <select
              id="chat-setting-background"
              data-testid="chat-setting-background"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            >
              {BACKGROUNDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="grid gap-1.5 text-sm" htmlFor="chat-setting-bubble-mode">
            <span>气泡模式</span>
            <select
              id="chat-setting-bubble-mode"
              data-testid="chat-setting-bubble-mode"
              value={bubbleMode}
              onChange={(event) => setBubbleMode(event.target.value as BubbleMode)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            >
              <option value="chat">聊天软件式</option>
              <option value="native">AI 原生式</option>
            </select>
          </label>

          {/* 导出这段对话（技术方案 §9 风险7）。放设置面板里而不去挤聊天页 header —— 它是低频动作 */}
          <div className="grid gap-1.5 text-sm">
            <span>导出这段对话</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="chat-export-markdown"
                disabled={exporting}
                onClick={() => void exportAs('markdown')}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: 'var(--border-soft)' }}
              >
                导出为 Markdown
              </button>
              <button
                type="button"
                data-testid="chat-export-json"
                disabled={exporting}
                onClick={() => void exportAs('json')}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: 'var(--border-soft)' }}
              >
                导出为 JSON
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Markdown 能直接读、能贴到别处；JSON 保留完整结构，便于日后迁移。
            </p>
            {exportMessage !== null && (
              <p data-testid="chat-export-message" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {exportMessage}
              </p>
            )}
          </div>

          <div data-testid="context-compression" className="grid gap-2 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="font-medium">上下文压缩</span>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  当前约 {contextMessageCount} 条消息 · 估计 {contextTokenEstimate.toLocaleString()} tokens；原文永不删除，后续回复只会把已启用摘要放在更早历史的位置。
                </p>
              </div>
              <button
                type="button"
                data-testid="context-compact"
                disabled={busy || contextMessageCount < 16}
                onClick={onCompact}
                className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
                style={{ borderColor: 'var(--border-soft)' }}
              >
                {compacting ? '生成中…' : '压缩较早消息'}
              </button>
            </div>

            {activeSummary !== null ? (
              <div className="grid gap-1.5 rounded-lg border p-2.5" style={{ borderColor: 'var(--border-soft)' }}>
                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span>已启用 · 覆盖 {activeSummary.coveredMessageCount} 条 · {new Date(activeSummary.generatedAt).toLocaleDateString()}</span>
                  <button
                    type="button"
                    data-testid="context-disable"
                    disabled={busy}
                    onClick={() => onSetSummaryActive(null)}
                    className="underline disabled:opacity-40"
                  >停用</button>
                </div>
                <textarea
                  data-testid="context-summary-editor"
                  value={editedSummary}
                  onChange={(event) => setEditedSummary(event.target.value)}
                  rows={5}
                  maxLength={12000}
                  className={`${FIELD_CLASS} resize-y text-xs`}
                  style={FIELD_STYLE}
                />
                <button
                  type="button"
                  data-testid="context-summary-save"
                  disabled={busy || editedSummary.trim() === '' || editedSummary.trim() === activeSummary.text}
                  onClick={() => onEditSummary(activeSummary.id, editedSummary)}
                  className="justify-self-end rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
                  style={{ borderColor: 'var(--border-soft)' }}
                >保存摘要修改</button>
              </div>
            ) : (
              <p data-testid="context-summary-inactive" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                当前没有启用摘要；发送时会使用原始消息。
              </p>
            )}

            {contextState.versions.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>摘要版本（{contextState.versions.length}）</summary>
                <div className="mt-1 grid gap-1">
                  {contextState.versions.map((version) => (
                    <button
                      type="button"
                      key={version.id}
                      data-testid={`context-version-${version.id}`}
                      disabled={busy || version.id === contextState.activeSummaryId}
                      onClick={() => onSetSummaryActive(version.id)}
                      className="flex items-center justify-between rounded border px-2 py-1 text-left disabled:opacity-50"
                      style={{ borderColor: 'var(--border-soft)' }}
                    >
                      <span>v{version.version} · {new Date(version.updatedAt).toLocaleString()} · {version.source === 'edited' ? '手动修改' : '模型生成'}</span>
                      <span>{version.id === contextState.activeSummaryId ? '当前' : '恢复'}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              压缩失败会保留原始上下文，不会影响发送；摘要和最近原始消息会明确分隔。
            </p>
          </div>
        </div>

        {/*
          全局显示偏好（SPEC §9.1.3）。刻意**与上方三项分开、也不参与本表单的提交**：
          它们属于所有会话，跟「点了保存才生效」的语义不同 —— 混进同一个提交里，
          用户会以为「不点保存就不算数」。
          三个开关互相独立：小栖头像 / 我的头像 / 昵称 —— 关掉一侧不该连累另一侧。
          内容（图片、称呼）在设置页「身份」区配置，这里只管「显示不显示」。
        */}
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
          {([
            { label: '小栖头像', value: showCompanionAvatar, toggle: toggleCompanionAvatar, testId: 'chat-setting-companion-avatar' },
            { label: '我的头像', value: showUserAvatar, toggle: toggleUserAvatar, testId: 'chat-setting-user-avatar' },
            { label: '气泡昵称', value: showNickname, toggle: toggleNickname, testId: 'chat-setting-nickname' },
            { label: 'Provider reasoning（高级）', value: showProviderReasoning, toggle: toggleProviderReasoning, testId: 'chat-setting-provider-reasoning' },
          ]).map((row) => (
            <div key={row.testId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span>{row.label}</span>
              <button
                type="button"
                data-testid={row.testId}
                aria-pressed={row.value}
                onClick={row.toggle}
                className="rounded-full border px-4 py-1 text-sm"
                style={{ borderColor: 'var(--border-soft)' }}
              >
                {row.value ? '显示' : '隐藏'}
              </button>
            </div>
          ))}
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            影响所有会话，点了立刻生效（不用点保存）。Provider reasoning 是供应商诊断信息，不等同于小栖公开思绪。
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm disabled:opacity-40">取消</button>
          <button
            type="submit"
            data-testid="chat-settings-save"
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
