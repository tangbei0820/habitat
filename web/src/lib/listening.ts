import type { ListeningComment, ListeningHistoryItem, ListeningQueueItem, ListeningSessionView, MusicTrack } from '@shared/types'
import { fetchJson } from './api'

type TrackSnapshot = Pick<MusicTrack, 'id' | 'title' | 'artist' | 'externalUrl'>

export async function getListeningSession(): Promise<ListeningSessionView> {
  return fetchJson<ListeningSessionView>('/api/listening/session')
}

export async function updateListeningSession(input: {
  track: TrackSnapshot | null
  state: ListeningSessionView['state']
  positionSeconds: number
}): Promise<ListeningSessionView> {
  return fetchJson<ListeningSessionView>('/api/listening/session', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function listListeningHistory(limit = 50): Promise<ListeningHistoryItem[]> {
  const data = await fetchJson<{ items: ListeningHistoryItem[] }>(`/api/listening/history?limit=${String(limit)}`)
  return data.items
}

export async function updateListeningQueue(input: { action: 'add' | 'remove' | 'clear'; track?: TrackSnapshot }): Promise<ListeningQueueItem[]> {
  const data = await fetchJson<{ items: ListeningQueueItem[] }>('/api/listening/queue', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  })
  return data.items
}

export async function listListeningComments(trackId: string, limit = 100): Promise<ListeningComment[]> {
  const data = await fetchJson<{ items: ListeningComment[] }>(`/api/listening/comments?trackId=${encodeURIComponent(trackId)}&limit=${String(limit)}`)
  return data.items
}

export async function createListeningComment(track: TrackSnapshot, content: string): Promise<ListeningComment> {
  return fetchJson<ListeningComment>('/api/listening/comments', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track, content }),
  })
}
