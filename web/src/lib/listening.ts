import type { ListeningHistoryItem, ListeningSessionView, MusicTrack } from '@shared/types'
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
