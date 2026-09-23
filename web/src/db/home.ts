import {
  MAX_PHOTO_BYTES,
  type Artwork,
  type ArtworkCategory,
  type Bookmark,
  type ChatMessage,
  type CountdownDay,
  type Diary,
  type Moment,
  type Photo,
  type PhotoMime,
  type ReadingNote,
  type ReadingStatus,
  type MusicTrack,
  type StudyRecord,
  type WishlistItem,
} from '@shared/types'
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

export async function listMoments(): Promise<Moment[]> {
  return db.moments.orderBy('createdAt').reverse().toArray()
}

export async function createMoment(content: string): Promise<Moment> {
  const at = Date.now()
  const item: Moment = {
    id: nowId('moment'),
    type: 'moment',
    content: requiredText(content, '留言'),
    author: 'user',
    createdAt: at,
    updatedAt: at,
  }
  await db.moments.add(item)
  return item
}

export async function deleteMoment(id: string): Promise<void> {
  await db.moments.delete(id)
}

export async function listWishlist(): Promise<WishlistItem[]> {
  const items = await db.wishlist.orderBy('updatedAt').reverse().toArray()
  return items.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
}

export async function createWishlistItem(title: string): Promise<WishlistItem> {
  const at = Date.now()
  const item: WishlistItem = {
    id: nowId('wish'),
    type: 'wishlist-item',
    title: requiredText(title, '愿望'),
    status: 'open',
    completedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  await db.wishlist.add(item)
  return item
}

export async function toggleWishlistItem(id: string): Promise<void> {
  const item = await db.wishlist.get(id)
  if (item === undefined) return
  const done = item.status === 'open'
  const at = Date.now()
  await db.wishlist.update(id, {
    status: done ? 'done' : 'open',
    completedAt: done ? at : null,
    updatedAt: at,
  })
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await db.wishlist.delete(id)
}

export async function listCountdowns(): Promise<CountdownDay[]> {
  return db.countdowns.orderBy('targetDate').toArray()
}

export async function createCountdown(title: string, targetDate: string): Promise<CountdownDay> {
  const normalizedDate = targetDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) throw new Error('请选择有效日期')
  const at = Date.now()
  const item: CountdownDay = {
    id: nowId('countdown'),
    type: 'countdown-day',
    title: requiredText(title, '倒数日名称'),
    targetDate: normalizedDate,
    createdAt: at,
    updatedAt: at,
  }
  await db.countdowns.add(item)
  return item
}

export async function deleteCountdown(id: string): Promise<void> {
  await db.countdowns.delete(id)
}

function requiredDate(value: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('请选择有效日期')
  return normalized
}

export async function listDiaries(): Promise<Diary[]> {
  return db.diaries.orderBy('entryDate').reverse().toArray()
}

export async function createDiary(title: string, content: string, entryDate: string): Promise<Diary> {
  const at = Date.now()
  const item: Diary = {
    id: nowId('diary'),
    type: 'diary',
    title: requiredText(title, '日记标题'),
    content: requiredText(content, '日记正文'),
    entryDate: requiredDate(entryDate),
    createdAt: at,
    updatedAt: at,
  }
  await db.diaries.add(item)
  return item
}

export async function updateDiary(id: string, title: string, content: string, entryDate: string): Promise<void> {
  const changed = await db.diaries.update(id, {
    title: requiredText(title, '日记标题'),
    content: requiredText(content, '日记正文'),
    entryDate: requiredDate(entryDate),
    updatedAt: Date.now(),
  })
  if (changed === 0) throw new Error('这篇日记已经不存在')
}

export async function deleteDiary(id: string): Promise<void> {
  await db.diaries.delete(id)
}

export async function listBookmarks(): Promise<Bookmark[]> {
  return db.bookmarks.orderBy('createdAt').reverse().toArray()
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

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id)
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
  if (message.blocks.some((block) => block.kind === 'image' || block.kind === 'html' || block.kind === 'widget' || block.kind === 'tab-group')) return 'visual'
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
    throw new Error('无法读取聊天图片，可能是图片来源禁止跨域访问')
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

/**
 * 把消息里的所有顶层图片一次加入相册。先把图片全部读完再开事务，避免第二张失败时只留下第一张。
 * 以「消息 id + block.order」生成稳定主键，所以重复点击不会产生副本。
 */
export async function createMessagePhotos(message: ChatMessage): Promise<MessagePhotoCaptureResult> {
  const images = message.blocks.filter((block) => block.kind === 'image')
  if (images.length === 0) throw new Error('这条消息里没有可加入相册的图片')
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
      sourceId: message.id,
      sessionId: message.sessionId,
      metadata: chatSourceMetadata(message, { sourceBlockKind: 'image', sourceBlockOrder: block.order }),
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
  if (added.length === 0) throw new Error(images.length === 1 ? '这张图片已经加入相册了' : '这条消息里的图片已经全部加入相册了')
  return { added, skipped }
}

export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id)
}

const READING_STATUSES: readonly ReadingStatus[] = ['want', 'reading', 'finished']

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
