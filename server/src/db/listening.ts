/** 一起听当前会话：只保存共享播放状态，不复制本地音乐库。 */
import type { ListeningComment, ListeningHistoryItem, ListeningPlaybackState, ListeningQueueItem, ListeningSessionView, MusicTrack } from '@shared/types.js'
import { desc, eq, or } from 'drizzle-orm'
import { getKv, setKv } from './kv.js'
import { appendEventLog } from './activity.js'
import { db } from './index.js'
import { eventLog } from './schema.js'

const KEY = 'listening.session.main'
const QUEUE_KEY = 'listening.queue.main'

type TrackSnapshot = Pick<MusicTrack, 'id' | 'title' | 'artist' | 'externalUrl'>

function emptySession(queue: ListeningQueueItem[] = []): ListeningSessionView {
  return {
    id: 'main',
    track: null,
    state: 'idle',
    positionSeconds: 0,
    startedAt: null,
    updatedAt: 0,
    listeners: { user: false, companion: false },
    queue,
  }
}

function isTrack(value: unknown): value is TrackSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.title === 'string' &&
    (item.artist === null || typeof item.artist === 'string') &&
    (item.externalUrl === null || typeof item.externalUrl === 'string')
}

function isQueueItem(value: unknown): value is ListeningQueueItem {
  if (!isTrack(value)) return false
  const item = value as Record<string, unknown>
  return (item.addedBy === 'user' || item.addedBy === 'companion') && typeof item.addedAt === 'number' && Number.isFinite(item.addedAt)
}

function decodeQueue(raw: string | null): ListeningQueueItem[] {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter(isQueueItem).slice(0, 50) : []
  } catch {
    return []
  }
}

function getQueue(): ListeningQueueItem[] {
  return decodeQueue(getKv(QUEUE_KEY))
}

function decode(raw: string | null): ListeningSessionView {
  const queue = getQueue()
  if (raw === null) return emptySession(queue)
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptySession(queue)
    const item = value as Record<string, unknown>
    const state = item.state === 'playing' || item.state === 'paused' || item.state === 'idle' ? item.state : 'idle'
    const listeners = typeof item.listeners === 'object' && item.listeners !== null && !Array.isArray(item.listeners)
      ? item.listeners as Record<string, unknown>
      : {}
    return {
      id: 'main',
      track: isTrack(item.track) ? item.track : null,
      state,
      positionSeconds: typeof item.positionSeconds === 'number' && Number.isFinite(item.positionSeconds) && item.positionSeconds >= 0 ? item.positionSeconds : 0,
      startedAt: typeof item.startedAt === 'number' ? item.startedAt : null,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      listeners: { user: listeners.user === true, companion: listeners.companion === true },
      queue,
    }
  } catch {
    return emptySession(queue)
  }
}

export function getListeningSession(): ListeningSessionView {
  return decode(getKv(KEY))
}

export interface ListeningSessionPatch {
  track: TrackSnapshot | null
  state: ListeningPlaybackState
  positionSeconds: number
}

export function updateListeningSession(patch: ListeningSessionPatch): ListeningSessionView {
  const previous = getListeningSession()
  const now = Date.now()
  const trackChanged = patch.track?.id !== previous.track?.id
  const sameTrack = !trackChanged && patch.track !== null && previous.track !== null
  const deltaSeconds = sameTrack && previous.state === 'playing'
    ? Math.max(0, patch.positionSeconds - previous.positionSeconds)
    : 0
  const startedAt = patch.state === 'playing'
    ? (trackChanged || previous.startedAt === null ? now : previous.startedAt)
    : previous.startedAt
  const next: ListeningSessionView = {
    id: 'main',
    track: patch.track,
    state: patch.track === null ? 'idle' : patch.state,
    positionSeconds: patch.track === null ? 0 : patch.positionSeconds,
    startedAt: patch.track === null ? null : startedAt,
    updatedAt: now,
    // 当前是单用户实例；companion 是否加入由后续 AI 行动切片接入，绝不在 UI 里伪造在线。
    listeners: { user: patch.track !== null, companion: previous.listeners.companion },
    queue: getQueue(),
  }
  setKv(KEY, JSON.stringify(next))
  // 只记录播放事实，不保存音频内容；每次同步都保留真实增量，Life 投影会按曲目合并卡片。
  if (deltaSeconds > 0 && patch.track !== null) {
    appendEventLog('listening.progress', {
      trackId: patch.track.id,
      title: patch.track.title,
      artist: patch.track.artist,
      deltaSeconds,
      positionSeconds: patch.positionSeconds,
      state: patch.state,
    }, patch.track.id, now)
  }
  if (patch.state === 'playing' && patch.track !== null && (trackChanged || previous.state !== 'playing')) {
    appendEventLog('listening.track.started', {
      trackId: patch.track.id,
      title: patch.track.title,
      artist: patch.track.artist,
    }, patch.track.id, now)
  }
  return next
}

export type ListeningQueueAction = 'add' | 'remove' | 'clear'

/** 共享队列只保留可播曲目的最小快照；同一曲目不会重复排队。 */
export function updateListeningQueue(input: { action: ListeningQueueAction; track?: TrackSnapshot; actor?: 'user' | 'companion' }): ListeningQueueItem[] {
  const previous = getQueue()
  const actor = input.actor ?? 'user'
  let next = previous
  if (input.action === 'clear') next = []
  else if (input.action === 'remove') {
    if (input.track !== undefined) next = previous.filter((item) => item.id !== input.track?.id)
  } else {
    if (input.track === undefined) throw new Error('加入队列需要曲目')
    if (!previous.some((item) => item.id === input.track?.id)) next = [...previous, { ...input.track, addedBy: actor, addedAt: Date.now() }].slice(0, 50)
  }
  setKv(QUEUE_KEY, JSON.stringify(next))
  if (input.action === 'add' && input.track !== undefined && next.length > previous.length) appendEventLog('listening.queue.added', { trackId: input.track.id, title: input.track.title, artist: input.track.artist, actor }, input.track.id)
  if (input.action === 'remove' && input.track !== undefined && next.length < previous.length) appendEventLog('listening.queue.removed', { trackId: input.track.id, title: input.track.title, artist: input.track.artist, actor }, input.track.id)
  if (input.action === 'clear' && previous.length > 0) appendEventLog('listening.queue.cleared', { count: previous.length, actor })
  return next
}

/** Runtime / UI 共用的逐曲评论写入；评论是事实事件，不改写 MusicTrack。 */
export function createListeningComment(input: { track: TrackSnapshot; author: 'user' | 'companion'; content: string }): ListeningComment {
  const content = input.content.trim().slice(0, 1_000)
  if (content === '') throw new Error('评论不能为空')
  const id = `listening-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const at = Date.now()
  appendEventLog('listening.comment.created', {
    commentId: id, trackId: input.track.id, title: input.track.title, artist: input.track.artist,
    author: input.author, content,
  }, input.track.id, at)
  return { id, trackId: input.track.id, title: input.track.title, artist: input.track.artist, author: input.author, content, createdAt: at }
}

export function listListeningComments(trackId: string, limit = 100): ListeningComment[] {
  const rows = db.select().from(eventLog).where(eq(eventLog.eventType, 'listening.comment.created')).orderBy(desc(eventLog.at)).limit(1_000).all()
  return rows.filter((row) => row.refId === trackId || row.metricsJson.trackId === trackId).map((row): ListeningComment | null => {
    const metrics = row.metricsJson
    if (typeof metrics.commentId !== 'string' || typeof metrics.title !== 'string' || typeof metrics.content !== 'string' || (metrics.author !== 'user' && metrics.author !== 'companion')) return null
    return { id: metrics.commentId, trackId, title: metrics.title, artist: typeof metrics.artist === 'string' ? metrics.artist : null, author: metrics.author, content: metrics.content, createdAt: row.at }
  }).filter((item): item is ListeningComment => item !== null).sort((a, b) => a.createdAt - b.createdAt).slice(-Math.max(1, Math.min(limit, 200)))
}

/** 从播放事实聚合历史，不把本地曲库或音频复制进服务端。 */
export function listListeningHistory(limit = 50): ListeningHistoryItem[] {
  const rows = db.select().from(eventLog)
    .where(or(eq(eventLog.eventType, 'listening.track.started'), eq(eventLog.eventType, 'listening.progress')))
    .orderBy(desc(eventLog.at))
    .limit(5_000)
    .all()
  const grouped = new Map<string, ListeningHistoryItem>()
  for (const row of rows) {
    const metrics = row.metricsJson
    const trackId = typeof metrics.trackId === 'string' ? metrics.trackId : row.refId
    if (trackId === null || trackId === undefined || trackId === '') continue
    const current = grouped.get(trackId) ?? {
      trackId,
      title: typeof metrics.title === 'string' && metrics.title !== '' ? metrics.title : '未命名曲目',
      artist: typeof metrics.artist === 'string' ? metrics.artist : null,
      totalSeconds: 0,
      playCount: 0,
      lastPlayedAt: row.at,
    }
    current.lastPlayedAt = Math.max(current.lastPlayedAt, row.at)
    if (typeof metrics.title === 'string' && metrics.title !== '') current.title = metrics.title
    if (typeof metrics.artist === 'string') current.artist = metrics.artist
    if (row.eventType === 'listening.track.started') current.playCount += 1
    if (row.eventType === 'listening.progress' && typeof metrics.deltaSeconds === 'number' && Number.isFinite(metrics.deltaSeconds)) {
      current.totalSeconds += Math.max(0, metrics.deltaSeconds)
    }
    grouped.set(trackId, current)
  }
  return [...grouped.values()]
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, Math.max(1, Math.min(limit, 200)))
}
