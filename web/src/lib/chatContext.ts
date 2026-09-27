import type { ChatContextCompactResponse } from '@shared/events'
import type { LlmChatMessage } from '@shared/providers'
import { fetchJson } from './api'

/** 请求服务端用当前主聊天方案生成会话摘要；原消息只随请求传输，不在服务端存档。 */
export async function compactChatContext(messages: LlmChatMessage[]): Promise<ChatContextCompactResponse> {
  return fetchJson<ChatContextCompactResponse>('/api/chat/compact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
}
