/**
 * 命名弹层（SPEC §2.1.3 / §3.5.4 / §3.7.3）：**创建**与**重命名**共用一份，
 * 会话分组 / 收藏分类 / 相册三处共用同一套行为 —— 三处的名称规则、空值校验、
 * 长度上限本来就是同一条，各写一份的下场是「分组能建 30 字、分类只能建 20 字」。
 *
 * 为什么不用原生 `prompt`：它会阻塞页面（验收脚本一跑就卡住），
 * 而且样式、长度限制、空值校验都不可控。项目里删除会话的确认也出于同样理由自己实现。
 */
import { useState, type FormEvent } from 'react'

export function NameSheet({
  title,
  fieldLabel,
  hint,
  initialName,
  maxLength,
  saving,
  onClose,
  onSubmit,
}: {
  title: string
  /** 输入项的标签，同时决定 placeholder（如「分组名称」） */
  fieldLabel: string
  /** 副标题：一句话交代后果（「删分组不会删除会话，组内会话会回到未分组」） */
  hint: string
  /** 创建时传空串 */
  initialName: string
  maxLength: number
  saving: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (trimmed === '' || saving) return
    await onSubmit(trimmed)
  }

  return (
    <div
      data-testid="name-sheet-backdrop"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-sheet-title"
        data-testid="name-sheet"
        onSubmit={(event) => void submit(event)}
        className="safe-bottom w-full max-w-md rounded-t-2xl border p-4 shadow-xl sm:rounded-2xl"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="name-sheet-title" className="font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-dim)' }}>{hint}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={`关闭${title}`}
            data-testid="name-sheet-cancel"
            className="px-2 text-lg disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <label className="grid gap-1.5 text-sm" htmlFor="name-sheet-input">
          <span>{fieldLabel}</span>
          <input
            id="name-sheet-input"
            data-testid="name-sheet-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={maxLength}
            placeholder={`最多 ${maxLength} 字`}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm disabled:opacity-40">
            取消
          </button>
          <button
            type="submit"
            data-testid="name-sheet-save"
            disabled={saving || trimmed === ''}
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
