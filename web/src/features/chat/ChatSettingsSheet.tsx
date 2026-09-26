import { useState, type FormEvent } from 'react'
import type { BubbleMode, ChatSession } from '@shared/types'
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
  onClose,
  onSave,
}: {
  session: ChatSession
  saving: boolean
  onClose: () => void
  onSave: (input: ChatSessionSettingsInput) => Promise<void>
}) {
  const [remark, setRemark] = useState(session.remark ?? '')
  const [background, setBackground] = useState(session.background ?? '')
  const [bubbleMode, setBubbleMode] = useState<BubbleMode>(session.bubbleMode)

  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  /** 全局显示偏好：不在表单里、不随「保存」提交 —— 点一下立刻生效（SPEC §9.1.3） */
  const showCompanionAvatar = useChatDisplay((state) => state.showCompanionAvatar)
  const showUserAvatar = useChatDisplay((state) => state.showUserAvatar)
  const showNickname = useChatDisplay((state) => state.showNickname)
  const toggleCompanionAvatar = useChatDisplay((state) => state.toggleCompanionAvatar)
  const toggleUserAvatar = useChatDisplay((state) => state.toggleUserAvatar)
  const toggleNickname = useChatDisplay((state) => state.toggleNickname)

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

  return (
    <div
      data-testid="chat-settings-backdrop"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
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
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭聊天设置" className="px-2 text-lg disabled:opacity-40">×</button>
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
            影响所有会话，点了立刻生效（不用点保存）。头像与称呼在设置页「身份」里配置。
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm disabled:opacity-40">取消</button>
          <button
            type="submit"
            data-testid="chat-settings-save"
            disabled={saving}
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
