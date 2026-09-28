import { useEffect, useState } from 'react'
import type { DiaryFragmentView, DiaryView, RuntimeEvent } from '@shared/types'
import { listEvents, requestDiaryAccess } from '../../db/events'
import { listDiaries } from '../../db/home'

function fragmentRequestKey(diaryId: string, fragmentId: string): string {
  return `${diaryId}:${fragmentId}`
}

/**
 * 日记（SPEC §3.4）。
 *
 * 这一页只呈现小栖自己的日记空间：用户能看到封面与已开放的内容，
 * 但不能在这里创建、编辑或删除 AI 日记。服务端仍保留用户个人日记 API，
 * 以兼容历史数据与导入备份；它们不会混入这个 AI 私密空间。
 *
 * 「请求查看」（Phase 6.5 P1）：点了只**挂一条待小栖决定的请求**，不直接解锁；
 * 片段级请求（T-069）同样只挂请求，不替它开放正文。
 * 所以按钮之后的状态是「已请求，等小栖回话」而不是「已解锁」—— 界面上不能替它回答。
 * 已经请求过的篇 / 段，分别靠事件里的 `targetId` / `targetFragmentId` 认出来。
 */
export function DiaryModule() {
  const [items, setItems] = useState<DiaryView[]>([])
  const [search, setSearch] = useState('')
  const [requestedIds, setRequestedIds] = useState<ReadonlySet<string>>(new Set())
  const [requestedFragmentIds, setRequestedFragmentIds] = useState<ReadonlySet<string>>(new Set())
  const [requestHistory, setRequestHistory] = useState<RuntimeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(query = search): Promise<void> {
    // 日记与「待小栖决定的请求」一起拉：少了后者，用户点完按钮看不出任何变化
    const [diaries, pending, history] = await Promise.all([
      listDiaries(query),
      listEvents({ decider: 'companion', status: 'pending' }),
      listEvents({ decider: 'companion', limit: 100 }),
    ])
    // 个人日记仍由服务端保留，但不应与小栖的私密日记混在同一个入口里。
    setItems(diaries.filter((item) => item.author === 'companion'))
    setRequestedIds(new Set(pending.map((item) => item.targetId).filter((id): id is string => id !== null)))
    setRequestedFragmentIds(new Set(pending.flatMap((item) =>
      item.targetId !== null && typeof item.targetFragmentId === 'string'
      ? [fragmentRequestKey(item.targetId, item.targetFragmentId)]
        : [],
    )))
    setRequestHistory(history.filter((item) => item.kind === 'diary_access_request'))
  }

  useEffect(() => {
    setLoading(true)
    const timer = window.setTimeout(() => {
      refresh(search)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [search])

  /**
   * 请求查看某篇小栖的日记。
   *
   * ⚠️ 成功之后**只是刷新列表**，不要写「已解锁」之类的反馈 ——
   * 这个动作只挂了一条待它决定的请求（服务端返回的就是一条 `pending` 事件）。
   */
  async function askToRead(id: string, fragmentId?: string): Promise<void> {
    try {
      await requestDiaryAccess(id, fragmentId)
      setError(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function requestStatusLabel(event: RuntimeEvent): string {
    if (event.status === 'pending') return '等小栖决定'
    if (event.status === 'approved') return '小栖已开放'
    if (event.status === 'denied') return '小栖暂未开放'
    return '处理失败'
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', background: 'linear-gradient(135deg, var(--bg-surface-solid), var(--bg-subtle))' }} data-testid="diary-privacy-intro">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">小栖的日记</p>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>这是它自己的空间。正文默认上锁，你可以按篇或按段敲门，由小栖决定是否开放。这里不提供用户代写或修改入口。</p>
          </div>
          <span className="shrink-0 rounded-full px-2 py-1 text-xs" style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>AI 私密</span>
        </div>
      </div>
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }} data-testid="diary-ai-only">
        <p className="text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>小栖会在自主生活、唤醒或聊天后的合适时刻写下日记。你只能申请查看指定篇目或片段，是否开放由它自己决定。</p>
      </div>

      {error !== null && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <label htmlFor="diary-search" className="sr-only">搜索日记</label>
        <input id="diary-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="搜索标题或已开放内容" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        {search !== '' && <button type="button" onClick={() => setSearch('')} className="text-xs" style={{ color: 'var(--text-secondary)' }}>清除</button>}
      </div>
      <details data-testid="diary-request-history" className="rounded-lg border" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">查看申请记录{requestHistory.length > 0 ? ` · ${requestHistory.length}` : ''}</summary>
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
          {requestHistory.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>还没有发起过查看申请。</p> : requestHistory.map((event) => (
            <article key={event.id} data-testid="diary-request-history-item" className="rounded-lg p-3" style={{ background: 'var(--bg-subtle)' }}>
              <div className="flex items-start justify-between gap-3">
                <strong className="text-sm">{event.title}</strong>
                <span className="shrink-0 text-xs" style={{ color: event.status === 'approved' ? 'var(--accent-strong)' : 'var(--text-secondary)' }}>{requestStatusLabel(event)}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{new Date(event.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              {event.result !== null && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.result}</p>}
            </article>
          ))}
        </div>
      </details>
      {loading ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在翻开日记……</p> : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>{search === '' ? '还没有日记。今天可以成为第一页。' : '没有找到匹配的日记。私密正文不会参与搜索。'}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const fragments = item.fragments ?? []
            const openFragments = fragments.filter((fragment) => fragment.readable)
            const renderFragment = (fragment: DiaryFragmentView) => {
              const requestKey = fragmentRequestKey(item.id, fragment.id)
              const requested = requestedFragmentIds.has(requestKey)
              return <div key={fragment.id} className="space-y-1">
                <p data-testid={`diary-fragment-${fragment.id}`} className="whitespace-pre-wrap break-words rounded-lg p-3 text-sm leading-6" style={{ background: fragment.readable ? 'var(--bg-subtle)' : 'var(--bg-base)', color: fragment.readable ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{fragment.readable ? fragment.content : '这一段还没有开放。'}</p>
                {item.author === 'companion' && !fragment.readable && (requested ? (
                  <p className="px-1 text-xs" style={{ color: 'var(--text-secondary)' }} data-testid={`diary-fragment-pending-${fragment.id}`}>已请求这一段，等小栖决定。</p>
                ) : (
                  <button type="button" data-testid={`diary-request-fragment-${fragment.id}`} onClick={() => void askToRead(item.id, fragment.id)} className="ml-1 rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>请求查看这一段</button>
                ))}
              </div>
            }
            return <li key={item.id} data-testid="diary-item" data-author={item.author} data-readable={item.readable ? 'true' : 'false'} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface-solid)' }}>
              <div className="flex items-center justify-between gap-3">
                <time className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.entryDate}</time>
                <span className="text-xs" style={{ color: 'var(--accent-strong)' }}>小栖的日记</span>
              </div>
              <h3 className="mt-1 font-medium">{item.title}</h3>
              {item.readable ? (
                item.content !== null ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p> : <div className="mt-2 space-y-2" data-testid="diary-fragments">{fragments.map(renderFragment)}<p className="text-xs" style={{ color: 'var(--text-secondary)' }}>小栖已开放 {openFragments.length} 段，其余仍由它自己决定。</p>{item.author === 'companion' && !requestedIds.has(item.id) && <button type="button" data-testid="diary-request-access" onClick={() => void askToRead(item.id)} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>请求查看剩余段落</button>}</div>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {item.visibility === 'locked' ? '这一篇被小栖锁着。' : '小栖还没决定要不要把这一篇给你看。'}
                  </p>
                  {item.author === 'companion' && fragments.length > 0 && <div className="space-y-2" data-testid="diary-fragments">{fragments.map(renderFragment)}<p className="text-xs" style={{ color: 'var(--text-secondary)' }}>你也可以只申请其中一段。</p></div>}
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
            </li>
          })}
        </ul>
      )}
    </div>
  )
}
