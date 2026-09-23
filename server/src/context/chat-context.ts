/** Phase 3 上下文组装：当前只接 Eventide；世界书与 Nocturne 后续从同一入口加入。 */
import type { LlmChatMessage, StateProvider, StateTickOptions } from '@shared/providers.js'

export type EventideContextState = 'injected' | 'not-configured' | 'empty' | 'unavailable'

export interface ChatContextResult {
  messages: LlmChatMessage[]
  eventide: EventideContextState
  error: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 状态卡放在已有 system/persona 指令之后、第一条对话之前。
 * 这样人格/世界规则保持最高优先级，临时状态又不会掉到历史末尾伪装成用户刚说的话。
 */
export function injectStateCard(messages: LlmChatMessage[], stateCard: string): LlmChatMessage[] {
  const firstConversation = messages.findIndex((message) => message.role !== 'system')
  const insertion = firstConversation === -1 ? messages.length : firstConversation
  const card: LlmChatMessage = { role: 'system', name: 'eventide_state', content: stateCard }
  return [...messages.slice(0, insertion), card, ...messages.slice(insertion)]
}

/** Eventide 是增强项：任何状态侧故障都降级为原始聊天历史，绝不阻塞回复。 */
export async function assembleChatContext(
  messages: LlmChatMessage[],
  state: StateProvider | null,
  now = new Date(),
  options: StateTickOptions = {},
): Promise<ChatContextResult> {
  if (state === null) return { messages: [...messages], eventide: 'not-configured', error: null }
  try {
    // 当前请求本身就是「对方刚发来消息」；等待压力在这一刻归零。
    // 后续主动 tick 会使用服务端持久化的最后互动时间，而不是复用这条近似。
    const event = await state.checkEvents(now, {
      ...options,
      lastCounterpartMessageAt: options.lastCounterpartMessageAt ?? now,
    })
    const snapshot = event.snapshot
    const card = snapshot.stateCard?.trim()
    if (card === undefined || card === '') {
      return { messages: [...messages], eventide: 'empty', error: null }
    }
    return { messages: injectStateCard(messages, card), eventide: 'injected', error: null }
  } catch (error) {
    return { messages: [...messages], eventide: 'unavailable', error: errorMessage(error) }
  }
}
