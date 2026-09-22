/**
 * SSE 事件协议（shared/ 唯一权威）
 * Phase 0 仅定义通道与信封；Phase 1 聊天流在此之上扩展 delta/done/error 等事件。
 */

export type SseEventType =
  | 'health'
  | 'chat-delta'
  | 'chat-done'
  | 'chat-error'
  | 'thought'
  | 'tool-call'

/** SSE 事件信封：event 字段为 SseEventType，data 为对应载荷 JSON */
export interface SseEnvelope<T = unknown> {
  event: SseEventType
  data: T
  at: number
}
