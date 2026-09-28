/**
 * 本地仓储层（§6.2：ChatSession / ChatMessage 归属本地）
 *
 * 页面不直接碰 Dexie，统一走这里：一来读写口径只有一处，
 * 二来以后加分页、导出、迁移时不用回头改页面。
 */
import type {
  BubbleMode,
  ChatContextCompressionState,
  ChatContextSummary,
  ChatMessage,
  ChatSession,
  MessageBlock,
  MessageCandidate,
  MessageRole,
  MessageStatus,
  SessionGroup,
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
/** 公开思绪落库上限：它是给人看的短卡，不让异常模型输出撑大本地消息。 */
export const PUBLIC_THOUGHT_LIMIT = 12_000

export function capReasoning(reasoning: string): string {
  if (reasoning.length <= REASONING_LIMIT) return reasoning
  const head = reasoning.slice(0, REASONING_LIMIT / 2)
  const tail = reasoning.slice(-(REASONING_LIMIT / 2))
  return `${head}\n…（思维链过长，已截断）…\n${tail}`
}

export function capPublicThought(thought: string): string {
  if (thought.length <= PUBLIC_THOUGHT_LIMIT) return thought
  const head = thought.slice(0, PUBLIC_THOUGHT_LIMIT / 2)
  const tail = thought.slice(-(PUBLIC_THOUGHT_LIMIT / 2))
  return `${head}\n…（公开思绪过长，已截断）…\n${tail}`
}

export function newSession(title: string): ChatSession {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    type: 'chat-session',
    title,
    pinnedAt: null,
    groupId: null,
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
  /** 仅保存跨模块所需的轻量来源标记（例如图片是用户上传还是 AI 生成）。 */
  metadata?: Record<string, unknown>
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
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
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

/**
 * 历史搜索用的文字投影：只收录用户确实能在消息对象里看到的内容。
 * reasoning 不在 blocks 里，因此天然不会进入普通搜索；撤回消息由调用方直接排除。
 */
function searchableBlockText(block: MessageBlock): string {
  switch (block.kind) {
    case 'text': return block.payload.text
    case 'image': return block.payload.alt ?? ''
    case 'audio': return block.payload.transcript ?? ''
    case 'file': return block.payload.name
    case 'sticker': return [block.payload.name, ...(block.payload.tags ?? [])].join(' ')
    case 'tool-result': return block.payload.summary ?? ''
    case 'widget': return [block.payload.title, block.payload.source].filter((value): value is string => value !== undefined).join(' ')
    case 'tab-group': return block.payload.tabs.flatMap((tab) => [tab.label, ...tab.blocks.map(searchableBlockText)]).join(' ')
    default: return ''
  }
}

export function searchableMessageText(message: ChatMessage): string {
  return message.blocks.map(searchableBlockText).join(' ').replace(/\s+/g, ' ').trim()
}

export interface ChatSearchResult {
  session: ChatSession
  message: ChatMessage
  /** 命中附近的短片段，不把整条长消息塞进结果列表。 */
  snippet: string
}

export interface ChatDaySummary {
  dayKey: string
  firstMessageId: string
  count: number
  latestAt: number
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function searchSnippet(text: string, query: string): string {
  const lowerText = text.toLocaleLowerCase()
  const lowerQuery = query.toLocaleLowerCase()
  const at = lowerText.indexOf(lowerQuery)
  if (at < 0) return text.slice(0, 96)
  const start = Math.max(0, at - 34)
  const end = Math.min(text.length, at + query.length + 62)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/**
 * 跨会话 / 单会话搜索。消息仍留在 Dexie，本函数只生成结果投影；UI 用 VirtualList 渲染聊天正文，
 * 不会因为定位而一次性把所有长消息挂进 DOM。
 */
export async function searchMessages(query: string, sessionId?: string, limit = 100): Promise<ChatSearchResult[]> {
  const normalized = query.trim()
  if (normalized === '') return []
  const sessions = sessionId === undefined
    ? await listSessions()
    : await getSession(sessionId).then((session) => session === null ? [] : [session])
  const results: ChatSearchResult[] = []
  const safeLimit = Math.max(1, Math.min(limit, 500))
  for (const session of sessions) {
    const messages = await db.messages.where('sessionId').equals(session.id).sortBy('createdAt')
    for (const message of messages) {
      if (message.recalledAt !== null) continue
      const text = searchableMessageText(message)
      if (text.toLocaleLowerCase().includes(normalized.toLocaleLowerCase())) {
        results.push({ session, message, snippet: searchSnippet(text, normalized) })
      }
    }
  }
  return results
    .sort((a, b) => b.message.createdAt - a.message.createdAt)
    .slice(0, safeLimit)
}

/** 当前会话的自然日摘要，供时间线入口使用。撤回消息仍算作发生过的消息。 */
export async function listMessageDays(sessionId: string): Promise<ChatDaySummary[]> {
  const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt')
  const byDay = new Map<string, ChatDaySummary>()
  for (const message of messages) {
    const dayKey = localDayKey(message.createdAt)
    const existing = byDay.get(dayKey)
    if (existing === undefined) {
      byDay.set(dayKey, { dayKey, firstMessageId: message.id, count: 1, latestAt: message.createdAt })
    } else {
      existing.count += 1
      existing.latestAt = Math.max(existing.latestAt, message.createdAt)
    }
  }
  return [...byDay.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey))
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

/* ---------- 上下文压缩（PRODUCT_SPEC §2.5） ---------- */

const CONTEXT_COMPRESSION_KEY = 'contextCompression'
const CONTEXT_SUMMARY_LIMIT = 12_000
const CONTEXT_SUMMARY_VERSIONS_LIMIT = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseContextSummary(value: unknown): ChatContextSummary | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' || typeof value.text !== 'string' || value.text.trim() === '' ||
    typeof value.coveredFromMessageId !== 'string' || typeof value.coveredToMessageId !== 'string' ||
    typeof value.coveredMessageCount !== 'number' || typeof value.coveredFrom !== 'number' ||
    typeof value.coveredTo !== 'number' || typeof value.generatedAt !== 'number' ||
    typeof value.updatedAt !== 'number' || typeof value.model !== 'string' ||
    typeof value.profileId !== 'string' || typeof value.version !== 'number' ||
    (value.source !== 'model' && value.source !== 'edited')
  ) return null
  return {
    id: value.id,
    text: value.text.slice(0, CONTEXT_SUMMARY_LIMIT),
    coveredFromMessageId: value.coveredFromMessageId,
    coveredToMessageId: value.coveredToMessageId,
    coveredMessageCount: Math.max(0, Math.floor(value.coveredMessageCount)),
    coveredFrom: value.coveredFrom,
    coveredTo: value.coveredTo,
    generatedAt: value.generatedAt,
    updatedAt: value.updatedAt,
    model: value.model,
    profileId: value.profileId,
    version: Math.max(1, Math.floor(value.version)),
    source: value.source,
  }
}

/** 从会话元数据读压缩状态；旧会话 / 手工备份缺字段时安全回到「未压缩」。 */
export function getContextCompression(session: ChatSession): ChatContextCompressionState {
  const raw = session.metadata?.[CONTEXT_COMPRESSION_KEY]
  if (!isRecord(raw) || !Array.isArray(raw.versions)) return { activeSummaryId: null, versions: [] }
  const versions = raw.versions
    .map(parseContextSummary)
    .filter((item): item is ChatContextSummary => item !== null)
    .sort((a, b) => b.version - a.version)
    .slice(0, CONTEXT_SUMMARY_VERSIONS_LIMIT)
  const activeSummaryId = typeof raw.activeSummaryId === 'string' && versions.some((item) => item.id === raw.activeSummaryId)
    ? raw.activeSummaryId
    : null
  return { activeSummaryId, versions }
}

export function activeContextSummary(session: ChatSession): ChatContextSummary | null {
  const state = getContextCompression(session)
  return state.versions.find((item) => item.id === state.activeSummaryId) ?? null
}

async function putContextCompression(
  sessionId: string,
  state: ChatContextCompressionState,
): Promise<ChatSession | null> {
  const session = await db.sessions.get(sessionId)
  if (session === undefined) return null
  const metadata = { ...(session.metadata ?? {}) }
  if (state.versions.length === 0) {
    delete metadata[CONTEXT_COMPRESSION_KEY]
  } else {
    metadata[CONTEXT_COMPRESSION_KEY] = state
  }
  // 摘要只是上下文投影，不算一条新消息；保留 updatedAt，避免设置摘要把会话顶到列表最上面。
  const next: ChatSession = { ...session, ...(Object.keys(metadata).length === 0 ? { metadata: undefined } : { metadata }) }
  await db.sessions.put(next)
  return next
}

export async function saveContextSummary(
  sessionId: string,
  summary: ChatContextSummary,
): Promise<ChatSession | null> {
  const session = await db.sessions.get(sessionId)
  if (session === undefined) return null
  const current = getContextCompression(session)
  const version = current.versions.reduce((max, item) => Math.max(max, item.version), 0) + 1
  const nextSummary: ChatContextSummary = {
    ...summary,
    id: summary.id || crypto.randomUUID(),
    text: summary.text.trim().slice(0, CONTEXT_SUMMARY_LIMIT),
    version,
    source: 'model',
    updatedAt: Date.now(),
  }
  const versions = [nextSummary, ...current.versions].slice(0, CONTEXT_SUMMARY_VERSIONS_LIMIT)
  return putContextCompression(sessionId, { activeSummaryId: nextSummary.id, versions })
}

export async function editContextSummary(
  sessionId: string,
  summaryId: string,
  text: string,
): Promise<ChatSession | null> {
  const value = text.trim()
  if (value === '') throw new Error('摘要不能为空')
  if (value.length > CONTEXT_SUMMARY_LIMIT) throw new Error(`摘要不能超过 ${CONTEXT_SUMMARY_LIMIT} 字`)
  const session = await db.sessions.get(sessionId)
  if (session === undefined) return null
  const current = getContextCompression(session)
  const versions = current.versions.map((item) => item.id === summaryId
    ? { ...item, text: value, source: 'edited' as const, updatedAt: Date.now() }
    : item)
  if (!versions.some((item) => item.id === summaryId)) throw new Error('摘要版本不存在或已被清理')
  return putContextCompression(sessionId, { activeSummaryId: current.activeSummaryId, versions })
}

export async function setContextSummaryActive(
  sessionId: string,
  summaryId: string | null,
): Promise<ChatSession | null> {
  const session = await db.sessions.get(sessionId)
  if (session === undefined) return null
  const state = getContextCompression(session)
  if (summaryId !== null && !state.versions.some((item) => item.id === summaryId)) {
    throw new Error('摘要版本不存在或已被清理')
  }
  return putContextCompression(sessionId, { ...state, activeSummaryId: summaryId })
}

/* ---------- 会话分组（SPEC §2.1.3） ---------- */

/** 分区标题只有一行，名称过长会把右侧菜单按钮挤出去 */
export const SESSION_GROUP_NAME_MAX = 30

function normalizeGroupName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('分组名称不能为空')
  if (trimmed.length > SESSION_GROUP_NAME_MAX) {
    throw new Error(`分组名称不能超过 ${SESSION_GROUP_NAME_MAX} 字`)
  }
  return trimmed
}

/**
 * 按创建顺序取全部分组。
 * 「分组排序」是 SPEC §2.1.3 的后续扩展 —— 创建顺序同样是一个全序，删组也不会让兄弟分组换位，
 * 所以在引入显式排序字段之前，它比任何「按名称排」之类的猜测都稳。
 */
export async function listSessionGroups(): Promise<SessionGroup[]> {
  return db.sessionGroups.orderBy('createdAt').toArray()
}

export async function createSessionGroup(name: string): Promise<SessionGroup> {
  // 刻意不查重名：一个人自用，两个「工作」总比「建不出来但不说为什么」可接受。
  // 真要加约束，得连「同名时是合并还是拒绝」一起定，不适合顺手塞一条。
  const now = Date.now()
  const group: SessionGroup = {
    id: crypto.randomUUID(),
    type: 'session-group',
    name: normalizeGroupName(name),
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.sessionGroups.add(group)
  return group
}

/** 改名的 `updatedAt` 跟上：分组本身就是被编辑的对象（会话那边不跟，是因为它会牵动列表排序） */
export async function renameSessionGroup(id: string, name: string): Promise<SessionGroup | null> {
  const group = await db.sessionGroups.get(id)
  if (group === undefined) return null
  const next: SessionGroup = { ...group, name: normalizeGroupName(name), updatedAt: Date.now() }
  await db.sessionGroups.put(next)
  return next
}

/**
 * 折叠状态单独一个写口：它只在列表页被点，不牵动任何会话，改了它也不算「分组被编辑过」，
 * 所以**不动 `updatedAt`**。
 */
export async function setSessionGroupCollapsed(
  id: string,
  collapsed: boolean,
): Promise<SessionGroup | null> {
  const group = await db.sessionGroups.get(id)
  if (group === undefined) return null
  const next: SessionGroup = { ...group, collapsed }
  await db.sessionGroups.put(next)
  return next
}

/**
 * 删除分组：**只删分区，不删会话** —— 组内会话的 `groupId` 在同一事务里置回 `null`。
 * 返回被移出的会话数（确认语要说清影响了几条）。
 *
 * 必须同事务：分两步写会留下「会话指向一个已不存在的分组」的中间态，
 * 那种数据要靠读取方兜底才不丢，而兜底是会被忘记的。
 */
export async function deleteSessionGroup(id: string): Promise<number> {
  return db.transaction('rw', db.sessionGroups, db.sessions, async () => {
    const affected = await db.sessions
      .where('groupId')
      .equals(id)
      .modify((session: ChatSession) => {
        session.groupId = null
      })
    await db.sessionGroups.delete(id)
    return affected
  })
}

/**
 * 把会话移入 / 移出分组，`groupId` 传 `null` 即移出。
 *
 * 与置顶、会话设置一致**不刷新 `updatedAt`** —— 换个分区不代表这段对话又活跃了，
 * 否则整理一次分组就会把整个列表的活跃顺序搅乱。
 */
export async function setSessionGroup(
  sessionId: string,
  groupId: string | null,
): Promise<ChatSession | null> {
  const session = await db.sessions.get(sessionId)
  if (session === undefined) return null
  if (groupId !== null && (await db.sessionGroups.get(groupId)) === undefined) {
    // 不校验就会写下「指向不存在分组」的引用：那条会话哪个分区都不属于，等于从列表里消失
    throw new Error('目标分组不存在或已被删除')
  }
  const next: ChatSession = { ...session, groupId }
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
  publicThought?: string
  providerReasoning?: string
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
  const hasThoughtPatch = input.publicThought !== undefined || input.providerReasoning !== undefined
  const metadata = { ...message.metadata }
  if (input.publicThought !== undefined) {
    if (input.publicThought === '') delete metadata.publicThought
    else metadata.publicThought = capPublicThought(input.publicThought)
  }
  if (input.providerReasoning !== undefined) {
    if (input.providerReasoning === '') delete metadata.providerReasoning
    else metadata.providerReasoning = capReasoning(input.providerReasoning)
  }
  const next: ChatMessage = {
    ...message,
    blocks: [textBlock(input.content)],
    candidates: withNewVersion(message, input.content, origin),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(hasThoughtPatch ? { metadata } : {}),
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
