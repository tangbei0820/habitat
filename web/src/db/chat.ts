/**
 * 本地仓储层（§6.2：ChatSession / ChatMessage 归属本地）
 *
 * 页面不直接碰 Dexie，统一走这里：一来读写口径只有一处，
 * 二来以后加分页、导出、迁移时不用回头改页面。
 */
import type {
  BubbleMode,
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
/** id 键的上界哨兵：'￿' 大于任何正常 uuid，让「无游标」等价于「取到时间尽头」 */
const ID_MAX = '￿'

/** 思维链落库上限（字符数）：R1 类长思维链会让单条消息记录明显膨胀，超出的截断保留头尾 */
export const REASONING_LIMIT = 32_000

export function capReasoning(reasoning: string): string {
  if (reasoning.length <= REASONING_LIMIT) return reasoning
  const head = reasoning.slice(0, REASONING_LIMIT / 2)
  const tail = reasoning.slice(-(REASONING_LIMIT / 2))
  return `${head}\n…（思维链过长，已截断）…\n${tail}`
}

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

/** 置顶只写 `pinnedAt`，不刷新 `updatedAt`：取消置顶后仍回到原本的消息活跃顺序。 */
export async function setSessionPinned(id: string, pinned: boolean): Promise<ChatSession | null> {
  const session = await db.sessions.get(id)
  if (session === undefined) return null
  const next: ChatSession = { ...session, pinnedAt: pinned ? Date.now() : null }
  await db.sessions.put(next)
  return next
}

export interface ChatSessionSettingsInput {
  remark: string | null
  background: string | null
  bubbleMode: BubbleMode
}

/** 会话设置不代表新消息活动，因此保留原 `updatedAt`，避免保存设置后会话莫名跳位。 */
export async function updateSessionSettings(
  id: string,
  input: ChatSessionSettingsInput,
): Promise<ChatSession | null> {
  const session = await db.sessions.get(id)
  if (session === undefined) return null
  const remark = input.remark?.trim() || null
  if (remark !== null && remark.length > 500) throw new Error('会话备注不能超过 500 字')
  const next: ChatSession = {
    ...session,
    remark,
    background: input.background,
    bubbleMode: input.bubbleMode,
  }
  await db.sessions.put(next)
  return next
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
 * 分页游标：「已加载最早一条」的 (createdAt, id)。
 * 带上 id 是为了 createdAt 撞毫秒时不漏条 —— 见 `db.ts` 的 v3 说明。
 */
export interface MessagePageCursor {
  createdAt: number
  id: string
}

/**
 * 取**最近**一页（返回升序）。走复合索引 `[sessionId+createdAt+id]`，
 * 上界「不含」语义对三元组整体生效：createdAt 相同则按 id 续取，撞毫秒不再漏条。
 */
export async function listMessagesPage(
  sessionId: string,
  limit: number,
  before?: MessagePageCursor,
): Promise<ChatMessage[]> {
  const upper: [string, number, string] = [sessionId, before?.createdAt ?? TIME_MAX, before?.id ?? ID_MAX]
  const rows = await db.messages
    .where('[sessionId+createdAt+id]')
    .between([sessionId, TIME_MIN, ''], upper, true, false)
    .reverse()
    .limit(limit)
    .toArray()
  return rows.reverse()
}

export async function appendMessage(message: ChatMessage): Promise<void> {
  await db.messages.add(message)
}

/** 删除单条消息（流式草稿失败时清掉空回复，不留垃圾记录） */
export async function deleteMessage(id: string): Promise<void> {
  await db.messages.delete(id)
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
/**
 * 在版本链上追加一条并选中它，同时把「当前正文」登记成前一条版本。
 *
 * 「换一个」与「编辑」共用这一处 —— SPEC §2.3.4 要求两者共用同一套版本历史；
 * 各写一遍必然会漂移（典型是其中一处忘了淘汰上限，于是那条路径的版本数没有天花）。
 */
function withNewVersion(
  message: ChatMessage,
  content: string,
  origin: MessageCandidate['origin'],
): MessageCandidate[] {
  const versions: MessageCandidate[] =
    message.candidates.length > 0
      ? message.candidates.map((candidate) => ({ ...candidate, selected: false }))
      : [{ content: messageText(message), origin, selected: false }]
  versions.push({ content, origin, selected: true })

  // 超限时淘汰**最旧的未展示项**，绝不淘汰刚选中的那个 ——
  // 否则「n/N」里会出现一个屏幕上正显示、却找不到对应条目的版本
  while (versions.length > MAX_CANDIDATES) {
    const victim = versions.findIndex((candidate) => !candidate.selected)
    if (victim < 0) break
    versions.splice(victim, 1)
  }
  return versions
}

export async function addVersion(id: string, input: AddVersionInput): Promise<ChatMessage | null> {
  const message = await db.messages.get(id)
  if (message === undefined) return null

  const origin = input.origin ?? 'reroll'
  const next: ChatMessage = {
    ...message,
    blocks: [textBlock(input.content)],
    candidates: withNewVersion(message, input.content, origin),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.reasoning === undefined || input.reasoning === ''
      ? {}
      : { metadata: { ...message.metadata, reasoning: capReasoning(input.reasoning) } }),
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

/* ---------- 消息对象操作（SPEC §2.3）：编辑 / 撤回 / 恢复 / 批量删除 ---------- */

/**
 * 编辑消息正文（SPEC §2.3.4）。
 *
 * **保留原版本**：旧正文进版本链（`origin: 'edit'`），与「换一个」共用同一套 ‹ n/N › 导航 ——
 * 不另造第二套历史。内容没变就直接返回，不白造一条一模一样的版本。
 *
 * ⚠️ 这里**不动后续消息**。SPEC 定的是「编辑用户消息后不自动删除、不自动重生成后续」：
 * 编辑的常见意图是改一句话，不该连带毁掉其后已经产生的对话。「从这条重新生成」是用户显式触发的另一件事。
 */
export async function editMessage(id: string, content: string): Promise<ChatMessage | null> {
  const message = await db.messages.get(id)
  if (message === undefined) return null
  if (messageText(message) === content) return message

  const now = Date.now()
  const next: ChatMessage = {
    ...message,
    blocks: [textBlock(content)],
    candidates: withNewVersion(message, content, 'edit'),
    editedAt: now,
    updatedAt: now,
  }
  await db.messages.put(next)
  return next
}

/**
 * 撤回（SPEC §2.3.5）：只打 `recalledAt`，**正文与版本链原样保留**。
 *
 * 保留正文有两个理由：撤回不是销毁（要能恢复），以及恢复时不该丢内容。
 * 「不进模型上下文」不在这里做 —— 那是上下文组装的事（见 `ChatWindowPage` 的 `historyUpTo`）。
 */
export async function recallMessage(id: string): Promise<ChatMessage | null> {
  const message = await db.messages.get(id)
  if (message === undefined) return null
  const now = Date.now()
  const next: ChatMessage = { ...message, recalledAt: now, updatedAt: now }
  await db.messages.put(next)
  return next
}

/** 取消撤回：正文一直都在库里，所以只需把标记抹掉 */
export async function restoreMessage(id: string): Promise<ChatMessage | null> {
  const message = await db.messages.get(id)
  if (message === undefined) return null
  const next: ChatMessage = { ...message, recalledAt: null, updatedAt: Date.now() }
  await db.messages.put(next)
  return next
}

/**
 * 批量删除（多选后用）。`anyOf(...).delete()` 一次成型、返回真实删除条数，
 * 由 Dexie 包在一个事务里 —— 中途失败留下一半，用户会以为已经删干净了。
 */
export async function deleteMessages(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  return db.messages.where('id').anyOf(ids).delete()
}
