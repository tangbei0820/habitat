/**
 * 本地仓储层（§6.2：ChatSession / ChatMessage 归属本地）
 *
 * 页面不直接碰 Dexie，统一走这里：一来读写口径只有一处，
 * 二来以后加分页、导出、迁移时不用回头改页面。
 */
import type {
  ChatMessage,
  ChatSession,
  MessageBlock,
  MessageRole,
  MessageStatus,
} from '@shared/types'
import { db } from './db'

/** 单条消息最多保留多少候选 —— §6.3 的「多候选 / 重roll」提前量，Phase 1 只建表不用 */
export const MAX_CANDIDATES = 8

/** 时间键的两端哨兵：比 Date.now() 的取值域更宽，避免边界漏条 */
const TIME_MAX = Number.MAX_SAFE_INTEGER
const TIME_MIN = Number.MIN_SAFE_INTEGER

export function newSession(title: string): ChatSession {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    type: 'chat-session',
    title,
    pinnedAt: null,
    remark: null,
    background: null,
    bubbleMode: 'chat',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export interface NewMessageInput {
  sessionId: string
  role: MessageRole
  /** 纯文本消息的便捷写法；要用别的块类型时走 blocks */
  text?: string
  blocks?: MessageBlock[]
  status?: MessageStatus
  replyToId?: string | null
}

export function newMessage(input: NewMessageInput): ChatMessage {
  const now = Date.now()
  const blocks: MessageBlock[] =
    input.blocks ?? [{ kind: 'text', payload: { text: input.text ?? '' }, order: 0 }]
  return {
    id: crypto.randomUUID(),
    type: 'chat-message',
    sessionId: input.sessionId,
    role: input.role,
    status: input.status ?? 'done',
    replyToId: input.replyToId ?? null,
    blocks,
    versionOf: null,
    candidates: [],
    recalledAt: null,
    editedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** 取消息的纯文本（Phase 1 只有 text 块；别的块类型接入后在此补渲染分支） */
export function messageText(message: ChatMessage): string {
  return message.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => {
      const payload = block.payload
      if (typeof payload === 'object' && payload !== null && 'text' in payload) {
        const text = (payload as { text: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
}

export async function listSessions(): Promise<ChatSession[]> {
  const list = await db.sessions.orderBy('updatedAt').reverse().toArray()
  // 置顶是时间戳而非布尔（§6.2），排序也得按这个口径
  return [...list].sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
}

export async function getSession(id: string): Promise<ChatSession | null> {
  return (await db.sessions.get(id)) ?? null
}

export async function createSession(title: string): Promise<ChatSession> {
  const session = newSession(title)
  await db.sessions.add(session)
  return session
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.messages, async () => {
    await db.messages.where('sessionId').equals(id).delete()
    await db.sessions.delete(id)
  })
}

export async function countMessages(sessionId: string): Promise<number> {
  return db.messages.where('sessionId').equals(sessionId).count()
}

/**
 * 按时间**升序**取某会话的全部消息。
 * 首屏只拉尾部一页请用 `listMessagesPage`（长会话 §9 风险8）。
 */
export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  return db.messages.where('sessionId').equals(sessionId).sortBy('createdAt')
}

/**
 * 取**最近**一页（返回升序）。走复合索引 `[sessionId+createdAt]`，
 * 免去「取回全部再内存排序」；`before` 传已加载最早一条的 createdAt 即可继续往前翻。
 */
export async function listMessagesPage(
  sessionId: string,
  limit: number,
  before?: number,
): Promise<ChatMessage[]> {
  const upper: [string, number] = [sessionId, before ?? TIME_MAX]
  const rows = await db.messages
    .where('[sessionId+createdAt]')
    .between([sessionId, TIME_MIN], upper, true, false)
    .reverse()
    .limit(limit)
    .toArray()
  return rows.reverse()
}

export async function appendMessage(message: ChatMessage): Promise<void> {
  await db.messages.add(message)
}

export async function updateMessage(
  id: string,
  patch: Partial<Omit<ChatMessage, 'id' | 'type'>>,
): Promise<void> {
  await db.messages.update(id, { ...patch, updatedAt: Date.now() })
}

/** 会话被写消息时刷新 `updatedAt`（列表按它倒序）；传入 title 则同时改名 */
export async function touchSession(id: string, title?: string): Promise<void> {
  await db.sessions.update(id, {
    updatedAt: Date.now(),
    ...(title === undefined ? {} : { title }),
  })
}
