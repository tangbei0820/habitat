import { useState, type FormEvent } from 'react'
import type { BubbleMode, ChatSession } from '@shared/types'
import type { ChatSessionSettingsInput } from '../../db/chat'

const FIELD_CLASS = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none'
const FIELD_STYLE = {
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
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

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await onSave({
      remark: remark.trim() === '' ? null : remark,
      background: background === '' ? null : background,
      bubbleMode,
    })
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
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="chat-settings-title" className="font-semibold">聊天设置</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-dim)' }}>只影响当前会话</p>
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
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm disabled:opacity-40">取消</button>
          <button
            type="submit"
            data-testid="chat-settings-save"
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)' }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
