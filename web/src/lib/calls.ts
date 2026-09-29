import type { CallEvent, CallSessionRecord, CallTurnRecord } from '@shared/types'
import { fetchJson } from './api'

const jsonHeaders = { 'content-type': 'application/json' }

export async function createCall(chatSessionId: string): Promise<CallSessionRecord> {
  const result = await fetchJson<{ call: CallSessionRecord }>('/api/calls', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ chatSessionId }) })
  return result.call
}

export async function listIncomingCalls(): Promise<CallSessionRecord[]> {
  const result = await fetchJson<{ calls: CallSessionRecord[] }>('/api/calls/inbox')
  return result.calls
}

export async function listCalls(chatSessionId: string): Promise<CallSessionRecord[]> {
  const result = await fetchJson<{ calls: CallSessionRecord[] }>(`/api/calls?chatSessionId=${encodeURIComponent(chatSessionId)}`)
  return result.calls
}

export async function loadCall(id: string): Promise<{ call: CallSessionRecord; turns: CallTurnRecord[] }> {
  return fetchJson<{ call: CallSessionRecord; turns: CallTurnRecord[] }>(`/api/calls/${encodeURIComponent(id)}`)
}

export async function answerCall(id: string): Promise<CallSessionRecord> {
  const result = await fetchJson<{ call: CallSessionRecord }>(`/api/calls/${encodeURIComponent(id)}/answer`, { method: 'POST', headers: jsonHeaders, body: '{}' })
  return result.call
}

export async function rejectCall(id: string): Promise<CallSessionRecord> {
  const result = await fetchJson<{ call: CallSessionRecord }>(`/api/calls/${encodeURIComponent(id)}/reject`, { method: 'POST', headers: jsonHeaders, body: '{}' })
  return result.call
}

export async function hangupCall(id: string, status: 'ended' | 'cancelled' | 'missed' = 'ended'): Promise<CallSessionRecord> {
  const result = await fetchJson<{ call: CallSessionRecord }>(`/api/calls/${encodeURIComponent(id)}/hangup`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ status }) })
  return result.call
}

export async function appendCallTurn(id: string, speaker: 'user' | 'companion', text: string): Promise<CallTurnRecord> {
  const result = await fetchJson<{ turn: CallTurnRecord }>(`/api/calls/${encodeURIComponent(id)}/turns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ speaker, text }) })
  return result.turn
}

export type CallEventConnection = 'connecting' | 'connected' | 'reconnecting' | 'closed'

interface SubscribeCallOptions {
  onConnectionChange?: (state: CallEventConnection) => void
}

function subscribe(source: EventSource, onEvent: (event: CallEvent) => void, options?: SubscribeCallOptions): () => void {
  const seen = new Set<string>()
  let closed = false
  options?.onConnectionChange?.('connecting')
  source.onopen = () => options?.onConnectionChange?.('connected')
  source.onerror = () => {
    if (!closed) options?.onConnectionChange?.('reconnecting')
  }
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as CallEvent
      const eventId = event.eventId ?? message.lastEventId
      if (eventId !== '' && eventId !== undefined) {
        if (seen.has(eventId)) return
        seen.add(eventId)
        // Bound the dedupe set for long-running calls.  Event ids are only
        // useful within one live browser subscription.
        if (seen.size > 256) seen.delete(seen.values().next().value as string)
      }
      onEvent(event)
    } catch { /* 忽略畸形事件，浏览器会继续重连 */ }
  }
  return () => {
    closed = true
    options?.onConnectionChange?.('closed')
    source.close()
  }
}

export function subscribeCallEvents(id: string, onEvent: (event: CallEvent) => void, options?: SubscribeCallOptions): () => void {
  const source = new EventSource(`/api/calls/${encodeURIComponent(id)}/events`)
  return subscribe(source, onEvent, options)
}

export function subscribeIncomingCallEvents(onEvent: (event: CallEvent) => void, options?: SubscribeCallOptions): () => void {
  const source = new EventSource('/api/calls/events')
  return subscribe(source, onEvent, options)
}
