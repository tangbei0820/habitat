/**
 * Runtime System Context 组装（Phase 6.5）
 *
 * 每轮聊天送给模型的 system 段按**固定顺序**拼装：
 *
 *   [前端带来的人格 / 世界书]        ← 最高优先级，原样保留
 *   [运行规则 runtime_rules]         ← 恒定，永远注入
 *   [能力清单 runtime_capabilities]  ← 由 Capability Registry 生成（不许写死）
 *   [长期记忆 nocturne_memory]       ← 仅新会话开头注入一次
 *   [事件 runtime_events]            ← 待 AI 决策的请求 + 上次请求的结果（Phase 6.5 P1）
 *   [状态卡 eventide_state]          ← 每轮
 *   [对话历史]
 *
 * 顺序有讲究：人格/世界规则必须在最前，否则临时上下文会被当成「用户刚说的话」；
 * 能力清单必须早于任何工具调用，这样模型在决定要不要调工具时已经知道有什么；
 * 事件段紧随其后（「会什么」和「记得什么」是背景，「等你处理什么」是待办），
 * 但不能落到对话历史之后 —— 那里会被读成「用户刚说的话」。
 *
 * 各段都是**增强项**：任一环节失败都降级为「少一段」，绝不阻塞回复 ——
 * 这条纪律从 Phase 3 沿用至今，本 Phase 不动它。
 */
import type { CapabilitySnapshot } from '@shared/capabilities.js'
import type { LlmChatMessage, MemoryProvider, StateProvider, StateTickOptions } from '@shared/providers.js'
import { buildEventContext } from './event-context.js'
import { RUNTIME_RULES_TEXT, renderCapabilityBlock } from './runtime-context.js'

export type EventideContextState = 'injected' | 'not-configured' | 'empty' | 'unavailable'

/** 长期记忆段这一轮的处置结果（诊断用，不影响回复） */
export type MemoryContextState = 'injected' | 'skipped' | 'empty' | 'unavailable' | 'not-configured'

export interface ChatContextResult {
  messages: LlmChatMessage[]
  eventide: EventideContextState
  memory: MemoryContextState
  /** 本轮注入的「已决事件结果」id —— 调用方**在流真正发出之后**才标记为已送达（见 event-context.ts 头部） */
  deliveredEventIds: string[]
  error: string | null
}

export interface ChatContextOptions extends StateTickOptions {
  /** 长期记忆 Provider；未配置传 null 或省略。 */
  memory?: MemoryProvider | null
}

/**
 * 记忆正文注入上限。
 *
 * `recall()` 取回的是**记忆全文**，可能很长。截断会丢信息，但不截断可能一轮就把
 * 上下文预算吃光 —— 两害相权取截断，并在正文里**明确标注被截断**，
 * 让模型知道自己手上不是全部，需要时再用工具取。
 */
const MEMORY_TEXT_LIMIT = 16_000

/** 「新会话开头」判定：除 system 之外只有至多一条对话（即刚发出的那条用户消息）。 */
const NEW_CONVERSATION_MAX = 1

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把 system 段插到**第一条非 system 消息之前**。
 *
 * 这样人格 / 世界规则保持最高优先级（它们本来就在最前），
 * 而临时上下文又不会掉到历史末尾、伪装成用户刚说的话。
 */
export function injectSystemBlocks(messages: LlmChatMessage[], blocks: LlmChatMessage[]): LlmChatMessage[] {
  if (blocks.length === 0) return [...messages]
  const firstConversation = messages.findIndex((message) => message.role !== 'system')
  const insertion = firstConversation === -1 ? messages.length : firstConversation
  return [...messages.slice(0, insertion), ...blocks, ...messages.slice(insertion)]
}

interface BootMemory {
  text: string | null
  state: MemoryContextState
}

/**
 * 长期记忆段。
 *
 * **只在会话开头取一次**，理由有两个：
 *   1. `recall()`（实例的 `breath`）的设计意图就是「新窗 / Compact 后读一遍」，
 *      不是每轮都读 —— 每轮读既贵又没新增信息；
 *   2. 会话中途需要回忆时，模型有 `memory_search` / `memory_read` 可以主动调，
 *      这正是本 Phase 要让 AI 用起来的东西。
 *
 * ⚠️ 判定用的是「对话条数」这个近似（服务端不落聊天记录，拿不到「是不是新会话」的权威信号）。
 * 近似失效的场景是「在很长历史的会话里继续聊」——那种情况下不注入反而是对的（历史里已有）。
 */
async function loadBootMemory(messages: LlmChatMessage[], memory: MemoryProvider | null): Promise<BootMemory> {
  if (memory === null) return { text: null, state: 'not-configured' }
  const conversation = messages.filter((message) => message.role !== 'system').length
  if (conversation > NEW_CONVERSATION_MAX) return { text: null, state: 'skipped' }
  try {
    const text = (await memory.recall()).text.trim()
    if (text === '') return { text: null, state: 'empty' }
    return { text: clampMemory(text), state: 'injected' }
  } catch {
    // 记忆是增强项：读不到就少一段，不写日志刷屏（健康检查已经在报同一件事）
    return { text: null, state: 'unavailable' }
  }
}

function clampMemory(text: string): string {
  if (text.length <= MEMORY_TEXT_LIMIT) return text
  return `${text.slice(0, MEMORY_TEXT_LIMIT)}\n\n（记忆正文过长，此处已截断。需要完整内容时请调用记忆读取能力。）`
}

/**
 * 组装本轮上下文。
 *
 * @param capabilities 当前能力快照 —— 由 `CapabilityService.snapshot()` 提供，
 *                     与 LLM 页面卡片、tool schemas 是**同一份**数据。
 */
export async function assembleChatContext(
  messages: LlmChatMessage[],
  state: StateProvider | null,
  capabilities: readonly CapabilitySnapshot[],
  now = new Date(),
  options: ChatContextOptions = {},
): Promise<ChatContextResult> {
  const blocks: LlmChatMessage[] = [
    { role: 'system', name: 'runtime_rules', content: RUNTIME_RULES_TEXT },
    { role: 'system', name: 'runtime_capabilities', content: renderCapabilityBlock(capabilities) },
  ]

  const memory = await loadBootMemory(messages, options.memory ?? null)
  if (memory.text !== null) {
    blocks.push({ role: 'system', name: 'nocturne_memory', content: memory.text })
  }

  // 事件段（Phase 6.5 P1）：待 AI 决策的请求 + 它上次请求的结果。
  // 放在能力清单之后、状态卡之前 —— 「会什么」和「记得什么」是背景，「等你处理什么」是待办，
  // 待办该在背景之后出现，否则会被当成又一段背景知识划过去。
  const eventContext = buildEventContext()
  if (eventContext.block !== null) {
    blocks.push({ role: 'system', name: 'runtime_events', content: eventContext.block })
  }

  // Eventide 状态卡：失败只降级，不影响上面几段的真实性（能力清单与它无关）
  let eventide: EventideContextState = 'not-configured'
  let error: string | null = null
  if (state !== null) {
    try {
      // 当前请求本身就是「对方刚发来消息」；等待压力在这一刻归零。
      // 后续主动 tick 会使用服务端持久化的最后互动时间，而不是复用这条近似。
      const event = await state.checkEvents(now, {
        ...options,
        lastCounterpartMessageAt: options.lastCounterpartMessageAt ?? now,
      })
      const card = event.snapshot.stateCard?.trim()
      if (card === undefined || card === '') {
        eventide = 'empty'
      } else {
        blocks.push({ role: 'system', name: 'eventide_state', content: card })
        eventide = 'injected'
      }
    } catch (err) {
      eventide = 'unavailable'
      error = errorMessage(err)
    }
  }

  return {
    messages: injectSystemBlocks(messages, blocks),
    eventide,
    memory: memory.state,
    deliveredEventIds: eventContext.deliveredIds,
    error,
  }
}
