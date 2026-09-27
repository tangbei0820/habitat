/**
 * Event Inbox 的前端数据访问（Phase 6.5 P1）。
 *
 * ⚠️ 这一层**没有本地缓存、没有乐观更新** —— 事件是「待决策」的东西，
 * 本地先乐观标成「已确认」会在服务端拒绝时留下一个假的既成事实。
 * 决策的权威结果只认服务端返回的那一条。
 */
import type { RuntimeEvent } from '@shared/types'
import { fetchJson } from '../lib/api'

export interface EventQuery {
  decider?: 'companion' | 'user'
  status?: 'pending' | 'approved' | 'denied' | 'failed'
  limit?: number
}

function queryString(query: EventQuery): string {
  const parts: string[] = []
  if (query.decider !== undefined) parts.push(`decider=${query.decider}`)
  if (query.status !== undefined) parts.push(`status=${query.status}`)
  if (query.limit !== undefined) parts.push(`limit=${String(query.limit)}`)
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

export function listEvents(query: EventQuery = {}): Promise<RuntimeEvent[]> {
  return fetchJson<{ events: RuntimeEvent[] }>(`/api/inbox${queryString(query)}`).then((result) => result.events)
}

export function getEvent(id: string): Promise<RuntimeEvent> {
  return fetchJson<RuntimeEvent>(`/api/inbox/${encodeURIComponent(id)}`)
}

/**
 * 北北对一条事件做决定。**只对 `decider='user'` 的事件有效** ——
 * 替 AI 决定的请求会被服务端拒掉（那正是权限模型存在的意义）。
 */
export function decideEvent(id: string, decision: 'approve' | 'deny'): Promise<RuntimeEvent> {
  return fetchJson<{ event: RuntimeEvent }>(`/api/inbox/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  }).then((result) => result.event)
}

/**
 * 请求查看某篇 AI 日记。
 *
 * ⚠️ 它**只是提一个请求**，返回的事件是 `pending`。真正能不能看到，取决于 AI 之后的决定。
 * 界面文案不能写成「已解锁」——那是在替 AI 回答。
 */
export function requestDiaryAccess(diaryId: string, fragmentId?: string): Promise<RuntimeEvent> {
  const path = fragmentId === undefined
    ? `/api/diary/${encodeURIComponent(diaryId)}/request-access`
    : `/api/diary/${encodeURIComponent(diaryId)}/fragments/${encodeURIComponent(fragmentId)}/request-access`
  return fetchJson<{ event: RuntimeEvent }>(path, {
    method: 'POST',
  }).then((result) => result.event)
}
