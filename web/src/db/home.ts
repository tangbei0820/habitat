import {
  MAX_PHOTO_BYTES,
  type BoardWidgetScope,
  type Artwork,
  type ArtworkCategory,
  type Bookmark,
  type BookmarkCategory,
  type ChatMessage,
  type CountdownCategory,
  type CountdownDay,
  type CountdownReminder,
  type CountdownRepeat,
  type DailyReadingEntry,
  type DiaryView,
  type HomeWidget,
  type HomeWidgetKind,
  type Moment,
  type MomentChannel,
  type MomentGroup,
  type Photo,
  type PhotoCollection,
  type PhotoMime,
  type ReadingNote,
  type ReadingAnnotation,
  type ReadingBookState,
  type ReadingFontSize,
  type ReadingStatus,
  type ReadingTheme,
  type ReadingVocabulary,
  type MusicTrack,
  type StudyRecord,
  type WishlistItem,
  type WishlistProgress,
  type WishlistProgressSourceType,
  type WishlistStatus,
  type ContentAuthor,
} from '@shared/types'
import { fetchJson, fetchVoid } from '../lib/api'
import { formatDuration } from '../lib/format'
import { db } from './db'

function nowId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function isConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'ConstraintError'
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${label}不能为空`)
  return normalized
}

/**
 * ⚠️ 留言板自 2026-09-24 起**权威存储在服务端**（`moment` 表）。
 *
 * 搬家不是为了「统一架构」，而是因为 AI 跑在服务端：留言板留在浏览器里，
 * 「小栖主动留言」就只能由前端伪造 —— 那是 SPEC §6.3 明令禁止的假数据。
 * 前端 Dexie 不再有 `moments` 表（v11 起）。
 */
export async function listMoments(query?: string, groupId?: string | null, channel: MomentChannel = 'board'): Promise<Moment[]> {
  const normalized = query?.trim() ?? ''
  const params = new URLSearchParams()
  params.set('channel', channel)
  if (normalized !== '') params.set('q', normalized)
  if (groupId !== undefined) params.set('groupId', groupId === null ? 'none' : groupId)
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`
  const data = await fetchJson<{ items: Moment[] }>(`/api/moments${suffix}`)
  return data.items
}

export async function getMoment(id: string): Promise<Moment | null> {
  try {
    return await fetchJson<Moment>(`/api/moments/${encodeURIComponent(id)}`)
  } catch {
    return null
  }
}

export async function listMomentGroups(): Promise<MomentGroup[]> {
  const data = await fetchJson<{ groups: MomentGroup[] }>('/api/moment-groups')
  return data.groups
}

export async function createMomentGroup(name: string): Promise<MomentGroup> {
  return fetchJson<MomentGroup>('/api/moment-groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: requiredText(name, '分组名称') }),
  })
}

export async function updateMomentGroup(id: string, name: string): Promise<MomentGroup> {
  return fetchJson<MomentGroup>(`/api/moment-groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: requiredText(name, '分组名称') }),
  })
}

export async function deleteMomentGroup(id: string): Promise<{ moved: number }> {
  return fetchJson<{ moved: number }>(`/api/moment-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function setMomentGroup(id: string, groupId: string | null): Promise<Moment> {
  return fetchJson<Moment>(`/api/moments/${encodeURIComponent(id)}/group`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groupId }),
  })
}

export async function createMoment(content: string, groupId: string | null = null, channel: MomentChannel = 'board'): Promise<Moment> {
  return fetchJson<Moment>('/api/moments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: requiredText(content, channel === 'feed' ? '动态' : '留言'), groupId, channel }),
  })
}

export async function updateMoment(id: string, content: string): Promise<Moment> {
  return fetchJson<Moment>(`/api/moments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: requiredText(content, '留言') }),
  })
}

export async function deleteMoment(id: string): Promise<void> {
  await fetchVoid(`/api/moments/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listWishlist(): Promise<WishlistItem[]> {
  const items = await db.wishlist.orderBy('updatedAt').reverse().toArray()
  return items.sort((a, b) => Number(a.status === 'done' || a.status === 'abandoned') - Number(b.status === 'done' || b.status === 'abandoned'))
}

function validDate(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === '') return null
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('请选择有效日期')
  return normalized
}

export async function createWishlistItem(title: string, targetDate?: string | null, author: ContentAuthor = 'user'): Promise<WishlistItem> {
  const at = Date.now()
  const item: WishlistItem = {
    id: nowId('wish'),
    type: 'wishlist-item',
    title: requiredText(title, '愿望'),
    status: 'open',
    completedAt: null,
    author,
    targetDate: validDate(targetDate),
    statusChangedAt: at,
    statusReason: null,
    progress: [],
    createdAt: at,
    updatedAt: at,
  }
  await db.wishlist.add(item)
  return item
}

export async function updateWishlistItem(id: string, patch: { title?: string; targetDate?: string | null; status?: WishlistStatus; statusReason?: string | null }): Promise<void> {
  const item = await db.wishlist.get(id)
  if (item === undefined) return
  const at = Date.now()
  const nextStatus = patch.status ?? item.status
  const statusChanged = nextStatus !== item.status
  const title = patch.title === undefined ? item.title : requiredText(patch.title, '愿望')
  const statusReason = patch.statusReason === undefined ? item.statusReason : (patch.statusReason?.trim() || null)
  await db.wishlist.update(id, {
    ...(patch.title === undefined ? {} : { title }),
    ...(patch.targetDate === undefined ? {} : { targetDate: validDate(patch.targetDate) }),
    ...(patch.status === undefined ? {} : { status: nextStatus, completedAt: nextStatus === 'done' ? (item.completedAt ?? at) : null }),
    ...(patch.statusReason === undefined ? {} : { statusReason }),
    ...(statusChanged ? { statusChangedAt: at } : {}),
    updatedAt: at,
  })
}

export async function toggleWishlistItem(id: string): Promise<void> {
  const item = await db.wishlist.get(id)
  if (item === undefined) return
  const done = item.status === 'open'
  const at = Date.now()
  await db.wishlist.update(id, {
    status: done ? 'done' : 'open',
    completedAt: done ? at : null,
    statusChangedAt: at,
    statusReason: null,
    updatedAt: at,
  })
}

export async function addWishlistProgress(id: string, note: string, author: ContentAuthor = 'user', sourceType: WishlistProgressSourceType | null = null, sourceId: string | null = null): Promise<WishlistProgress | null> {
  const item = await db.wishlist.get(id)
  if (item === undefined) return null
  const at = Date.now()
  const progress: WishlistProgress = { id: nowId('wish-progress'), type: 'wishlist-progress', note: requiredText(note, '进展'), author, sourceType, ...(sourceId === null ? {} : { sourceId }), createdAt: at, updatedAt: at }
  await db.wishlist.update(id, { progress: [...item.progress, progress], updatedAt: at })
  return progress
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await db.wishlist.delete(id)
}

export async function listCountdowns(): Promise<CountdownDay[]> {
  return db.countdowns.orderBy('targetDate').toArray()
}

export async function createCountdown(
  title: string,
  targetDate: string,
  category: CountdownCategory = 'other',
  repeat: CountdownRepeat = 'none',
  reminder: CountdownReminder = 'none',
): Promise<CountdownDay> {
  const normalizedDate = targetDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) throw new Error('请选择有效日期')
  const at = Date.now()
  const item: CountdownDay = {
    id: nowId('countdown'),
    type: 'countdown-day',
    title: requiredText(title, '倒数日名称'),
    targetDate: normalizedDate,
    category,
    repeat,
    reminder,
    createdAt: at,
    updatedAt: at,
  }
  await db.countdowns.add(item)
  return item
}

export async function updateCountdown(
  id: string,
  title: string,
  targetDate: string,
  category?: CountdownCategory,
  repeat?: CountdownRepeat,
  reminder?: CountdownReminder,
): Promise<CountdownDay | null> {
  const existing = await db.countdowns.get(id)
  if (existing === undefined) return null
  const next: CountdownDay = {
    ...existing,
    title: requiredText(title, '倒数日名称'),
    targetDate: requiredDate(targetDate),
    category: category ?? existing.category,
    repeat: repeat ?? existing.repeat,
    reminder: reminder ?? existing.reminder,
    updatedAt: Date.now(),
  }
  await db.countdowns.put(next)
  return next
}

/**
 * 删倒数日时**必须顺手清掉指向它的主屏 Widget**（SPEC §1.4 / §3.3.2）：
 * 否则主屏上会留一张写着不存在日子的卡片。放在同一个事务里，
 * 避免「日删掉了、删除 widget 那步失败」留下半个状态。
 *
 * 这是**两层兜底的第一层**：渲染层对失效引用也有兜底（`listHomeWidgetViews`），
 * 那一层防的是别的来源（例如导入的备份里带着指向不存在实体的引用）。
 */
export async function deleteCountdown(id: string): Promise<void> {
  await db.transaction('rw', [db.countdowns, db.homeWidgets], async () => {
    await db.countdowns.delete(id)
    const widget = await db.homeWidgets.where('kind').equals('countdown').first()
    if (widget !== undefined && widget.refId === id) await db.homeWidgets.delete(widget.id)
  })
}

function requiredDate(value: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('请选择有效日期')
  return normalized
}

/**
 * ⚠️ 日记自 2026-09-24 起**权威存储在服务端**（`diary` 表），返回类型也从 `Diary` 换成 `DiaryView`。
 *
 * 换类型不是改名：AI 的日记**可能没有正文**（SPEC §3.4.2 —— 用户看得到有几篇、看得到封面，
 * 要读正文得先请求）。用 `readable` / `editable` 显式表达，页面就不必去猜
 * 「content 为空是没权限还是还没写」—— 那是两种完全不同的情况。
 */
export async function listDiaries(query?: string): Promise<DiaryView[]> {
  const normalized = query?.trim() ?? ''
  const suffix = normalized === '' ? '' : `?q=${encodeURIComponent(normalized)}`
  const data = await fetchJson<{ items: DiaryView[] }>(`/api/diary${suffix}`)
  return data.items
}

export async function createDiary(title: string, content: string, entryDate: string): Promise<DiaryView> {
  return fetchJson<DiaryView>('/api/diary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: requiredText(title, '日记标题'),
      content: requiredText(content, '日记正文'),
      entryDate: requiredDate(entryDate),
    }),
  })
}

export async function updateDiary(id: string, title: string, content: string, entryDate: string): Promise<DiaryView> {
  return fetchJson<DiaryView>(`/api/diary/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: requiredText(title, '日记标题'),
      content: requiredText(content, '日记正文'),
      entryDate: requiredDate(entryDate),
    }),
  })
}

export async function deleteDiary(id: string): Promise<void> {
  await fetchVoid(`/api/diary/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listBookmarks(): Promise<Bookmark[]> {
  return db.bookmarks.orderBy('createdAt').reverse().toArray()
}

export const BOOKMARK_TAG_MAX = 20
export const BOOKMARK_TAGS_MAX = 12

export function normalizeBookmarkTags(value: string | string[]): string[] {
  const source = Array.isArray(value) ? value : value.split(/[,，\n]/)
  const result: string[] = []
  for (const raw of source) {
    const tag = raw.trim()
    if (tag === '') continue
    if (tag.length > BOOKMARK_TAG_MAX) throw new Error(`标签不能超过 ${BOOKMARK_TAG_MAX} 字`)
    if (!result.includes(tag)) result.push(tag)
    if (result.length > BOOKMARK_TAGS_MAX) throw new Error(`最多添加 ${BOOKMARK_TAGS_MAX} 个标签`)
  }
  return result
}

function normalizeExternalUrl(value: string): string {
  const normalized = value.trim()
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('请输入完整链接（含 http:// 或 https://）')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('收藏链接只支持 http:// 或 https://')
  }
  return url.toString()
}

export async function createExternalBookmark(title: string, href: string, note: string): Promise<Bookmark> {
  const targetId = normalizeExternalUrl(href)
  const existing = await db.bookmarks.where('[targetType+targetId]').equals(['external-link', targetId]).first()
  if (existing !== undefined) throw new Error('这个链接已经收藏过了')
  const at = Date.now()
  const item: Bookmark = {
    id: nowId('bookmark'),
    type: 'bookmark',
    targetType: 'external-link',
    targetId,
    title: requiredText(title, '收藏名称'),
    note: note.trim() === '' ? null : note.trim(),
    categoryId: null,
    tags: [],
    createdAt: at,
    updatedAt: at,
  }
  await db.bookmarks.add(item)
  return item
}

const CHAT_SNAPSHOT_LIMIT = 3_000

function clipped(value: string, limit: number): string {
  const normalized = value.trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function sourceActor(message: ChatMessage): string {
  if (message.role === 'user') return '你'
  if (message.role === 'assistant') return '小栖'
  if (message.role === 'system') return '系统'
  return '工具'
}

/**
 * 给跨模块条目保存一份稳定、纯文本的消息快照。
 * HTML 只按原文保存、不渲染；图片只记可读说明，避免把 data URL 再复制一遍。
 */
function chatSnapshot(message: ChatMessage): string {
  const parts = [...message.blocks]
    .sort((a, b) => a.order - b.order)
    .map((block): string => {
      switch (block.kind) {
        case 'text': return block.payload.text
        case 'html': return `[HTML]\n${block.payload.html}`
        case 'image': return `[图片] ${block.payload.alt?.trim() || '聊天图片'}`
        // 时长是可选的（LLM 或外部来源给的音频可能没有），缺了就不硬编一个 0:00
        case 'audio': {
          const duration = block.payload.durationMs === undefined ? '' : ` ${formatDuration(block.payload.durationMs)}`
          return `[音频${duration}] ${block.payload.transcript?.trim() || '聊天音频'}`
        }
        case 'file': return `[文件] ${block.payload.name}`
        case 'sticker': return `[表情包] ${block.payload.name}`
        case 'tool-result': return `[工具结果] ${block.payload.toolName}${block.payload.summary === undefined ? '' : `：${block.payload.summary}`}`
        case 'widget': return `[组件] ${block.payload.title?.trim() || block.payload.source?.trim() || '未命名组件'}`
        case 'tab-group': return `[组件组] ${block.payload.tabs.map((tab) => tab.label).join(' / ')}`
      }
    })
    .filter((part) => part.trim() !== '')
  return clipped(parts.join('\n\n'), CHAT_SNAPSHOT_LIMIT) || '（无可读文本的消息）'
}

function chatSourceMetadata(message: ChatMessage, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceModule: 'chat',
    sourceObjectType: 'chat-message',
    sourceRole: message.role,
    sourceCreatedAt: message.createdAt,
    sourceBlockKinds: message.blocks.map((block) => block.kind),
    ...extra,
  }
}

function chatEntryTitle(message: ChatMessage, snapshot: string): string {
  const firstLine = snapshot.split(/\r?\n/, 1)[0]?.replace(/^\[[^\]]+\]\s*/, '').trim() ?? ''
  return clipped(`${sourceActor(message)}的消息 · ${firstLine || '聊天内容'}`, 120)
}

/** 从消息原位写入统一收藏；复合唯一索引仍是最后一道并发去重闸门。 */
export async function createMessageBookmark(message: ChatMessage): Promise<Bookmark> {
  const existing = await db.bookmarks.where('[targetType+targetId]').equals(['chat-message', message.id]).first()
  if (existing !== undefined) throw new Error('这条消息已经收藏过了')
  const at = Date.now()
  const snapshot = chatSnapshot(message)
  const item: Bookmark = {
    id: nowId('bookmark'),
    type: 'bookmark',
    targetType: 'chat-message',
    targetId: message.id,
    title: chatEntryTitle(message, snapshot),
    note: snapshot,
    categoryId: null,
    tags: [],
    sourceId: message.id,
    sessionId: message.sessionId,
    metadata: chatSourceMetadata(message),
    createdAt: at,
    updatedAt: at,
  }
  try {
    await db.bookmarks.add(item)
  } catch (err) {
    if (isConstraintError(err)) throw new Error('这条消息已经收藏过了')
    throw err
  }
  return item
}

/** 从留言板原位收藏，保存一份稳定快照；编辑原留言不会悄悄改写收藏历史。 */
export async function createMomentBookmark(moment: Moment): Promise<Bookmark> {
  const existing = await db.bookmarks.where('[targetType+targetId]').equals(['moment', moment.id]).first()
  if (existing !== undefined) throw new Error('这条留言已经收藏过了')
  const at = Date.now()
  const authorLabel = moment.author === 'companion' ? '小栖' : '你'
  const item: Bookmark = {
    id: nowId('bookmark'),
    type: 'bookmark',
    targetType: 'moment',
    targetId: moment.id,
    title: `${authorLabel}${moment.channel === 'feed' ? '的动态' : '的留言'}`,
    note: moment.content,
    categoryId: null,
    tags: [],
    sourceId: moment.id,
    metadata: {
      sourceModule: moment.channel === 'feed' ? 'home-feed' : 'home-board',
      sourceObjectType: 'moment',
      sourceChannel: moment.channel,
      sourceAuthor: moment.author,
      sourceContent: moment.content,
      sourceCreatedAt: moment.createdAt,
      sourceUpdatedAt: moment.updatedAt,
    },
    createdAt: at,
    updatedAt: at,
  }
  try {
    await db.bookmarks.add(item)
  } catch (err) {
    if (isConstraintError(err)) throw new Error('这条留言已经收藏过了')
    throw err
  }
  return item
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id)
}

export async function updateBookmarkTags(id: string, tags: string | string[]): Promise<Bookmark | null> {
  const bookmark = await db.bookmarks.get(id)
  if (bookmark === undefined) return null
  const next: Bookmark = { ...bookmark, tags: normalizeBookmarkTags(tags), updatedAt: Date.now() }
  await db.bookmarks.put(next)
  return next
}

/* ------------------------------------------------------------------ *
 * 分类：收藏分类（SPEC §3.5.4）与相册（§3.7.3）
 *
 * 两组是**同构**的：创建 / 改名 / 删除 / 设置归属各一套，语义完全对齐
 * （单归属、删分类不删条目、归属字段一定有值）。改其中一组时请对照另一组 ——
 * 它们没有抽成泛型工厂，是因为真正不同的那部分（从属表与字段名）无法参数化，
 * 能省下的只有几个几行的函数，换来的是为一处 spread 加类型断言的代价。
 * ------------------------------------------------------------------ */

export const CATEGORY_NAME_MAX = 30

/**
 * 名称归一化：与分组名同一套规则（trim + 非空 + 30 字上限）。
 * 刻意**不查重名** —— 与 `createSessionGroup` 同样的取舍：两个「工作」总比
 * 「建不出来但不说为什么」可接受。
 */
function normalizeCategoryName(name: string, label: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error(`${label}名称不能为空`)
  if (trimmed.length > CATEGORY_NAME_MAX) {
    throw new Error(`${label}名称不能超过 ${CATEGORY_NAME_MAX} 字`)
  }
  return trimmed
}

export async function listBookmarkCategories(): Promise<BookmarkCategory[]> {
  return db.bookmarkCategories.orderBy('createdAt').toArray()
}

export async function createBookmarkCategory(name: string): Promise<BookmarkCategory> {
  const now = Date.now()
  const item: BookmarkCategory = {
    id: nowId('bookmark-category'),
    type: 'bookmark-category',
    name: normalizeCategoryName(name, '分类'),
    createdAt: now,
    updatedAt: now,
  }
  await db.bookmarkCategories.add(item)
  return item
}

/** 改名的 `updatedAt` 跟上：分类本身就是被编辑的对象（收藏条目不跟，理由同 `setBookmarkCategory`） */
export async function renameBookmarkCategory(
  id: string,
  name: string,
): Promise<BookmarkCategory | null> {
  const category = await db.bookmarkCategories.get(id)
  if (category === undefined) return null
  const next: BookmarkCategory = {
    ...category,
    name: normalizeCategoryName(name, '分类'),
    updatedAt: Date.now(),
  }
  await db.bookmarkCategories.put(next)
  return next
}

/**
 * 删除分类：**只删分类，不删收藏** —— 类内收藏的 `categoryId` 在同一事务里置回 `null`。
 * 返回被移出的条数（确认语要说清影响了几条）。做法与 `deleteSessionGroup` 一致：
 * 分两步写会留下「收藏指向一个已不存在的分类」的中间态。
 */
export async function deleteBookmarkCategory(id: string): Promise<number> {
  return db.transaction('rw', db.bookmarkCategories, db.bookmarks, async () => {
    const affected = await db.bookmarks
      .where('categoryId')
      .equals(id)
      .modify((bookmark: Bookmark) => {
        bookmark.categoryId = null
      })
    await db.bookmarkCategories.delete(id)
    return affected
  })
}

/**
 * 把收藏移入 / 移出分类，`categoryId` 传 `null` 即移出。
 * 与分组一致**不刷新 `updatedAt`** —— 换个收纳位置不代表这条收藏又被看过一次。
 */
export async function setBookmarkCategory(
  bookmarkId: string,
  categoryId: string | null,
): Promise<Bookmark | null> {
  const bookmark = await db.bookmarks.get(bookmarkId)
  if (bookmark === undefined) return null
  if (categoryId !== null && (await db.bookmarkCategories.get(categoryId)) === undefined) {
    // 不校验就会写下「指向不存在分类」的引用：那条收藏哪个筛选里都看不到
    throw new Error('目标分类不存在或已被删除')
  }
  const next: Bookmark = { ...bookmark, categoryId }
  await db.bookmarks.put(next)
  return next
}

const ARTWORK_CATEGORIES: readonly ArtworkCategory[] = ['writing', 'visual', 'audio', 'other']

function optionalHttpUrl(value: string): string | null {
  const normalized = value.trim()
  if (normalized === '') return null
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('作品链接需要包含 http:// 或 https://')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('作品链接只支持 HTTP(S)')
  return url.toString()
}

export async function listArtworks(): Promise<Artwork[]> {
  return db.artworks.orderBy('updatedAt').reverse().toArray()
}

export async function createArtwork(
  title: string,
  category: ArtworkCategory,
  description: string,
  externalUrl: string,
): Promise<Artwork> {
  if (!ARTWORK_CATEGORIES.includes(category)) throw new Error('作品类型无效')
  const at = Date.now()
  const item: Artwork = {
    id: nowId('artwork'),
    type: 'artwork',
    title: requiredText(title, '作品名称'),
    category,
    description: requiredText(description, '作品说明'),
    externalUrl: optionalHttpUrl(externalUrl),
    createdAt: at,
    updatedAt: at,
  }
  await db.artworks.add(item)
  return item
}

function artworkCategoryFor(message: ChatMessage): ArtworkCategory {
  if (message.blocks.some((block) => block.kind === 'image' || block.kind === 'sticker' || block.kind === 'html' || block.kind === 'widget' || block.kind === 'tab-group')) return 'visual'
  if (message.blocks.some((block) => block.kind === 'audio')) return 'audio'
  if (message.blocks.some((block) => block.kind === 'text')) return 'writing'
  return 'other'
}

/** 收录整条消息（含组件摘要）为作品快照；消息 id 同时承担稳定去重身份。 */
export async function createMessageArtwork(message: ChatMessage): Promise<Artwork> {
  const id = `artwork-chat-${message.id}`
  if (await db.artworks.get(id) !== undefined) throw new Error('这条消息已经收录到作品了')
  const at = Date.now()
  const snapshot = chatSnapshot(message)
  const item: Artwork = {
    id,
    type: 'artwork',
    title: chatEntryTitle(message, snapshot),
    category: artworkCategoryFor(message),
    description: snapshot,
    externalUrl: null,
    sourceId: message.id,
    sessionId: message.sessionId,
    metadata: chatSourceMetadata(message),
    createdAt: at,
    updatedAt: at,
  }
  try {
    await db.artworks.add(item)
  } catch (err) {
    if (isConstraintError(err)) throw new Error('这条消息已经收录到作品了')
    throw err
  }
  return item
}

export async function updateArtwork(
  id: string,
  title: string,
  category: ArtworkCategory,
  description: string,
  externalUrl: string,
): Promise<void> {
  if (!ARTWORK_CATEGORIES.includes(category)) throw new Error('作品类型无效')
  const changed = await db.artworks.update(id, {
    title: requiredText(title, '作品名称'),
    category,
    description: requiredText(description, '作品说明'),
    externalUrl: optionalHttpUrl(externalUrl),
    updatedAt: Date.now(),
  })
  if (changed === 0) throw new Error('这件作品已经不存在')
}

export async function deleteArtwork(id: string): Promise<void> {
  await db.artworks.delete(id)
}

const PHOTO_MIMES: readonly PhotoMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function hasExpectedBase64Size(dataUrl: string, mimeType: string, sizeBytes: number): boolean {
  const prefix = `data:${mimeType};base64,`
  if (!dataUrl.startsWith(prefix)) return false
  const payload = dataUrl.slice(prefix.length)
  if (payload.length === 0 || payload.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return false
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor(payload.length * 3 / 4) - padding === sizeBytes
}

export async function listPhotos(): Promise<Photo[]> {
  return db.photos.orderBy('takenAt').reverse().toArray()
}

export async function createPhoto(input: {
  title: string
  caption: string
  imageDataUrl: string
  mimeType: string
  sizeBytes: number
  takenAt: string
}): Promise<Photo> {
  if (!PHOTO_MIMES.includes(input.mimeType as PhotoMime)) throw new Error('只支持 PNG、JPEG、WebP 或 GIF 图片')
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_PHOTO_BYTES) {
    throw new Error('图片大小必须在 3 MB 以内')
  }
  if (!hasExpectedBase64Size(input.imageDataUrl, input.mimeType, input.sizeBytes)) throw new Error('图片内容与格式或大小不匹配')
  const at = Date.now()
  const item: Photo = {
    id: nowId('photo'),
    type: 'photo',
    title: requiredText(input.title, '照片名称'),
    caption: input.caption.trim() === '' ? null : input.caption.trim(),
    imageDataUrl: input.imageDataUrl,
    mimeType: input.mimeType as PhotoMime,
    sizeBytes: input.sizeBytes,
    takenAt: requiredDate(input.takenAt),
    collectionId: null,
    createdAt: at,
    updatedAt: at,
  }
  await db.photos.add(item)
  return item
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取聊天图片'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取聊天图片'))
    reader.readAsDataURL(blob)
  })
}

async function loadChatImage(url: string): Promise<{ dataUrl: string; mimeType: PhotoMime; sizeBytes: number }> {
  let parsed: URL
  try {
    parsed = new URL(url, window.location.href)
  } catch {
    throw new Error('聊天图片地址无效，无法加入相册')
  }
  if (!['data:', 'blob:', 'http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('聊天图片来源不受支持，无法加入相册')
  }
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    // 离线时外部图片必然取不到 —— 别把它说成「跨域」，那会把人引到完全错误的方向去查
    throw new Error(navigator.onLine === false
      ? '当前离线，需要联网才能读取这张外部图片'
      : '无法读取聊天图片，可能是图片来源禁止跨域访问')
  }
  if (!response.ok) throw new Error(`无法读取聊天图片（${response.status}）`)
  const blob = await response.blob()
  const mimeType = blob.type.split(';', 1)[0]?.toLowerCase() ?? ''
  if (!PHOTO_MIMES.includes(mimeType as PhotoMime)) throw new Error('聊天图片不是可收录的 PNG、JPEG、WebP 或 GIF')
  if (blob.size <= 0 || blob.size > MAX_PHOTO_BYTES) throw new Error('聊天图片大小必须在 3 MB 以内')
  return { dataUrl: await blobAsDataUrl(blob), mimeType: mimeType as PhotoMime, sizeBytes: blob.size }
}

export interface MessagePhotoCaptureResult {
  added: Photo[]
  skipped: number
}

export interface MessagePhotoCaptureOptions {
  /** 只收录指定的顶层图片块；不传则保持手动入口的「整条消息」语义。 */
  blockOrders?: number[]
  /** 自动收集时重复是正常状态，不应抛异常打断聊天。 */
  throwOnAllSkipped?: boolean
}

/**
 * 把消息里的所有顶层图片一次加入相册。先把图片全部读完再开事务，避免第二张失败时只留下第一张。
 * 以「消息 id + block.order」生成稳定主键，所以重复点击不会产生副本。
 */
export async function createMessagePhotos(message: ChatMessage, options: MessagePhotoCaptureOptions = {}): Promise<MessagePhotoCaptureResult> {
  const allowedOrders = options.blockOrders === undefined ? null : new Set(options.blockOrders)
  const images = message.blocks.filter((block): block is Extract<ChatMessage['blocks'][number], { kind: 'image' }> => block.kind === 'image' && (allowedOrders === null || allowedOrders.has(block.order)))
  if (images.length === 0) {
    if (options.throwOnAllSkipped === false) return { added: [], skipped: 0 }
    throw new Error('这条消息里没有可加入相册的图片')
  }
  const prepared = await Promise.all(images.map(async (block, index) => {
    const loaded = await loadChatImage(block.payload.url)
    const at = Date.now()
    const title = clipped(block.payload.alt?.trim() || `聊天图片 ${index + 1}`, 120)
    const item: Photo = {
      id: `photo-chat-${message.id}-${block.order}`,
      type: 'photo',
      title,
      caption: `来自${sourceActor(message)}的聊天消息`,
      imageDataUrl: loaded.dataUrl,
      mimeType: loaded.mimeType,
      sizeBytes: loaded.sizeBytes,
      takenAt: localDateKey(message.createdAt),
      collectionId: null,
      sourceId: message.id,
      sessionId: message.sessionId,
      metadata: chatSourceMetadata(message, {
        sourceBlockKind: 'image',
        sourceBlockOrder: block.order,
        ...(message.metadata?.imageSource === 'generated' ? { sourceImageOrigin: 'generated' } : {}),
      }),
      createdAt: at,
      updatedAt: at,
    }
    return item
  }))

  const added: Photo[] = []
  let skipped = 0
  await db.transaction('rw', db.photos, async () => {
    for (const item of prepared) {
      if (await db.photos.get(item.id) !== undefined) {
        skipped += 1
      } else {
        await db.photos.add(item)
        added.push(item)
      }
    }
  })
  if (added.length === 0 && options.throwOnAllSkipped !== false) {
    throw new Error(images.length === 1 ? '这张图片已经加入相册了' : '这条消息里的图片已经全部加入相册了')
  }
  return { added, skipped }
}

export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id)
}

export async function listPhotoCollections(): Promise<PhotoCollection[]> {
  return db.photoCollections.orderBy('createdAt').toArray()
}

export async function createPhotoCollection(name: string): Promise<PhotoCollection> {
  const now = Date.now()
  const item: PhotoCollection = {
    id: nowId('photo-collection'),
    type: 'photo-collection',
    name: normalizeCategoryName(name, '相册'),
    createdAt: now,
    updatedAt: now,
  }
  await db.photoCollections.add(item)
  return item
}

export async function renamePhotoCollection(
  id: string,
  name: string,
): Promise<PhotoCollection | null> {
  const collection = await db.photoCollections.get(id)
  if (collection === undefined) return null
  const next: PhotoCollection = {
    ...collection,
    name: normalizeCategoryName(name, '相册'),
    updatedAt: Date.now(),
  }
  await db.photoCollections.put(next)
  return next
}

/** 删除相册：**只删相册，不删照片** —— 册内照片的 `collectionId` 在同一事务里置回 `null`。 */
export async function deletePhotoCollection(id: string): Promise<number> {
  return db.transaction('rw', db.photoCollections, db.photos, async () => {
    const affected = await db.photos
      .where('collectionId')
      .equals(id)
      .modify((photo: Photo) => {
        photo.collectionId = null
      })
    await db.photoCollections.delete(id)
    return affected
  })
}

/**
 * 把照片移入 / 移出相册，`collectionId` 传 `null` 即移出（**照片本身仍在**，
 * 与 `deletePhoto` 是两件事，SPEC §3.7.3）。
 */
export async function setPhotoCollection(
  photoId: string,
  collectionId: string | null,
): Promise<Photo | null> {
  const photo = await db.photos.get(photoId)
  if (photo === undefined) return null
  if (collectionId !== null && (await db.photoCollections.get(collectionId)) === undefined) {
    throw new Error('目标相册不存在或已被删除')
  }
  const next: Photo = { ...photo, collectionId }
  await db.photos.put(next)
  return next
}

const READING_STATUSES: readonly ReadingStatus[] = ['want', 'reading', 'finished']

export const MAX_READING_TEXT_CHARS = 2_000_000

function isReadingAnnotation(value: unknown): value is ReadingAnnotation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.paragraphIndex === 'number' && Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0 &&
    typeof item.text === 'string' && typeof item.note === 'string' &&
    (item.author === 'user' || item.author === 'companion') && typeof item.createdAt === 'number'
}

function isReadingVocabulary(value: unknown): value is ReadingVocabulary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.paragraphIndex === 'number' && Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0 &&
    typeof item.term === 'string' && typeof item.note === 'string' && typeof item.createdAt === 'number'
}

/** 兼容旧的读书笔记：没有 reader 元数据就仍按普通笔记展示。 */
export function getReadingBook(item: ReadingNote): ReadingBookState | null {
  const value = item.metadata?.reader
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const currentParagraph = raw.currentParagraph
  const bookmarkParagraph = raw.bookmarkParagraph
  const readingSeconds = raw.readingSeconds
  const annotations = raw.annotations
  const vocabulary = raw.vocabulary
  const theme: ReadingTheme = raw.theme === 'sepia' || raw.theme === 'night' ? raw.theme : 'paper'
  const fontSize: ReadingFontSize = raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : 'medium'
  if (raw.format !== 'txt' || typeof raw.content !== 'string' || raw.content.length > MAX_READING_TEXT_CHARS ||
    typeof currentParagraph !== 'number' || !Number.isInteger(currentParagraph) || currentParagraph < 0 ||
    !(bookmarkParagraph === null || (typeof bookmarkParagraph === 'number' && Number.isInteger(bookmarkParagraph) && bookmarkParagraph >= 0)) ||
    typeof readingSeconds !== 'number' || !Number.isInteger(readingSeconds) || readingSeconds < 0 || !Array.isArray(annotations) ||
    !annotations.every(isReadingAnnotation) || (vocabulary !== undefined && (!Array.isArray(vocabulary) || !vocabulary.every(isReadingVocabulary)))) return null
  return {
    format: 'txt',
    content: raw.content,
    currentParagraph,
    bookmarkParagraph,
    readingSeconds,
    annotations,
    theme,
    fontSize,
    vocabulary: vocabulary === undefined ? [] : vocabulary,
  }
}

export async function listReadingNotes(): Promise<ReadingNote[]> {
  return db.readingNotes.orderBy('updatedAt').reverse().toArray()
}

export async function createReadingNote(bookTitle: string, author: string, status: ReadingStatus, note: string): Promise<ReadingNote> {
  if (!READING_STATUSES.includes(status)) throw new Error('阅读状态无效')
  const at = Date.now()
  const item: ReadingNote = {
    id: nowId('reading'), type: 'reading-note', bookTitle: requiredText(bookTitle, '书名'),
    author: author.trim() === '' ? null : author.trim(), status, note: requiredText(note, '读书笔记'), createdAt: at, updatedAt: at,
  }
  await db.readingNotes.add(item)
  return item
}

export async function updateReadingNote(id: string, bookTitle: string, author: string, status: ReadingStatus, note: string): Promise<void> {
  if (!READING_STATUSES.includes(status)) throw new Error('阅读状态无效')
  const changed = await db.readingNotes.update(id, {
    bookTitle: requiredText(bookTitle, '书名'), author: author.trim() === '' ? null : author.trim(),
    status, note: requiredText(note, '读书笔记'), updatedAt: Date.now(),
  })
  if (changed === 0) throw new Error('这条读书笔记已经不存在')
}

export async function deleteReadingNote(id: string): Promise<void> {
  await db.readingNotes.delete(id)
}

export async function createReadingBook(bookTitle: string, author: string, content: string): Promise<ReadingNote> {
  const title = requiredText(bookTitle, '书名')
  const normalized = content.replace(/\r\n?/g, '\n')
  if (normalized.trim() === '') throw new Error('书籍内容不能为空')
  if (normalized.length > MAX_READING_TEXT_CHARS) throw new Error('TXT 文件过大，请先拆分到 2,000,000 字以内')
  const at = Date.now()
  const reader: ReadingBookState = {
    format: 'txt', content: normalized, currentParagraph: 0, bookmarkParagraph: null, readingSeconds: 0, annotations: [],
    theme: 'paper', fontSize: 'medium', vocabulary: [],
  }
  const item: ReadingNote = {
    id: nowId('reading-book'), type: 'reading-note', bookTitle: title,
    author: author.trim() === '' ? null : author.trim(), status: 'reading', note: '',
    metadata: { reader }, createdAt: at, updatedAt: at,
  }
  await db.readingNotes.add(item)
  return item
}

export async function updateReadingBookState(id: string, patch: Partial<Pick<ReadingBookState, 'currentParagraph' | 'bookmarkParagraph' | 'readingSeconds' | 'theme' | 'fontSize'>>): Promise<ReadingNote> {
  const item = await db.readingNotes.get(id)
  if (item === undefined) throw new Error('这本书已经不存在')
  const reader = getReadingBook(item)
  if (reader === null) throw new Error('这不是可打开的阅读内容')
  const next: ReadingNote = {
    ...item,
    metadata: { ...item.metadata, reader: { ...reader, ...patch } },
    updatedAt: Date.now(),
  }
  await db.readingNotes.put(next)
  return next
}

export async function addReadingVocabulary(id: string, paragraphIndex: number, term: string, note: string): Promise<ReadingNote> {
  const item = await db.readingNotes.get(id)
  if (item === undefined) throw new Error('这本书已经不存在')
  const reader = getReadingBook(item)
  if (reader === null) throw new Error('这不是可打开的阅读内容')
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= reader.content.split('\n').length) throw new Error('生词位置无效')
  const normalizedTerm = requiredText(term, '生词').slice(0, 120)
  if (reader.vocabulary.some((word) => word.paragraphIndex === paragraphIndex && word.term === normalizedTerm)) throw new Error('这个生词已经记过了')
  const vocabulary: ReadingVocabulary = { id: nowId('reading-vocabulary'), paragraphIndex, term: normalizedTerm, note: note.trim().slice(0, 1000), createdAt: Date.now() }
  const next: ReadingNote = { ...item, metadata: { ...item.metadata, reader: { ...reader, vocabulary: [...reader.vocabulary, vocabulary] } }, updatedAt: Date.now() }
  await db.readingNotes.put(next)
  return next
}

export async function deleteReadingVocabulary(id: string, vocabularyId: string): Promise<ReadingNote> {
  const item = await db.readingNotes.get(id)
  if (item === undefined) throw new Error('这本书已经不存在')
  const reader = getReadingBook(item)
  if (reader === null) throw new Error('这不是可打开的阅读内容')
  const next: ReadingNote = { ...item, metadata: { ...item.metadata, reader: { ...reader, vocabulary: reader.vocabulary.filter((word) => word.id !== vocabularyId) } }, updatedAt: Date.now() }
  await db.readingNotes.put(next)
  return next
}

export async function addReadingAnnotation(id: string, paragraphIndex: number, text: string, note: string): Promise<ReadingNote> {
  const item = await db.readingNotes.get(id)
  if (item === undefined) throw new Error('这本书已经不存在')
  const reader = getReadingBook(item)
  if (reader === null) throw new Error('这不是可打开的阅读内容')
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= reader.content.split('\n').length) throw new Error('划线位置无效')
  const highlight = requiredText(text, '划线内容').slice(0, 500)
  const annotation: ReadingAnnotation = {
    id: nowId('reading-annotation'), paragraphIndex, text: highlight,
    note: note.trim().slice(0, 2000), author: 'user', createdAt: Date.now(),
  }
  const next: ReadingNote = {
    ...item,
    metadata: { ...item.metadata, reader: { ...reader, annotations: [...reader.annotations, annotation] } },
    updatedAt: Date.now(),
  }
  await db.readingNotes.put(next)
  return next
}

export async function deleteReadingAnnotation(id: string, annotationId: string): Promise<ReadingNote> {
  const item = await db.readingNotes.get(id)
  if (item === undefined) throw new Error('这本书已经不存在')
  const reader = getReadingBook(item)
  if (reader === null) throw new Error('这不是可打开的阅读内容')
  const next: ReadingNote = {
    ...item,
    metadata: { ...item.metadata, reader: { ...reader, annotations: reader.annotations.filter((annotation) => annotation.id !== annotationId) } },
    updatedAt: Date.now(),
  }
  await db.readingNotes.put(next)
  return next
}

const DAILY_READING_RECENT_LIMIT = 8
const DAILY_READING_TEXT_LIMIT = 1_200

export async function listDailyReadings(): Promise<DailyReadingEntry[]> {
  return db.dailyReadings.orderBy('createdAt').reverse().toArray()
}

/** 从现有 TXT 书架抽取片段；最近 8 次已经读过的段落会暂时避开。 */
export async function pickDailyReading(): Promise<DailyReadingEntry | null> {
  const books = await listReadingNotes()
  const candidates: Array<{ book: ReadingNote; paragraphIndex: number; text: string }> = []
  for (const book of books) {
    const reader = getReadingBook(book)
    if (reader === null) continue
    reader.content.split('\n').forEach((paragraph, paragraphIndex) => {
      const text = paragraph.trim()
      if (text !== '') candidates.push({ book, paragraphIndex, text: text.slice(0, DAILY_READING_TEXT_LIMIT) })
    })
  }
  if (candidates.length === 0) return null
  const recent = await db.dailyReadings.orderBy('createdAt').reverse().limit(DAILY_READING_RECENT_LIMIT).toArray()
  const recentKeys = new Set(recent.map((item) => `${item.sourceBookId}:${item.paragraphIndex}`))
  const fresh = candidates.filter((item) => !recentKeys.has(`${item.book.id}:${item.paragraphIndex}`))
  const pool = fresh.length > 0 ? fresh : candidates
  const chosen = pool[Math.floor(Math.random() * pool.length)]
  const at = Date.now()
  const entry: DailyReadingEntry = {
    id: nowId('daily-reading'), type: 'daily-reading', sourceBookId: chosen.book.id,
    paragraphIndex: chosen.paragraphIndex, bookTitle: chosen.book.bookTitle, author: chosen.book.author,
    text: chosen.text, createdAt: at, updatedAt: at,
  }
  await db.dailyReadings.add(entry)
  return entry
}

export async function createReadingExcerptBookmark(entry: DailyReadingEntry): Promise<Bookmark> {
  const existing = await db.bookmarks.where('[targetType+targetId]').equals(['reading-excerpt', entry.id]).first()
  if (existing !== undefined) throw new Error('这段品读已经收藏过了')
  const at = Date.now()
  const item: Bookmark = {
    id: nowId('bookmark'), type: 'bookmark', targetType: 'reading-excerpt', targetId: entry.id,
    title: `《${entry.bookTitle}》的品读片段`, note: entry.text, categoryId: null, tags: [], sourceId: entry.id,
    metadata: {
      sourceModule: 'home-daily-reading', sourceObjectType: 'daily-reading', sourceBookId: entry.sourceBookId,
      paragraphIndex: entry.paragraphIndex, bookTitle: entry.bookTitle, author: entry.author, sourceCreatedAt: entry.createdAt,
    }, createdAt: at, updatedAt: at,
  }
  try {
    await db.bookmarks.add(item)
  } catch (err) {
    if (isConstraintError(err)) throw new Error('这段品读已经收藏过了')
    throw err
  }
  return item
}

export async function listMusicTracks(): Promise<MusicTrack[]> {
  return db.musicTracks.orderBy('updatedAt').reverse().toArray()
}

export async function createMusicTrack(title: string, artist: string, note: string, externalUrl: string): Promise<MusicTrack> {
  const at = Date.now()
  const item: MusicTrack = {
    id: nowId('music'), type: 'music-track', title: requiredText(title, '歌曲名称'),
    artist: artist.trim() === '' ? null : artist.trim(), note: note.trim() === '' ? null : note.trim(),
    externalUrl: optionalHttpUrl(externalUrl), createdAt: at, updatedAt: at,
  }
  await db.musicTracks.add(item)
  return item
}

export async function updateMusicTrack(id: string, title: string, artist: string, note: string, externalUrl: string): Promise<void> {
  const changed = await db.musicTracks.update(id, {
    title: requiredText(title, '歌曲名称'), artist: artist.trim() === '' ? null : artist.trim(),
    note: note.trim() === '' ? null : note.trim(), externalUrl: optionalHttpUrl(externalUrl), updatedAt: Date.now(),
  })
  if (changed === 0) throw new Error('这条音乐记录已经不存在')
}

export async function deleteMusicTrack(id: string): Promise<void> {
  await db.musicTracks.delete(id)
}

function requiredDuration(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error('学习时长需为 1–1440 分钟的整数')
  return value
}

export async function listStudyRecords(): Promise<StudyRecord[]> {
  return db.studyRecords.orderBy('studiedOn').reverse().toArray()
}

export async function createStudyRecord(subject: string, note: string, studiedOn: string, durationMinutes: number): Promise<StudyRecord> {
  const at = Date.now()
  const item: StudyRecord = {
    id: nowId('study'), type: 'study-record', subject: requiredText(subject, '学习主题'), note: requiredText(note, '学习记录'),
    studiedOn: requiredDate(studiedOn), durationMinutes: requiredDuration(durationMinutes), createdAt: at, updatedAt: at,
  }
  await db.studyRecords.add(item)
  return item
}

export async function updateStudyRecord(id: string, subject: string, note: string, studiedOn: string, durationMinutes: number): Promise<void> {
  const changed = await db.studyRecords.update(id, {
    subject: requiredText(subject, '学习主题'), note: requiredText(note, '学习记录'), studiedOn: requiredDate(studiedOn),
    durationMinutes: requiredDuration(durationMinutes), updatedAt: Date.now(),
  })
  if (changed === 0) throw new Error('这条学习记录已经不存在')
}

export async function deleteStudyRecord(id: string): Promise<void> {
  await db.studyRecords.delete(id)
}

/* ---------- 主屏 Widget（SPEC §1.4 / §5.2） ---------- */

/** 留言板 Widget 展示的条数：主屏卡片放不下更多，也不该抢走功能入口的注意力 */
export const HOME_WIDGET_BOARD_LIMIT = 3

/**
 * 主屏上一张**已经装配好**的 Widget 卡片。
 *
 * 让仓储层直接给出「要展示的数据」，而不是让页面自己再查一遍：
 * 「引用是否还有效」这个判断必须收在一处 —— 否则每个渲染点都要记得处理
 * 「倒数日已被删除」，漏一处主屏上就会冒出一张空白卡片。
 */
export type HomeWidgetView =
  | { kind: 'board'; id: string; createdAt: number; scope: BoardWidgetScope; notes: Moment[] }
  | { kind: 'countdown'; id: string; createdAt: number; day: CountdownDay }

/** 主屏 Widget 用的「最近 N 条」（由服务端切片，不把整表拉回来）；留言板模块页用全量 `listMoments()` */
async function recentMoments(limit: number): Promise<Moment[]> {
  const data = await fetchJson<{ items: Moment[] }>(`/api/moments?limit=${String(limit)}`)
  return data.items
}

async function scopedBoardMoments(scope: BoardWidgetScope): Promise<Moment[] | null> {
  if (scope.kind === 'recent') return recentMoments(HOME_WIDGET_BOARD_LIMIT)
  if (scope.kind === 'moment') {
    const item = await getMoment(scope.momentId)
    return item === null ? null : [item]
  }
  const groups = await listMomentGroups()
  if (!groups.some((group) => group.id === scope.groupId)) return null
  const data = await fetchJson<{ items: Moment[] }>(`/api/moments?groupId=${encodeURIComponent(scope.groupId)}&limit=${String(HOME_WIDGET_BOARD_LIMIT)}`)
  return data.items
}

/** 按「上主屏的先后」返回（`createdAt` 升序）：先放的在前面，位置不随点选跳动 */
export async function listHomeWidgets(): Promise<HomeWidget[]> {
  return db.homeWidgets.orderBy('createdAt').toArray()
}

/**
 * 装配主屏 Widget。**失效引用在这里被滤掉、不往下传**：
 * - 倒数日 Widget 的 `refId` 为 `null`（脏数据）
 * - `refId` 指向的倒数日已经不存在（删除路径已清，但导入的备份可能带来脏引用，§1.4）
 *
 * 留言板 Widget 的分组 / 单条范围失效时整张卡不渲染；最近范围天然不会失效。
 */
export async function listHomeWidgetViews(): Promise<HomeWidgetView[]> {
  const widgets = await listHomeWidgets()
  const views: HomeWidgetView[] = []
  for (const widget of widgets) {
    if (widget.kind === 'board') {
      const scope = widget.boardScope ?? { kind: 'recent' }
      const notes = await scopedBoardMoments(scope)
      if (notes === null) continue
      views.push({
        kind: 'board',
        id: widget.id,
        createdAt: widget.createdAt,
        scope,
        notes,
      })
      continue
    }
    if (widget.refId === null) continue
    const day = await db.countdowns.get(widget.refId)
    if (day === undefined) continue
    views.push({ kind: 'countdown', id: widget.id, createdAt: widget.createdAt, day })
  }
  return views
}

/**
 * 把某类 Widget 送上主屏（已存在时是**改它引用的对象**）。
 *
 * 唯一性虽由 `&kind` 唯一索引兜底，这里仍先查再写 —— 「已存在」时要走的是改引用，
 * 撞唯一索引抛异常不是可接受的路径。
 *
 * ⚠️ 改 `refId` 时**不动 `createdAt`**：位置语义是「这张卡片在主屏上的位置」，
 *    换一个倒数日来展示不该让它跳到队尾。
 */
export async function putHomeWidget(kind: HomeWidgetKind, refId: string | null, boardScope: BoardWidgetScope | null = kind === 'board' ? { kind: 'recent' } : null): Promise<void> {
  const existing = await db.homeWidgets.where('kind').equals(kind).first()
  if (existing === undefined) {
    const at = Date.now()
    await db.homeWidgets.add({
      id: nowId('widget'),
      type: 'home-widget',
      kind,
      refId,
      boardScope,
      createdAt: at,
      updatedAt: at,
    })
    return
  }
  // 引用没变就一个字都不写：否则每次进页面顺手点一下都会刷新 `updatedAt`
  if (existing.refId === refId && JSON.stringify(existing.boardScope ?? null) === JSON.stringify(boardScope)) return
  await db.homeWidgets.update(existing.id, { refId, boardScope, updatedAt: Date.now() })
}

export async function removeHomeWidget(kind: HomeWidgetKind): Promise<void> {
  const existing = await db.homeWidgets.where('kind').equals(kind).first()
  if (existing !== undefined) await db.homeWidgets.delete(existing.id)
}
