/**
 * 本地数据备份 / 恢复（铁律 5：版本化迁移 **+ 备份导出**）。
 *
 * 导出物是一个自描述的 JSON 文件：带上格式标识与版本号，日后改结构时导入方能给出
 * 「这份备份太旧 / 太新」的明确提示，而不是默默导出一堆对不上的数据。
 * 导出**全量本地表**：个人数据量的场景，部分备份的取舍逻辑比全量更危险。
 */
import type {
  Artwork,
  Bookmark,
  ChatMessage,
  ChatSession,
  CountdownDay,
  Diary,
  Moment,
  MusicTrack,
  Photo,
  ReadingNote,
  StudyRecord,
  WishlistItem,
} from '@shared/types'
import { MAX_PHOTO_BYTES } from '@shared/types'
import { db } from '../db/db'

export const BACKUP_FORMAT = 'habitat-backup'
export const BACKUP_VERSION = 5

export interface HabitatBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  sessions: ChatSession[]
  messages: ChatMessage[]
  moments: Moment[]
  wishlist: WishlistItem[]
  countdowns: CountdownDay[]
  diaries: Diary[]
  bookmarks: Bookmark[]
  artworks: Artwork[]
  photos: Photo[]
  readingNotes: ReadingNote[]
  musicTracks: MusicTrack[]
  studyRecords: StudyRecord[]
}

export interface BackupCounts {
  sessions: number
  messages: number
  moments: number
  wishlist: number
  countdowns: number
  diaries: number
  bookmarks: number
  artworks: number
  photos: number
  readingNotes: number
  musicTracks: number
  studyRecords: number
}

export async function exportAll(): Promise<HabitatBackup> {
  const [sessions, messages, moments, wishlist, countdowns, diaries, bookmarks, artworks, photos, readingNotes, musicTracks, studyRecords] = await Promise.all([
    db.sessions.toArray(),
    db.messages.toArray(),
    db.moments.toArray(),
    db.wishlist.toArray(),
    db.countdowns.toArray(),
    db.diaries.toArray(),
    db.bookmarks.toArray(),
    db.artworks.toArray(),
    db.photos.toArray(),
    db.readingNotes.toArray(),
    db.musicTracks.toArray(),
    db.studyRecords.toArray(),
  ])
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    sessions,
    messages,
    moments,
    wishlist,
    countdowns,
    diaries,
    bookmarks,
    artworks,
    photos,
    readingNotes,
    musicTracks,
    studyRecords,
  }
}

/** 触发浏览器下载；调用方决定文件名 */
export function downloadBackup(backup: HabitatBackup): void {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const stamp = new Date(backup.exportedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  anchor.href = url
  anchor.download = `habitat-backup-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}.json`
  anchor.click()
  // Firefox / 大文件场景下同步释放可能在下载真正开始前就把 URL 提前销毁。
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function looksLikeSession(value: unknown): value is ChatSession {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'chat-session'
}

function looksLikeMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'chat-message'
}

function looksLikeMoment(value: unknown): value is Moment {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'moment' && typeof value.content === 'string'
}

function looksLikeWishlistItem(value: unknown): value is WishlistItem {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'wishlist-item' && typeof value.title === 'string'
}

function looksLikeCountdown(value: unknown): value is CountdownDay {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'countdown-day' && typeof value.targetDate === 'string'
}

function looksLikeDiary(value: unknown): value is Diary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'diary' &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    typeof value.entryDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.entryDate)
  )
}

function looksLikeBookmark(value: unknown): value is Bookmark {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.type !== 'bookmark' ||
    typeof value.targetType !== 'string' ||
    typeof value.targetId !== 'string' ||
    typeof value.title !== 'string' ||
    (value.note !== null && typeof value.note !== 'string')
  ) return false
  const targetTypes = ['external-link', 'chat-message', 'diary', 'moment', 'artwork', 'photo', 'reading-note', 'music-track', 'study-record']
  if (!targetTypes.includes(value.targetType)) return false
  if (value.targetType !== 'external-link') return true
  try {
    const url = new URL(value.targetId)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const ARTWORK_CATEGORIES = ['writing', 'visual', 'audio', 'other'] as const
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
const MAX_PHOTO_BASE64_LENGTH = Math.ceil(MAX_PHOTO_BYTES / 3) * 4

function looksLikeArtwork(value: unknown): value is Artwork {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.type !== 'artwork' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    !ARTWORK_CATEGORIES.includes(value.category as typeof ARTWORK_CATEGORIES[number]) ||
    (value.externalUrl !== null && typeof value.externalUrl !== 'string')
  ) return false
  if (value.externalUrl === null) return true
  try {
    const url = new URL(value.externalUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function looksLikePhoto(value: unknown): value is Photo {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.type !== 'photo' ||
    typeof value.title !== 'string' ||
    (value.caption !== null && typeof value.caption !== 'string') ||
    !PHOTO_MIMES.includes(value.mimeType as typeof PHOTO_MIMES[number]) ||
    !Number.isInteger(value.sizeBytes) ||
    (value.sizeBytes as number) <= 0 ||
    (value.sizeBytes as number) > MAX_PHOTO_BYTES ||
    typeof value.takenAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.takenAt) ||
    typeof value.imageDataUrl !== 'string'
  ) return false
  const prefix = `data:${String(value.mimeType)};base64,`
  if (!value.imageDataUrl.startsWith(prefix)) return false
  const payload = value.imageDataUrl.slice(prefix.length)
  if (payload.length === 0 || payload.length > MAX_PHOTO_BASE64_LENGTH || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return false
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor(payload.length * 3 / 4) - padding === value.sizeBytes
}

function looksLikeReadingNote(value: unknown): value is ReadingNote {
  return (
    isRecord(value) && typeof value.id === 'string' && value.type === 'reading-note' &&
    typeof value.bookTitle === 'string' && (value.author === null || typeof value.author === 'string') &&
    ['want', 'reading', 'finished'].includes(String(value.status)) && typeof value.note === 'string'
  )
}

function looksLikeMusicTrack(value: unknown): value is MusicTrack {
  if (
    !isRecord(value) || typeof value.id !== 'string' || value.type !== 'music-track' || typeof value.title !== 'string' ||
    (value.artist !== null && typeof value.artist !== 'string') || (value.note !== null && typeof value.note !== 'string') ||
    (value.externalUrl !== null && typeof value.externalUrl !== 'string')
  ) return false
  if (value.externalUrl === null) return true
  try {
    const url = new URL(value.externalUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch { return false }
}

function looksLikeStudyRecord(value: unknown): value is StudyRecord {
  return (
    isRecord(value) && typeof value.id === 'string' && value.type === 'study-record' &&
    typeof value.subject === 'string' && typeof value.note === 'string' && typeof value.studiedOn === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.studiedOn) && Number.isInteger(value.durationMinutes) &&
    (value.durationMinutes as number) >= 1 && (value.durationMinutes as number) <= 1440
  )
}

/**
 * 恢复备份：**整体替换**现有数据（导入语义是「回到备份那一刻」，不是合并）。
 * 先完整校验再动库 —— 校验不过一行都不写，避免半导入状态。
 */
export async function importAll(raw: unknown): Promise<BackupCounts> {
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new Error('不是栖息地备份文件（缺少 format 标识）')
  }
  if (![1, 2, 3, 4, BACKUP_VERSION].includes(raw.version as number)) {
    throw new Error(`备份版本不匹配：文件是 v${String(raw.version)}，当前支持 v1–v${BACKUP_VERSION}`)
  }
  if (!Array.isArray(raw.sessions) || !Array.isArray(raw.messages)) {
    throw new Error('备份内容损坏：sessions / messages 必须是数组')
  }
  const sessions = raw.sessions.filter(looksLikeSession)
  const messages = raw.messages.filter(looksLikeMessage)
  if (sessions.length !== raw.sessions.length || messages.length !== raw.messages.length) {
    throw new Error('备份内容损坏：存在无法识别的记录')
  }

  // v1 只有聊天数据；导入旧备份时 Home 表按空数组处理，不把用户旧备份直接判死。
  const momentsRaw = raw.version === 1 ? [] : raw.moments
  const wishlistRaw = raw.version === 1 ? [] : raw.wishlist
  const countdownsRaw = raw.version === 1 ? [] : raw.countdowns
  if (!Array.isArray(momentsRaw) || !Array.isArray(wishlistRaw) || !Array.isArray(countdownsRaw)) {
    throw new Error('备份内容损坏：Home 数据必须是数组')
  }
  const moments = momentsRaw.filter(looksLikeMoment)
  const wishlist = wishlistRaw.filter(looksLikeWishlistItem)
  const countdowns = countdownsRaw.filter(looksLikeCountdown)
  if (moments.length !== momentsRaw.length || wishlist.length !== wishlistRaw.length || countdowns.length !== countdownsRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的 Home 记录')
  }

  // v3 新增日记与收藏；v1/v2 导入时这两张表为空，继续遵守“整体替换”语义。
  const diariesRaw = raw.version === 3 || raw.version === 4 || raw.version === 5 ? raw.diaries : []
  const bookmarksRaw = raw.version === 3 || raw.version === 4 || raw.version === 5 ? raw.bookmarks : []
  if (!Array.isArray(diariesRaw) || !Array.isArray(bookmarksRaw)) {
    throw new Error('备份内容损坏：diaries / bookmarks 必须是数组')
  }
  const diaries = diariesRaw.filter(looksLikeDiary)
  const bookmarks = bookmarksRaw.filter(looksLikeBookmark)
  if (diaries.length !== diariesRaw.length || bookmarks.length !== bookmarksRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的日记或收藏')
  }

  // v4 新增作品与相册；旧版导入时清空新表，保持整体替换的确定性。
  const artworksRaw = raw.version === 4 || raw.version === 5 ? raw.artworks : []
  const photosRaw = raw.version === 4 || raw.version === 5 ? raw.photos : []
  if (!Array.isArray(artworksRaw) || !Array.isArray(photosRaw)) {
    throw new Error('备份内容损坏：artworks / photos 必须是数组')
  }
  const artworks = artworksRaw.filter(looksLikeArtwork)
  const photos = photosRaw.filter(looksLikePhoto)
  if (artworks.length !== artworksRaw.length || photos.length !== photosRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的作品或照片')
  }

  // v5 新增读书、音乐与学习；旧版导入时清空新表。
  const readingNotesRaw = raw.version === 5 ? raw.readingNotes : []
  const musicTracksRaw = raw.version === 5 ? raw.musicTracks : []
  const studyRecordsRaw = raw.version === 5 ? raw.studyRecords : []
  if (!Array.isArray(readingNotesRaw) || !Array.isArray(musicTracksRaw) || !Array.isArray(studyRecordsRaw)) {
    throw new Error('备份内容损坏：readingNotes / musicTracks / studyRecords 必须是数组')
  }
  const readingNotes = readingNotesRaw.filter(looksLikeReadingNote)
  const musicTracks = musicTracksRaw.filter(looksLikeMusicTrack)
  const studyRecords = studyRecordsRaw.filter(looksLikeStudyRecord)
  if (readingNotes.length !== readingNotesRaw.length || musicTracks.length !== musicTracksRaw.length || studyRecords.length !== studyRecordsRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的读书、音乐或学习记录')
  }

  await db.transaction('rw', [db.sessions, db.messages, db.moments, db.wishlist, db.countdowns, db.diaries, db.bookmarks, db.artworks, db.photos, db.readingNotes, db.musicTracks, db.studyRecords], async () => {
    await db.sessions.clear()
    await db.messages.clear()
    await db.moments.clear()
    await db.wishlist.clear()
    await db.countdowns.clear()
    await db.diaries.clear()
    await db.bookmarks.clear()
    await db.artworks.clear()
    await db.photos.clear()
    await db.readingNotes.clear()
    await db.musicTracks.clear()
    await db.studyRecords.clear()
    await db.sessions.bulkAdd(sessions)
    await db.messages.bulkAdd(messages)
    await db.moments.bulkAdd(moments)
    await db.wishlist.bulkAdd(wishlist)
    await db.countdowns.bulkAdd(countdowns)
    await db.diaries.bulkAdd(diaries)
    await db.bookmarks.bulkAdd(bookmarks)
    await db.artworks.bulkAdd(artworks)
    await db.photos.bulkAdd(photos)
    await db.readingNotes.bulkAdd(readingNotes)
    await db.musicTracks.bulkAdd(musicTracks)
    await db.studyRecords.bulkAdd(studyRecords)
  })
  return {
    sessions: sessions.length,
    messages: messages.length,
    moments: moments.length,
    wishlist: wishlist.length,
    countdowns: countdowns.length,
    diaries: diaries.length,
    bookmarks: bookmarks.length,
    artworks: artworks.length,
    photos: photos.length,
    readingNotes: readingNotes.length,
    musicTracks: musicTracks.length,
    studyRecords: studyRecords.length,
  }
}
