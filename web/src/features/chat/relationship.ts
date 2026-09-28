import type { RelationshipSnapshot } from '@shared/types'
import { fetchJson } from '../../lib/api'

const jsonHeaders = { 'content-type': 'application/json' }

export function getRelationship(): Promise<RelationshipSnapshot> {
  return fetchJson<RelationshipSnapshot>('/api/relationship')
}

export function pokeRelationship(): Promise<{ snapshot: RelationshipSnapshot }> {
  return fetchJson<{ snapshot: RelationshipSnapshot }>('/api/relationship/poke', { method: 'POST', headers: jsonHeaders, body: '{}' })
}

export function pauseRelationship(reason?: string, durationMinutes = 60): Promise<RelationshipSnapshot> {
  return fetchJson<RelationshipSnapshot>('/api/relationship/pause', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ reason: reason?.trim() || undefined, durationMinutes }),
  })
}

export function requestRelationshipRecovery(): Promise<{ request: RelationshipSnapshot['requests'][number]; snapshot: RelationshipSnapshot }> {
  return fetchJson<{ request: RelationshipSnapshot['requests'][number]; snapshot: RelationshipSnapshot }>('/api/relationship/recovery', {
    method: 'POST', headers: jsonHeaders, body: '{}',
  })
}

export function decideRelationshipRecovery(id: string, decision: 'approve' | 'deny'): Promise<RelationshipSnapshot> {
  return fetchJson<RelationshipSnapshot>(`/api/relationship/recovery/${encodeURIComponent(id)}/decide`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ decision }),
  })
}
