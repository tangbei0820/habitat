import type { CallEvent } from '@shared/types.js'

type Listener = (event: CallEvent) => void
const listenersByCall = new Map<string, Set<Listener>>()
const globalListeners = new Set<Listener>()

export function publishCallEvent(event: CallEvent): void {
  const listeners = event.type === 'state'
    ? listenersByCall.get(event.call.id)
    : listenersByCall.get(event.callId)
  listeners?.forEach((listener) => listener(event))
  globalListeners.forEach((listener) => listener(event))
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
