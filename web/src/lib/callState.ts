import type { CallSessionRecord, CallStatus } from '@shared/types'

/** Client-only state: server call status remains the persisted source of truth. */
export type CallClientState =
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'reconnecting'
  | 'ended'
  | 'error'

export type CallClientEvent =
  | { type: 'connect' }
  | { type: 'server'; call: CallSessionRecord }
  | { type: 'listen' }
  | { type: 'process' }
  | { type: 'speak' }
  | { type: 'interrupt' }
  | { type: 'reconnect' }
  | { type: 'resume' }
  | { type: 'end' }
  | { type: 'error' }
  | { type: 'reset' }

export function stateFromCallStatus(status: CallStatus): CallClientState {
  switch (status) {
    case 'ringing': return 'ringing'
    case 'active': return 'connecting'
    default: return 'ended'
  }
}

export function isCallTerminal(state: CallClientState): boolean {
  return state === 'ended' || state === 'error'
}

/**
 * A small explicit FSM keeps UI/audio cleanup deterministic when SSE retries,
 * duplicate state events, or a late TTS promise race with hangup.
 */
export function reduceCallState(current: CallClientState, event: CallClientEvent): CallClientState {
  if (event.type === 'reset') return 'idle'
  if (event.type === 'end') return 'ended'
  if (event.type === 'error') return 'error'
  if (event.type === 'reconnect') return isCallTerminal(current) ? current : 'reconnecting'
  if (event.type === 'server') {
    const next = stateFromCallStatus(event.call.status)
    return next === 'ended' && event.call.status === 'active' ? 'connecting' : next
  }
  if (isCallTerminal(current)) return current
  switch (event.type) {
    case 'connect': return 'connecting'
    case 'listen': return 'listening'
    case 'process': return 'processing'
    case 'speak': return 'speaking'
    case 'interrupt': return 'listening'
    case 'resume': return current === 'reconnecting' ? 'listening' : current
    default: return current
  }
}

export function callStateLabel(state: CallClientState, elapsed: string): string {
  switch (state) {
    case 'ringing': return '等待接听…'
    case 'connecting': return '正在接通…'
    case 'listening': return `通话中 · 正在听你说话 · ${elapsed}`
    case 'processing': return '正在转写并等小栖回复…'
    case 'speaking': return '正在播放小栖的回复 · 可随时打断'
    case 'reconnecting': return '连接暂时中断，正在恢复…'
    case 'ended': return '通话已结束'
    case 'error': return '这一轮没有完成'
    default: return '点击麦克风开始一轮对话'
  }
}
