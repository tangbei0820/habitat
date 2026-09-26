/**
 * 世界书管理页（Phase 7A · SPEC §9.4.2）。
 *
 * 列表 + 内联表单，不搞弹窗 —— 手机上弹窗里的长文本编辑体验很差。
 * 每条都能看到注入模式（恒定 / 关键词）与启停；「改完下一轮立即生效」不需要任何保存之外的动作。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WorldbookEntry, WorldbookMode } from '@shared/types'
import { IconChevronLeft } from '../../components/qixi/Icons'
import { useSlideIn } from '../../components/qixi/useSlideIn'
import { ApiRequestError } from '../../lib/api'
import {
  createWorldbookEntry,
  deleteWorldbookEntry,
  listWorldbookEntries,
  updateWorldbookEntry,
} from '../../lib/prompt'
import { log } from '../../lib/log'

interface Draft {
  id: string | null
  title: string
  content: string
  keys: string
  mode: WorldbookMode
  sortOrder: number
}

const EMPTY_DRAFT: Draft = { id: null, title: '', content: '', keys: '', mode: 'keyword', sortOrder: 0 }

function keysToText(keys: string[]): string {
  return keys.join('、')
}

function textToKeys(raw: string): string[] {
  // 顿号 / 逗号 / 井号都能当分隔符 —— 用户想到哪个用哪个
  return [...new Set(raw.split(/[、,，#\n]+/).map((k) => k.trim()).filter((k) => k !== ''))]
}

export function WorldbookPage() {
  const slide = useSlideIn()
  const [entries, setEntries] = useState<WorldbookEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback((): void => {
    listWorldbookEntries()
      .then((data) => {
        setEntries(data.entries)
        setError(null)
      })
      .catch((err: unknown) => {
        log.error('读取世界书失败', err)
        setError(err instanceof ApiRequestError ? err.message : String(err))
      })
  }, [])

  useEffect(load, [load])

  const submit = (): void => {
    if (draft === null) return
    setBusy(true)
    const payload = {
      title: draft.title,
      content: draft.content,
      keys: textToKeys(draft.keys),
      mode: draft.mode,
      sortOrder: draft.sortOrder,
    }
    const request =
      draft.id === null ? createWorldbookEntry(payload) : updateWorldbookEntry(draft.id, payload)
    request
      .then(() => {
        setDraft(null)
        load()
      })
      .catch((err: unknown) => {
        // 校验被拒（如 keyword 没填触发词）是给用户看的输入反馈，不是系统异常 —— 不进控制台错误
        const isValidation = err instanceof ApiRequestError && err.code === 'BAD_REQUEST'
        if (!isValidation) log.error('保存世界书条目失败', err)
        setError(err instanceof ApiRequestError ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const remove = (id: string): void => {
    setBusy(true)
    deleteWorldbookEntry(id)
      .then(load)
      .catch((err: unknown) => {
        log.error('删除世界书条目失败', err)
        setError(err instanceof ApiRequestError ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const toggleEnabled = (entry: WorldbookEntry): void => {
    setBusy(true)
    updateWorldbookEntry(entry.id, { enabled: !entry.enabled })
      .then(load)
      .catch((err: unknown) => {
        log.error('切换世界书条目失败', err)
        setError(err instanceof ApiRequestError ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const startEdit = (entry: WorldbookEntry): void => {
    setDraft({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      keys: keysToText(entry.keys),
      mode: entry.mode,
      sortOrder: entry.sortOrder,
    })
  }

  return (
    <div className={slide}>
      <div className="topbar">
        <Link to="/setting" aria-label="返回设置" data-testid="worldbook-back" className="icon-btn" style={{ flex: 'none' }}>
          <IconChevronLeft size={20} />
        </Link>
        <h1 className="topbar-title">世界书</h1>
      </div>

      <div className="px-5 pb-6 pt-2">
        <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          设定条目按规则注入小栖的上下文：恒定条目每轮都在，关键词条目只在最近的对话里提到时才进。
          改完下一轮对话立即生效。
        </p>

        {error !== null && (
          <p className="mb-3 text-sm" style={{ color: 'var(--danger)' }} data-testid="worldbook-error">
            {error}
          </p>
        )}

        {/* 列表 */}
        <div data-testid="worldbook-list" className="grid gap-2">
          {entries === null && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在读取…</p>}
          {entries !== null && entries.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }} data-testid="worldbook-empty">
              还没有任何条目。加一条，试试让小栖记住一个世界的规则。
            </p>
          )}
          {entries !== null &&
            entries.map((entry) => (
              <div
                key={entry.id}
                data-testid="wb-item"
                className="rounded-xl border p-3"
                style={{ borderColor: 'var(--border-soft)', opacity: entry.enabled ? 1 : 0.55 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="min-w-0 flex-1 truncate text-sm" data-testid="wb-title">
                    {entry.title}
                  </strong>
                  <span
                    className="flex-none rounded-full px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: entry.mode === 'always' ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      color: entry.mode === 'always' ? 'var(--accent-strong)' : 'var(--text-secondary)',
                    }}
                  >
                    {entry.mode === 'always' ? '恒定' : '关键词'}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-secondary)' }} data-testid="wb-content">
                  {entry.content}
                </p>
                {entry.mode === 'keyword' && entry.keys.length > 0 && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    触发词：{keysToText(entry.keys)}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    data-testid="wb-toggle"
                    disabled={busy}
                    className="rounded-lg border px-2 py-1 disabled:opacity-50"
                    style={{ borderColor: 'var(--border-soft)' }}
                    onClick={() => toggleEnabled(entry)}
                  >
                    {entry.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    data-testid="wb-edit"
                    disabled={busy}
                    className="rounded-lg border px-2 py-1 disabled:opacity-50"
                    style={{ borderColor: 'var(--border-soft)' }}
                    onClick={() => startEdit(entry)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    data-testid="wb-delete"
                    disabled={busy}
                    className="rounded-lg border px-2 py-1 disabled:opacity-50"
                    style={{ borderColor: 'var(--border-soft)', color: 'var(--danger)' }}
                    onClick={() => remove(entry.id)}
                  >
                    删除
                  </button>
                  <span className="ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                    #{entry.sortOrder}
                  </span>
                </div>
              </div>
            ))}
        </div>

        {/* 表单（新建 / 编辑共用，内联在列表下方） */}
        {draft === null ? (
          <button
            type="button"
            data-testid="wb-create"
            className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--accent-strong)' }}
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
          >
            加一条设定
          </button>
        ) : (
          <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--border-soft)' }} data-testid="wb-form">
            <input
              data-testid="wb-input-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="条目名称（只给你自己看）"
              className="w-full rounded-lg border p-2 text-sm"
              style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
            />
            <textarea
              data-testid="wb-input-content"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={5}
              placeholder="注入给小栖的设定正文"
              className="mt-2 w-full rounded-lg border p-2 text-sm"
              style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
            />
            <div className="mt-2 flex items-center gap-2">
              <div className="seg">
                <button
                  type="button"
                  data-testid="wb-mode-always"
                  className={`seg-item${draft.mode === 'always' ? ' is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, mode: 'always' })}
                >
                  恒定
                </button>
                <button
                  type="button"
                  data-testid="wb-mode-keyword"
                  className={`seg-item${draft.mode === 'keyword' ? ' is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, mode: 'keyword' })}
                >
                  关键词
                </button>
              </div>
              <input
                data-testid="wb-input-sort"
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                className="w-20 rounded-lg border p-2 text-sm"
                style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
                aria-label="排序序号"
              />
            </div>
            {draft.mode === 'keyword' && (
              <input
                data-testid="wb-input-keys"
                value={draft.keys}
                onChange={(e) => setDraft({ ...draft, keys: e.target.value })}
                placeholder="触发关键词，用顿号或逗号隔开"
                className="mt-2 w-full rounded-lg border p-2 text-sm"
                style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}
              />
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                data-testid="wb-cancel"
                disabled={busy}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border-soft)' }}
                onClick={() => setDraft(null)}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wb-save"
                disabled={busy || draft.title.trim() === '' || draft.content.trim() === ''}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--accent-strong)' }}
                onClick={submit}
              >
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
