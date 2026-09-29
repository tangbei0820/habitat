import type { CallEvent } from '@shared/types.js'

type Listener = (event: CallEvent) => void
const listenersByCall = new Map<string, Set<Listener>>()
const globalListeners = new Set<Listener>()
let nextEventId = 0

export function publishCallEvent(event: CallEvent): void {
  // SSE can reconnect and browsers may redeliver the same frame.  Give every
  // process-local event a monotonic transport id so clients can cheaply
  // deduplicate without adding a database column or changing call facts.
  const enriched: CallEvent = event.eventId === undefined
    ? { ...event, eventId: String(++nextEventId) }
    : event
  const listeners = enriched.type === 'state'
    ? listenersByCall.get(enriched.call.id)
    : listenersByCall.get(enriched.callId)
  listeners?.forEach((listener) => listener(enriched))
  globalListeners.forEach((listener) => listener(enriched))
}

export function subscribeCall(callId: string, listener: Listener): () => void {
  const listeners = listenersByCall.get(callId) ?? new Set<Listener>()
  listeners.add(listener)
  listenersByCall.set(callId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByCall.delete(callId)
  }
}

export function subscribeAllCalls(listener: Listener): () => void {
  globalListeners.add(listener)
  return () => { globalListeners.delete(listener) }
}
