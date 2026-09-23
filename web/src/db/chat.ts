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
  MessageCandidate,
  MessageRole,
  MessageStatus,
  TextBlock,
} from '@shared/types'
import { db } from './db'

/** 单条消息最多保留多少候选版本 —— §6.3 的「多候选 / 重roll」提前量 */
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

/** 造一个纯文本块（消息体里最常见的形状） */
export function textBlock(text: string, order = 0): TextBlock {
  return { kind: 'text', payload: { text }, order }
}

export function newMessage(input: NewMessageInput): ChatMessage {
  const now = Date.now()
  const blocks: MessageBlock[] = input.blocks ?? [textBlock(input.text ?? '')]
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

/**
 * 取消息的**纯文本投影**：历史组装、列表预览、版本历史都只看 text 块。
 * 别的块（图片 / 文件 / 工具结果）没有可入 prompt 的文字，刻意跳过而不是硬塞占位符。
 */
export function messageText(message: ChatMessage): string {
  return message.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => block.payload.text)
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

/* ---------- 消息版本 / 多候选（§6.3）：「换一个」与「切回上一版」都走这里 ---------- */

export interface AddVersionInput {
  content: string
  /** 这条新版本怎么来的：重roll（模型重出）还是编辑（用户改） */
  origin?: MessageCandidate['origin']
  status?: MessageStatus
  reasoning?: string
}

/**
 * 记入一个新版本并**设为展示版本**。
 *
 * 首次调用会把「当前正文」也登记成一条版本 —— 否则「换一个」之后无从切回上一版，
 * 而用户点「换一个」时最常见的念头恰恰是「还是刚才那个好」。
 *
 * ⚠️ `blocks` 与展示版本必须同步：前者是渲染与历史组装的投影，后者是版本历史。
 * 两者一旦分家，就会出现「屏幕上看到的」和「下一轮送出去的」不是同一段话。
 */
export async function addVersion(id: string, input: AddVersionInput): Promise<ChatMessage | null> {
  const message = await db.messages.get(id)
  if (message === undefined) return null

  const origin = input.origin ?? 'reroll'
  const versions: MessageCandidate[] =
    message.candidates.length > 0
      ? message.candidates.map((candidate) => ({ ...candidate, selected: false }))
      : [{ content: messageText(message), origin, selected: false }]
  versions.push({ content: input.content, origin, selected: true })

  // 超限时淘汰**最旧的未展示项**，绝不淘汰刚选中的那个 ——
  // 否则「n/N」里会出现一个屏幕上正显示、却找不到对应条目的版本
  while (versions.length > MAX_CANDIDATES) {
    const victim = versions.findIndex((candidate) => !candidate.selected)
    if (victim < 0) break
    versions.splice(victim, 1)
  }

  const next: ChatMessage = {
    ...message,
    blocks: [textBlock(input.content)],
    candidates: versions,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.reasoning === undefined || input.reasoning === ''
      ? {}
      : { metadata: { ...message.metadata, reasoning: input.reasoning } }),
    updatedAt: Date.now(),
  }
  await db.messages.put(next)
  return next
}

/** 切到第 `index` 个版本（气泡下方的 ‹ n/N ›）；`blocks` 同步跟上 */
export async function selectCandidateVersion(
  id: string,
  index: number,
): Promise<ChatMessage | null> {
  const message = await db.messages.get(id)
  if (message === undefined) return null
  const target = message.candidates[index]
  if (target === undefined) return null

  const next: ChatMessage = {
    ...message,
    blocks: [textBlock(target.content)],
    candidates: message.candidates.map((candidate, i) => ({ ...candidate, selected: i === index })),
    updatedAt: Date.now(),
  }
  await db.messages.put(next)
  return next
}
