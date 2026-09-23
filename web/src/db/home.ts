import {
  MAX_PHOTO_BYTES,
  type Artwork,
  type ArtworkCategory,
  type Bookmark,
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
import { db } from './db'

function nowId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
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
