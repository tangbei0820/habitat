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
  BookmarkCategory,
  ChatMessage,
  ChatSession,
  CountdownCategory,
  CountdownDay,
  CountdownReminder,
  CountdownRepeat,
  HomeWidget,
  BoardWidgetScope,
  ListenSession,
  MusicTrack,
  Photo,
  PhotoCollection,
  ReadingNote,
  StudyCard,
  StudyRecord,
  StudyTask,
  Sticker,
  SessionGroup,
  ContentAuthor,
  WishlistProgressSourceType,
  WishlistItem,
  WishlistProgress,
} from '@shared/types'
import { MAX_PHOTO_BYTES } from '@shared/types'
import { db, type LegacyUpload } from '../db/db'

export const BACKUP_FORMAT = 'habitat-backup'

/**
 * v9 起备份**不再包含日记与留言板** —— 它们已经搬到服务端（Phase 6.5）。
 *
 * 为什么不是「从服务端拉一份塞进备份」：这份备份的语义一直是「本地那张库的快照」，
 * 而它必须在**离线时也能导出**（T-030 定的性质）。硬把服务端数据混进来，
 * 会让一份本该离线可用的文件变成「一半离线一半在线」——那种东西在最需要它的时候最不可靠。
 * 服务端数据（sqlite 文件）的备份是部署层的事。
 *
 * ⚠️ 但**旧备份（v2–v8）里带着它们**，导入时不能丢：走 `legacyUploads` 转存到服务端，
 * 详见 `importAll` 与 `db/legacy-upload.ts`。
 */
export const BACKUP_VERSION = 16

export interface HabitatBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  sessions: ChatSession[]
  sessionGroups: SessionGroup[]
  messages: ChatMessage[]
  wishlist: WishlistItem[]
  countdowns: CountdownDay[]
  bookmarks: Bookmark[]
  bookmarkCategories: BookmarkCategory[]
  artworks: Artwork[]
  photos: Photo[]
  photoCollections: PhotoCollection[]
  readingNotes: ReadingNote[]
  musicTracks: MusicTrack[]
  studyRecords: StudyRecord[]
  studyCards: StudyCard[]
  homeWidgets: HomeWidget[]
  listenSessions: ListenSession[]
  studyTasks: StudyTask[]
  stickers: Sticker[]
}

export interface BackupCounts {
  sessions: number
  sessionGroups: number
  messages: number
  wishlist: number
  countdowns: number
  bookmarks: number
  bookmarkCategories: number
  artworks: number
  photos: number
  photoCollections: number
  readingNotes: number
  musicTracks: number
  studyRecords: number
  studyCards: number
  homeWidgets: number
  listenSessions: number
  studyTasks: number
  stickers: number
  /** 从**旧备份**（v2–v8）里救出来、转存进中转表等服务端接收的条数。新备份（v9）恒为 0。 */
  legacyDiaries: number
  legacyMoments: number
}

export async function exportAll(): Promise<HabitatBackup> {
  const [sessions, sessionGroups, messages, wishlist, countdowns, bookmarks, bookmarkCategories, artworks, photos, photoCollections, readingNotes, musicTracks, studyRecords, studyCards, homeWidgets, listenSessions, studyTasks, stickers] = await Promise.all([
    db.sessions.toArray(),
    db.sessionGroups.toArray(),
    db.messages.toArray(),
    db.wishlist.toArray(),
    db.countdowns.toArray(),
    db.bookmarks.toArray(),
    db.bookmarkCategories.toArray(),
    db.artworks.toArray(),
    db.photos.toArray(),
    db.photoCollections.toArray(),
    db.readingNotes.toArray(),
    db.musicTracks.toArray(),
    db.studyRecords.toArray(),
    db.studyCards.toArray(),
    db.homeWidgets.toArray(),
    db.listenSessions.toArray(),
    db.studyTasks.toArray(),
    db.stickers.toArray(),
  ])
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    sessions,
    sessionGroups,
    messages,
    wishlist,
    countdowns,
    bookmarks,
    bookmarkCategories,
    artworks,
    photos,
    photoCollections,
    readingNotes,
    musicTracks,
    studyRecords,
    studyCards,
    homeWidgets,
    listenSessions,
    studyTasks,
    stickers,
  }
}

/**
 * 上次成功导出的时间戳（localStorage）。
 *
 * 用来兑现技术方案 §9 风险7 的对策「float-phone 丢数据前科」——
 * 光有导出按钮不够，得有人提醒你该导了。刻意只记在这台浏览器上：
 * 导出是否发生过是**设备级**的事实，跟账号无关，也不该混进备份本体。
 */
const LAST_EXPORT_KEY = 'habitat:last-export-at'

export function readLastExportAt(): number | null {
  const raw = window.localStorage.getItem(LAST_EXPORT_KEY)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 在 `downloadBackup` 里调用 —— 备份文件真的落到用户机器上才算数 */
function markExported(at: number): void {
  window.localStorage.setItem(LAST_EXPORT_KEY, String(at))
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
  markExported(backup.exportedAt)
  // Firefox / 大文件场景下同步释放可能在下载真正开始前就把 URL 提前销毁。
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function looksLikeSession(value: unknown): value is ChatSession {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'chat-session'
}

/**
 * 只认「标识 + 名称」，不要求 `collapsed` —— 缺字段时它在界面上等同于「展开」，
 * 而按备份内容原样写入才是导入语义（回到备份那一刻）。
 */
function looksLikeSessionGroup(value: unknown): value is SessionGroup {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'session-group' &&
    typeof value.name === 'string'
  )
}

/**
 * Widget 只校验「标识 + 形态」：`refId` 指向谁不在这里管 ——
 * 导入语义是「回到备份那一刻」，备份里指向一个已被删掉的倒数日就该原样写回去，
 * 由 `listHomeWidgetViews` 按引用有效性决定不渲染（SPEC §1.4），而不是在这里悄悄丢掉。
 */
function looksLikeHomeWidget(value: unknown): value is HomeWidget {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'home-widget' &&
    (value.kind === 'board' || value.kind === 'countdown')
  )
}

/**
 * 分类与相册（SPEC §3.5.4 / §3.7.3）只校验「标识 + 名称」：条目上的归属引用不在这里管 ——
 * 同 `looksLikeHomeWidget` 的理由，导入语义是「回到备份那一刻」，
 * 指向已不存在分类的脏引用由筛选条的「未分类」兜底区消化。
 */
function looksLikeBookmarkCategory(value: unknown): value is BookmarkCategory {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'bookmark-category' &&
    typeof value.name === 'string'
  )
}

function looksLikePhotoCollection(value: unknown): value is PhotoCollection {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.type === 'photo-collection' &&
    typeof value.name === 'string'
  )
}

function looksLikeMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'chat-message'
}

/**
 * 旧备份里的留言 / 日记校验。
 *
 * 它们**不再进 Dexie** —— 而是转存到服务端（见 `importAll`），所以这里只需要
 * 「认得出这是一条留言 / 日记、并且拿得住 id」。
 *
 * 刻意不做 `value is Moment` 那种精确校验：v9 之前的数据形状本来就不一样
 * （日记那时还没有 `author` / `visibility`，因为那时日记只属于用户），
 * 硬套现在的类型等于要求旧备份先改造自己 —— 那只会在导入时把用户的老数据判成损坏，
 * 而它其实完全能用。
 */
function looksLikeLegacyMoment(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'moment' && typeof value.content === 'string'
}

const WISHLIST_STATUSES = ['open', 'done', 'paused', 'abandoned'] as const
const WISHLIST_AUTHORS: ContentAuthor[] = ['user', 'companion']
const WISHLIST_SOURCES: WishlistProgressSourceType[] = ['chat-message', 'artwork', 'music-track', 'reading-note', 'countdown-day']

function looksLikeWishlistItem(value: unknown): value is WishlistItem {
  if (!isRecord(value) || typeof value.id !== 'string' || value.type !== 'wishlist-item' || typeof value.title !== 'string') return false
  if (value.status !== undefined && !WISHLIST_STATUSES.includes(value.status as typeof WISHLIST_STATUSES[number])) return false
  if (value.author !== undefined && !WISHLIST_AUTHORS.includes(value.author as ContentAuthor)) return false
  if (value.targetDate !== undefined && value.targetDate !== null && (typeof value.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.targetDate))) return false
  if (value.progress !== undefined && (!Array.isArray(value.progress) || value.progress.some((row) => {
    if (!isRecord(row) || typeof row.id !== 'string' || row.type !== 'wishlist-progress' || typeof row.note !== 'string') return true
    if (row.author !== undefined && !WISHLIST_AUTHORS.includes(row.author as ContentAuthor)) return true
    if (row.sourceType !== undefined && row.sourceType !== null && !WISHLIST_SOURCES.includes(row.sourceType as WishlistProgressSourceType)) return true
    return false
  }))) return false
  return true
}

function normalizeBoardWidgetScope(value: unknown, version: number, kind: HomeWidget['kind']): BoardWidgetScope | null {
  if (kind === 'countdown') return null
  // v15 及更早的备份没有范围字段；兼容为「最近 3 条」。
  if (version < 16 || value === undefined) return { kind: 'recent' }
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('备份内容损坏：留言 Widget 范围无效')
  if (value.kind === 'recent') return { kind: 'recent' }
  if (value.kind === 'group' && typeof value.groupId === 'string' && value.groupId !== '') return { kind: 'group', groupId: value.groupId }
  if (value.kind === 'moment' && typeof value.momentId === 'string' && value.momentId !== '') return { kind: 'moment', momentId: value.momentId }
  throw new Error('备份内容损坏：留言 Widget 范围无效')
}

const COUNTDOWN_CATEGORIES: CountdownCategory[] = ['anniversary', 'event', 'deadline', 'other']
const COUNTDOWN_REPEATS: CountdownRepeat[] = ['none', 'yearly']
const COUNTDOWN_REMINDERS: CountdownReminder[] = ['none', 'on-day', 'one-day-before']

function looksLikeCountdown(value: unknown): value is CountdownDay {
  if (!isRecord(value) || typeof value.id !== 'string' || value.type !== 'countdown-day' || typeof value.targetDate !== 'string') return false
  return (value.category === undefined || COUNTDOWN_CATEGORIES.includes(value.category as CountdownCategory))
    && (value.repeat === undefined || COUNTDOWN_REPEATS.includes(value.repeat as CountdownRepeat))
    && (value.reminder === undefined || COUNTDOWN_REMINDERS.includes(value.reminder as CountdownReminder))
}

function looksLikeLegacyDiary(value: unknown): value is { id: string } {
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
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 12 || value.tags.some((tag) => typeof tag !== 'string' || tag.trim() === '' || tag.trim().length > 20))) return false
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

function looksLikeSticker(value: unknown): value is Sticker {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.type !== 'sticker' ||
    typeof value.name !== 'string' ||
    !PHOTO_MIMES.includes(value.mimeType as typeof PHOTO_MIMES[number]) ||
    !Number.isInteger(value.sizeBytes) ||
    (value.sizeBytes as number) <= 0 ||
    (value.sizeBytes as number) > MAX_PHOTO_BYTES ||
    (value.category !== null && typeof value.category !== 'string') ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === 'string') ||
    (value.source !== 'user' && value.source !== 'mcp') ||
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

function looksLikeStudyCard(value: unknown): value is StudyCard {
  return (
    isRecord(value) && typeof value.id === 'string' && value.type === 'study-card' &&
    typeof value.subject === 'string' && typeof value.front === 'string' && typeof value.back === 'string' &&
    (value.example === null || typeof value.example === 'string') &&
    (value.hint === null || typeof value.hint === 'string') &&
    (value.source === 'ai' || value.source === 'user') &&
    typeof value.dueOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dueOn) &&
    Number.isInteger(value.intervalDays) && (value.intervalDays as number) >= 1 &&
    Number.isFinite(value.ease) && (value.ease as number) >= 1.3 &&
    Number.isInteger(value.repetitions) && (value.repetitions as number) >= 0 &&
    (value.lastReviewedAt === null || Number.isFinite(value.lastReviewedAt)) &&
    Number.isFinite(value.createdAt) && Number.isFinite(value.updatedAt)
  )
}

/**
 * v10 新增：一起听 / 听雨的时长行（id = `kind:dayKey`，一天一行累加秒数）。
 * seconds 为 0 的行不该存在（写入方 0 秒不落库），但备份语义是「回到那一刻」，见到也照收。
 */
function looksLikeListenSession(value: unknown): value is ListenSession {
  return (
    isRecord(value) && typeof value.id === 'string' &&
    (value.kind === 'music' || value.kind === 'rain') &&
    typeof value.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dayKey) &&
    Number.isInteger(value.seconds) && (value.seconds as number) >= 0 &&
    Number.isFinite(value.updatedAt) && Number.isFinite(value.createdAt)
  )
}

/** v10 新增：今天的三件小事（按天归组，隔天自动是新的一页） */
function looksLikeStudyTask(value: unknown): value is StudyTask {
  return (
    isRecord(value) && typeof value.id === 'string' &&
    typeof value.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dayKey) &&
    typeof value.label === 'string' && value.label.length > 0 &&
    typeof value.done === 'boolean' && Number.isFinite(value.createdAt)
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
  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) {
    throw new Error(`备份版本不匹配：文件是 v${String(version)}，当前支持 v1–v${BACKUP_VERSION}`)
  }
  if (!Array.isArray(raw.sessions) || !Array.isArray(raw.messages)) {
    throw new Error('备份内容损坏：sessions / messages 必须是数组')
  }
  // 老备份里的会话没有 groupId 字段；补成 null 让它落进未分组区，而不是在列表里变成「哪都不属于」
  const sessions = raw.sessions
    .filter(looksLikeSession)
    .map((session) => ({ ...session, groupId: session.groupId ?? null }))
  const messages = raw.messages.filter(looksLikeMessage)
  if (sessions.length !== raw.sessions.length || messages.length !== raw.messages.length) {
    throw new Error('备份内容损坏：存在无法识别的记录')
  }

  // v1 只有聊天数据；导入旧备份时 Home 表按空数组处理，不把用户旧备份直接判死。
  // ⚠️ v9 起备份里**没有** moments / diaries 了（它们归服务端），所以高版本按空处理 ——
  //    不这么写的话，导入自家新版备份会报「moments 必须是数组」。
  const momentsRaw = version >= 2 && version < 9 ? raw.moments : []
  const wishlistRaw = version >= 2 ? raw.wishlist : []
  const countdownsRaw = version >= 2 ? raw.countdowns : []
  if (!Array.isArray(momentsRaw) || !Array.isArray(wishlistRaw) || !Array.isArray(countdownsRaw)) {
    throw new Error('备份内容损坏：Home 数据必须是数组')
  }
  // 旧留言不落 Dexie，转存到服务端（见下面的 legacyUploads）
  const legacyMoments = momentsRaw.filter(looksLikeLegacyMoment)
  const wishlist = wishlistRaw.filter(looksLikeWishlistItem).map((item) => {
    const at = Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
    const progress: WishlistProgress[] = Array.isArray(item.progress) ? item.progress.map((row) => ({
      ...row,
      author: row.author ?? 'user',
      sourceType: row.sourceType ?? null,
      ...(row.sourceId === undefined || row.sourceId === null ? {} : { sourceId: row.sourceId }),
    })) : []
    return {
      ...item,
      status: item.status ?? 'open',
      completedAt: item.status === 'done' ? (item.completedAt ?? at) : (item.completedAt ?? null),
      author: item.author ?? 'user',
      targetDate: item.targetDate ?? null,
      statusChangedAt: item.statusChangedAt ?? at,
      statusReason: item.statusReason ?? null,
      progress,
    }
  })
  const countdowns = countdownsRaw.filter(looksLikeCountdown).map((countdown) => ({
    ...countdown,
    category: countdown.category ?? 'other',
    repeat: countdown.repeat ?? 'none',
    reminder: countdown.reminder ?? 'none',
  }))
  if (legacyMoments.length !== momentsRaw.length || wishlist.length !== wishlistRaw.length || countdowns.length !== countdownsRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的 Home 记录')
  }

  // v3 新增日记与收藏；v1/v2 导入时这两张表为空。v9 起日记也不在备份里了（同 moments），高版本按空处理。
  const diariesRaw = version >= 3 && version < 9 ? raw.diaries : []
  const bookmarksRaw = version >= 3 ? raw.bookmarks : []
  if (!Array.isArray(diariesRaw) || !Array.isArray(bookmarksRaw)) {
    throw new Error('备份内容损坏：diaries / bookmarks 必须是数组')
  }
  const legacyDiaries = diariesRaw.filter(looksLikeLegacyDiary)
  // v10 之前没有分类字段；补成 null 让它落进「未分类」——
  // 留成 undefined 会让筛选条漏掉这批旧数据（它们哪个筛选里都不出现）
  const bookmarks = bookmarksRaw
    .filter(looksLikeBookmark)
    .map((bookmark) => ({
      ...bookmark,
      categoryId: typeof bookmark.categoryId === 'string' ? bookmark.categoryId : null,
      tags: Array.isArray(bookmark.tags) ? [...new Set(bookmark.tags.map((tag) => tag.trim()))] : [],
    }))
  if (legacyDiaries.length !== diariesRaw.length || bookmarks.length !== bookmarksRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的日记或收藏')
  }

  // v4 新增作品与相册；旧版导入时清空新表，保持整体替换的确定性。
  const artworksRaw = version >= 4 ? raw.artworks : []
  const photosRaw = version >= 4 ? raw.photos : []
  if (!Array.isArray(artworksRaw) || !Array.isArray(photosRaw)) {
    throw new Error('备份内容损坏：artworks / photos 必须是数组')
  }
  const artworks = artworksRaw.filter(looksLikeArtwork)
  const photos = photosRaw
    .filter(looksLikePhoto)
    .map((photo) => ({
      ...photo,
      collectionId: typeof photo.collectionId === 'string' ? photo.collectionId : null,
    }))
  if (artworks.length !== artworksRaw.length || photos.length !== photosRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的作品或照片')
  }

  // v5 新增读书、音乐与学习；旧版导入时清空新表。
  const readingNotesRaw = version >= 5 ? raw.readingNotes : []
  const musicTracksRaw = version >= 5 ? raw.musicTracks : []
  const studyRecordsRaw = version >= 5 ? raw.studyRecords : []
  if (!Array.isArray(readingNotesRaw) || !Array.isArray(musicTracksRaw) || !Array.isArray(studyRecordsRaw)) {
    throw new Error('备份内容损坏：readingNotes / musicTracks / studyRecords 必须是数组')
  }
  const readingNotes = readingNotesRaw.filter(looksLikeReadingNote)
  const musicTracks = musicTracksRaw.filter(looksLikeMusicTrack)
  const studyRecords = studyRecordsRaw.filter(looksLikeStudyRecord)
  if (readingNotes.length !== readingNotesRaw.length || musicTracks.length !== musicTracksRaw.length || studyRecords.length !== studyRecordsRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的读书、音乐或学习记录')
  }

  // v6 新增会话分组；旧版导入时分组按空处理，会话的 groupId 已在上面归成 null，一起落进未分组区。
  // ⚠️ 刻意**不**在这里清洗「指向不存在分组」的 groupId：导入语义是「回到备份那一刻」，
  //    备份里是什么就写什么；脏引用由列表页的未分组兜底区消化（SPEC §2.1.3）。
  const sessionGroupsRaw = version >= 6 ? raw.sessionGroups : []
  if (!Array.isArray(sessionGroupsRaw)) {
    throw new Error('备份内容损坏：sessionGroups 必须是数组')
  }
  const sessionGroups = sessionGroupsRaw.filter(looksLikeSessionGroup)
  if (sessionGroups.length !== sessionGroupsRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的分组')
  }

  // v7 新增主屏 Widget；旧版导入时按空处理，主屏回到「一张 Widget 都没有」。
  // ⚠️ `&kind` 是唯一索引：这里**必须先按 kind 去重**，否则手改过的备份（例如两个 board）
  //    会让 bulkAdd 抛 ConstraintError，导致整份备份一个字都导不进去。
  //    保留 `createdAt` 最早的那条 —— 与「先上主屏的在前」的排序语义一致。
  const homeWidgetsRaw = version >= 7 ? raw.homeWidgets : []
  if (!Array.isArray(homeWidgetsRaw)) {
    throw new Error('备份内容损坏：homeWidgets 必须是数组')
  }
  const homeWidgetsAll = homeWidgetsRaw.filter(looksLikeHomeWidget)
  if (homeWidgetsAll.length !== homeWidgetsRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的主屏 Widget')
  }
  const homeWidgetsByKind = new Map<string, HomeWidget>()
  for (const widget of [...homeWidgetsAll].sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
    if (!homeWidgetsByKind.has(widget.kind)) {
      // `refId` 归一化：非字符串一律当 null，免得一个手改出来的数字一路流到 `db.countdowns.get()`
      homeWidgetsByKind.set(widget.kind, {
        ...widget,
        refId: typeof widget.refId === 'string' ? widget.refId : null,
        boardScope: normalizeBoardWidgetScope((widget as HomeWidget & { boardScope?: unknown }).boardScope, version, widget.kind),
      })
    }
  }
  const homeWidgets = [...homeWidgetsByKind.values()]

  // v8 新增收藏分类与相册；旧版导入时按空处理，条目全落进「未分类」。
  const bookmarkCategoriesRaw = version >= 8 ? raw.bookmarkCategories : []
  const photoCollectionsRaw = version >= 8 ? raw.photoCollections : []
  if (!Array.isArray(bookmarkCategoriesRaw) || !Array.isArray(photoCollectionsRaw)) {
    throw new Error('备份内容损坏：bookmarkCategories / photoCollections 必须是数组')
  }
  const bookmarkCategories = bookmarkCategoriesRaw.filter(looksLikeBookmarkCategory)
  const photoCollections = photoCollectionsRaw.filter(looksLikePhotoCollection)
  if (
    bookmarkCategories.length !== bookmarkCategoriesRaw.length ||
    photoCollections.length !== photoCollectionsRaw.length
  ) {
    throw new Error('备份内容损坏：存在无法识别的分类或相册')
  }

  // v10 新增一起听时长与学习任务；旧版导入时按空处理 —— 那时这两个功能还不存在。
  const listenSessionsRaw = version >= 10 ? raw.listenSessions : []
  const studyTasksRaw = version >= 10 ? raw.studyTasks : []
  const studyCardsRaw = version >= 11 ? raw.studyCards : []
  const stickersRaw = version >= 12 ? raw.stickers : []
  if (!Array.isArray(listenSessionsRaw) || !Array.isArray(studyTasksRaw) || !Array.isArray(studyCardsRaw) || !Array.isArray(stickersRaw)) {
    throw new Error('备份内容损坏：listenSessions / studyTasks / studyCards / stickers 必须是数组')
  }
  const listenSessions = listenSessionsRaw.filter(looksLikeListenSession)
  const studyTasks = studyTasksRaw.filter(looksLikeStudyTask)
  const studyCards = studyCardsRaw.filter(looksLikeStudyCard)
  const stickers = stickersRaw.filter(looksLikeSticker)
  if (listenSessions.length !== listenSessionsRaw.length || studyTasks.length !== studyTasksRaw.length || studyCards.length !== studyCardsRaw.length || stickers.length !== stickersRaw.length) {
    throw new Error('备份内容损坏：存在无法识别的听音时长、学习任务、学习卡片或表情包')
  }

  // 旧备份里的日记 / 留言转存进中转表：它们已经不属本地库了，但也不能就这么丢掉。
  // 用 `bulkPut`（而非 bulkAdd）：这张表是**待上传队列**，可能还有上一次没传完的残留，
  // 而「整体替换」语义只针对本地库，不该顺手把队列清空。
  const legacyRows: LegacyUpload[] = [
    ...legacyDiaries.map((row) => ({
      id: `diary:${row.id}`,
      kind: 'diary' as const,
      payload: JSON.stringify(row),
      createdAt: Date.now(),
    })),
    ...legacyMoments.map((row) => ({
      id: `moment:${row.id}`,
      kind: 'moment' as const,
      payload: JSON.stringify(row),
      createdAt: Date.now(),
    })),
  ]

  await db.transaction('rw', [db.sessions, db.sessionGroups, db.messages, db.wishlist, db.countdowns, db.bookmarks, db.bookmarkCategories, db.artworks, db.photos, db.photoCollections, db.readingNotes, db.musicTracks, db.studyRecords, db.studyCards, db.homeWidgets, db.listenSessions, db.studyTasks, db.stickers, db.legacyUploads], async () => {
    await db.sessions.clear()
    await db.sessionGroups.clear()
    await db.messages.clear()
    await db.wishlist.clear()
    await db.countdowns.clear()
    await db.bookmarks.clear()
    await db.bookmarkCategories.clear()
    await db.artworks.clear()
    await db.photos.clear()
    await db.photoCollections.clear()
    await db.readingNotes.clear()
    await db.musicTracks.clear()
    await db.studyRecords.clear()
    await db.studyCards.clear()
    await db.homeWidgets.clear()
    await db.listenSessions.clear()
    await db.studyTasks.clear()
    await db.stickers.clear()
    if (legacyRows.length > 0) await db.legacyUploads.bulkPut(legacyRows)
    await db.sessions.bulkAdd(sessions)
    await db.sessionGroups.bulkAdd(sessionGroups)
    await db.messages.bulkAdd(messages)
    await db.wishlist.bulkAdd(wishlist)
    await db.countdowns.bulkAdd(countdowns)
    await db.bookmarks.bulkAdd(bookmarks)
    await db.bookmarkCategories.bulkAdd(bookmarkCategories)
    await db.artworks.bulkAdd(artworks)
    await db.photos.bulkAdd(photos)
    await db.photoCollections.bulkAdd(photoCollections)
    await db.readingNotes.bulkAdd(readingNotes)
    await db.musicTracks.bulkAdd(musicTracks)
    await db.studyRecords.bulkAdd(studyRecords)
    await db.studyCards.bulkAdd(studyCards)
    await db.homeWidgets.bulkAdd(homeWidgets)
    await db.listenSessions.bulkAdd(listenSessions)
    await db.studyTasks.bulkAdd(studyTasks)
    await db.stickers.bulkAdd(stickers)
  })
  return {
    sessions: sessions.length,
    sessionGroups: sessionGroups.length,
    messages: messages.length,
    wishlist: wishlist.length,
    countdowns: countdowns.length,
    bookmarks: bookmarks.length,
    bookmarkCategories: bookmarkCategories.length,
    artworks: artworks.length,
    photos: photos.length,
    photoCollections: photoCollections.length,
    readingNotes: readingNotes.length,
    musicTracks: musicTracks.length,
    studyRecords: studyRecords.length,
    studyCards: studyCards.length,
    homeWidgets: homeWidgets.length,
    listenSessions: listenSessions.length,
    studyTasks: studyTasks.length,
    stickers: stickers.length,
    legacyDiaries: legacyDiaries.length,
    legacyMoments: legacyMoments.length,
  }
}
