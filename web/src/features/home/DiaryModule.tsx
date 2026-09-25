import { useEffect, useState, type FormEvent } from 'react'
import type { DiaryView } from '@shared/types'
import { listEvents, requestDiaryAccess } from '../../db/events'
import { createDiary, deleteDiary, listDiaries, updateDiary } from '../../db/home'

function todayKey(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 日记（SPEC §3.4）。
 *
 * 这一页上**两种日记并存**：
 * - 自己写的（`author='user'`）—— 可编辑、可删除，正文一直都在
 * - 小栖写的（`author='companion'`）—— 只给封面；它没开放时连正文都不下发
 *
 * 所以「编辑 / 删除」按 `item.editable` 显示，而不是「这一页的日记都能改」——
 * 后者会把 AI 的私密日记当成用户的普通内容（SPEC §6.2 明确区分这两者）。
 *
 * 「请求查看」（Phase 6.5 P1）：点了只**挂一条待小栖决定的请求**，不直接解锁。
 * 所以按钮之后的状态是「已请求，等小栖回话」而不是「已解锁」—— 界面上不能替它回答。
 * 已经请求过的那几篇，靠事件里的 `targetId` 认出来（见 RuntimeEvent 注释）。
 */
export function DiaryModule() {
  const [items, setItems] = useState<DiaryView[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [entryDate, setEntryDate] = useState(todayKey)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [requestedIds, setRequestedIds] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    // 日记与「待小栖决定的请求」一起拉：少了后者，用户点完按钮看不出任何变化
    const [diaries, pending] = await Promise.all([
      listDiaries(),
      listEvents({ decider: 'companion', status: 'pending' }),
    ])
    setItems(diaries)
    setRequestedIds(new Set(pending.map((item) => item.targetId).filter((id): id is string => id !== null)))
  }

  useEffect(() => {
    refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  function resetForm(): void {
    setTitle('')
    setContent('')
    setEntryDate(todayKey())
    setEditingId(null)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    try {
      if (editingId === null) await createDiary(title, content, entryDate)
      else await updateDiary(editingId, title, content, entryDate)
      resetForm()
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function startEditing(item: DiaryView): void {
    setTitle(item.title)
    // 能进编辑的必然是自己的日记（按钮只在 editable 时渲染），正文一定有；`?? ''` 只是给类型收口
    setContent(item.content ?? '')
    setEntryDate(item.entryDate)
    setEditingId(item.id)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(id: string): Promise<void> {
    if (deletingId !== id) {
      setDeletingId(id)
      return
    }
    try {
      await deleteDiary(id)
      if (editingId === id) resetForm()
      setDeletingId(null)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 请求查看某篇小栖的日记。
   *
   * ⚠️ 成功之后**只是刷新列表**，不要写「已解锁」之类的反馈 ——
   * 这个动作只挂了一条待它决定的请求（服务端返回的就是一条 `pending` 事件）。
   */
  async function askToRead(id: string): Promise<void> {
    try {
      await requestDiaryAccess(id)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{editingId === null ? '写一篇日记' : '编辑日记'}</h2>
          {editingId !== null && <button type="button" onClick={resetForm} className="text-xs" style={{ color: 'var(--text-secondary)' }}>取消编辑</button>}
        </div>
        <label htmlFor="diary-date" className="text-xs" style={{ color: 'var(--text-secondary)' }}>日期</label>
        <input id="diary-date" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <label htmlFor="diary-title" className="sr-only">日记标题</label>
        <input id="diary-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="今天发生了什么？" className="rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--border-soft)' }} />
        <label htmlFor="diary-content" className="sr-only">日记正文</label>
        <textarea id="diary-content" value={content} onChange={(event) => setContent(event.target.value)} maxLength={10000} rows={7} placeholder="慢慢写，不着急……" className="w-full resize-y rounded-lg border bg-transparent p-3 text-sm leading-6" style={{ borderColor: 'var(--border-soft)' }} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{content.length}/10000</span>
          <button type="submit" disabled={title.trim() === '' || content.trim() === '' || entryDate === ''} className="rounded-full px-4 py-2 text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}>{editingId === null ? '保存日记' : '保存修改'}</button>
        </div>
      </form>

      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在翻开日记……</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>还没有日记。今天可以成为第一页。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} data-testid="diary-item" data-author={item.author} data-readable={item.readable ? 'true' : 'false'} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
              <div className="flex items-center justify-between gap-3">
                <time className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.entryDate}</time>
                {item.author === 'companion' && (
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>小栖的日记</span>
                )}
              </div>
              <h3 className="mt-1 font-medium">{item.title}</h3>
              {item.readable ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {item.visibility === 'locked' ? '这一篇被小栖锁着。' : '小栖还没决定要不要把这一篇给你看。'}
                  </p>
                  {/* 只有小栖写的日记才谈得上「请求查看」—— 请求一篇自己的日记是没有意义的 */}
                  {item.author === 'companion' &&
                    (requestedIds.has(item.id) ? (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }} data-testid="diary-access-pending">
                        已经问过小栖了，等它回话。
                      </p>
                    ) : (
                      <button
                        type="button"
                        data-testid="diary-request-access"
                        onClick={() => void askToRead(item.id)}
                        className="rounded-full border px-3 py-1.5 text-xs"
                        style={{ borderColor: 'var(--border-soft)' }}
                      >
                        请求查看
                      </button>
                    ))}
                </div>
              )}
              {item.editable && (
                <div className="mt-3 flex justify-end gap-3 text-xs">
                  <button type="button" onClick={() => startEditing(item)} style={{ color: 'var(--accent-strong)' }}>编辑</button>
                  <button type="button" onClick={() => void remove(item.id)} onBlur={() => setDeletingId(null)} style={{ color: deletingId === item.id ? 'var(--danger)' : 'var(--text-secondary)' }}>{deletingId === item.id ? '确认删除？' : '删除'}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
