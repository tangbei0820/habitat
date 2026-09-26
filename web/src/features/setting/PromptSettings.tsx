/**
 * 设置页「Prompt 与世界书」区（Phase 7A · SPEC §9.4）。
 *
 * 三件事：人格编辑、本轮 Prompt 查看、世界书管理入口。
 * 世界书的列表管理在独立页（/setting/worldbook）—— 这里只放一个入口，
 * 设置页已经很长，把 CRUD 表格塞进来只会让人找不到北。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PromptView } from '@shared/types'
import {
  clearPersonaPrompt,
  getPromptView,
  savePersonaPrompt,
} from '../../lib/prompt'
import { log } from '../../lib/log'

const PERSONA_MAX = 8_000

export function PromptSettings() {
  const [persona, setPersona] = useState<{ content: string; customized: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<PromptView | null>(null)
  const [viewOpen, setViewOpen] = useState(false)

  const loadPersona = useCallback((): void => {
    getPromptView()
      .then((data) => {
        setPersona(data.persona)
        setError(null)
      })
      .catch((err: unknown) => {
        log.error('读取 Prompt 失败', err)
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(loadPersona, [loadPersona])

  const startEdit = (): void => {
    setDraft(persona?.content ?? '')
    setEditing(true)
  }

  const save = (): void => {
    setSaving(true)
    savePersonaPrompt(draft)
      .then((saved) => {
        setPersona(saved)
        setEditing(false)
        setView(null) // 注入内容变了，已展开的查看结果就作废，下次重新拉
        setError(null)
      })
      .catch((err: unknown) => {
        log.error('保存人格失败', err)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setSaving(false))
  }

  const reset = (): void => {
    setSaving(true)
    clearPersonaPrompt()
      .then((saved) => {
        setPersona(saved)
        setEditing(false)
        setView(null)
        setError(null)
      })
      .catch((err: unknown) => {
        log.error('恢复默认人格失败', err)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setSaving(false))
  }

  const toggleView = (): void => {
    if (viewOpen) {
      setViewOpen(false)
      return
    }
    getPromptView()
      .then((data) => {
        setView(data)
        setPersona(data.persona)
        setViewOpen(true)
        setError(null)
      })
      .catch((err: unknown) => {
        log.error('读取本轮 Prompt 失败', err)
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  return (
    <div className="setting-group-label" style={{ marginTop: 18 }}>
      <span data-testid="prompt-group">Prompt 与世界书</span>
      <section className="setting-group" style={{ marginTop: 8 }}>
        {/* 人格 Prompt（SPEC §9.4.1） */}
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">角色设定</div>
            <div className="setting-row-sub">
              {persona?.customized === true ? '已自定义 · 注入为最优先 system 块' : '未自定义（空着就不注入）'}
            </div>
          </div>
          <button
            type="button"
            data-testid="persona-edit-open"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-soft)' }}
            onClick={editing ? () => setEditing(false) : startEdit}
          >
            {editing ? '收起' : '编辑'}
          </button>
        </div>
        {editing && (
          <div className="px-4 pb-3" data-testid="persona-editor">
            <textarea
              data-testid="persona-input"
              value={draft}
              maxLength={PERSONA_MAX}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              className="w-full rounded-lg border p-3 text-sm"
              style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
              placeholder={'写给小栖看的第一段话。它会出现在所有 system 块的最前面。'}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {draft.length} / {PERSONA_MAX}
              </span>
              <span className="flex gap-2">
                {persona?.customized === true && (
                  <button
                    type="button"
                    data-testid="persona-reset"
                    disabled={saving}
                    className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                    style={{ borderColor: 'var(--border-soft)' }}
                    onClick={reset}
                  >
                    恢复默认
                  </button>
                )}
                <button
                  type="button"
                  data-testid="persona-save"
                  disabled={saving}
                  className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--accent-strong)' }}
                  onClick={save}
                >
                  保存
                </button>
              </span>
            </div>
          </div>
        )}

        {/* 本轮 Prompt 查看（SPEC §9.4.3）：内置块只读，动态块明说 */}
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">查看本轮 Prompt</div>
            <div className="setting-row-sub">这次对话实际会注入的全部 system 块</div>
          </div>
          <button
            type="button"
            data-testid="prompt-view-open"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-soft)' }}
            onClick={toggleView}
          >
            {viewOpen ? '收起' : '查看'}
          </button>
        </div>
        {viewOpen && view !== null && (
          <div className="px-4 pb-3" data-testid="prompt-blocks">
            {view.blocks.map((block) => (
              <details key={block.name} className="mb-2 rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }}>
                <summary className="cursor-pointer text-sm" data-testid={`prompt-block-${block.name}`}>
                  {block.label}
                  <span className="ml-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {block.source === 'custom' ? '自定义' : '内置 · 不可编辑'}
                  </span>
                </summary>
                <pre
                  className="mt-2 overflow-auto whitespace-pre-wrap text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {block.content}
                </pre>
              </details>
            ))}
          </div>
        )}

        {/* 世界书管理入口（SPEC §9.4.2） */}
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">世界书</div>
            <div className="setting-row-sub">恒定或按关键词注入的设定条目</div>
          </div>
          <Link
            to="/setting/worldbook"
            data-testid="worldbook-open"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-soft)' }}
          >
            管理
          </Link>
        </div>

        {error !== null && (
          <p className="px-4 pb-3 pt-1 text-sm" style={{ color: 'var(--danger)' }} data-testid="prompt-error">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
