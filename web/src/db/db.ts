import Dexie, { type Table } from 'dexie'
import type {
  Artwork,
  Bookmark,
  BookmarkCategory,
  ChatMessage,
  ChatSession,
  CountdownDay,
  Diary,
  HomeWidget,
  Moment,
  Photo,
  PhotoCollection,
  ReadingNote,
  MusicTrack,
  SessionGroup,
  StudyRecord,
  WishlistItem,
} from '@shared/types'

/**
 * 本地数据层（铁律5）：第一天就版本化迁移。
 * 后续结构变更一律新增 version(n+1).upgrade()，禁止改历史版本。
 *
 * v1：sessions / messages 基础索引
 * v2：messages 补 `[sessionId+createdAt]` 复合索引 —— 长会话要按时间分页拉取（§9 风险8），
 *     只靠 `sessionId` 单键索引取回来后还得在内存里排序，消息上万条时每次进页面都白排一遍。
 * v3：分页游标换成 `[sessionId+createdAt+id]` 三元复合索引 —— v2 的游标「不含上界」会让
 *     createdAt 撞毫秒的两条里较早那条被漏掉（批量导入常见），把 id 纳入键后
 *     「同毫秒按 id 续取」成为索引天然语义，无需应用层特判。
 * v4–v7：Phase 2 的十类 Home 生活实体（留言……学习记录），纯新增表，旧数据原样保留。
 * v8：会话分组（SPEC §2.1.3）—— `sessions` 加 `groupId` 索引 + 新增 `sessionGroups` 表。
 *     唯一的**真迁移**在这里：老会话没有 `groupId` 字段，upgrade 里统一补成 `null`。
 *     不靠「读的时候把 undefined 当 null 容忍」—— 那样「会话一定有 groupId」这条不变量
 *     就只存在于读取方的记忆里，任何忘记兜底的新读取点都会让会话从列表里凭空消失。
 * v9：主屏 Widget（SPEC §5.2）。纯新增表，旧数据原样保留，不需要 upgrade 回调 ——
 *     它对留言板 / 倒数日只是「多了一条引用」，没有动那两张表的任何字段。
 * v10：收藏分类 + 相册（SPEC §3.5.4 / §3.7.3）。新增两张分类表，`bookmarks` / `photos`
 *     各加一个归属字段（老数据在 upgrade 里补 `null`，同 v8 的做法）。
 */
export class HabitatDb extends Dexie {
  sessions!: Table<ChatSession, string>
  sessionGroups!: Table<SessionGroup, string>
  messages!: Table<ChatMessage, string>
  moments!: Table<Moment, string>
  wishlist!: Table<WishlistItem, string>
  countdowns!: Table<CountdownDay, string>
  diaries!: Table<Diary, string>
  bookmarks!: Table<Bookmark, string>
  bookmarkCategories!: Table<BookmarkCategory, string>
  artworks!: Table<Artwork, string>
  photos!: Table<Photo, string>
  photoCollections!: Table<PhotoCollection, string>
  readingNotes!: Table<ReadingNote, string>
  musicTracks!: Table<MusicTrack, string>
  studyRecords!: Table<StudyRecord, string>
  homeWidgets!: Table<HomeWidget, string>

  constructor() {
    super('habitat-db')
    this.version(1).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt',
    })
    // 只加索引、不改字段，Dexie 会自动为既有数据重建索引，无需 upgrade 回调
    this.version(2).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
    })
    this.version(3).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
    })
    // Phase 2 第一批：留言板 / 愿望清单 / 倒数日。新表不需要 upgrade 回调，旧数据原样保留。
    this.version(4).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
      moments: 'id, createdAt, author',
      wishlist: 'id, status, createdAt, updatedAt',
      countdowns: 'id, targetDate, createdAt',
    })
    // Phase 2 第二批：日记 + 统一收藏。旧表声明必须完整重复，Dexie 才会保留它们。
    this.version(5).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
      moments: 'id, createdAt, author',
      wishlist: 'id, status, createdAt, updatedAt',
      countdowns: 'id, targetDate, createdAt',
      diaries: 'id, entryDate, createdAt, updatedAt',
      bookmarks: 'id, targetType, targetId, createdAt, &[targetType+targetId]',
    })
    // Phase 2 第三批：作品 + 相册。图片正文嵌在 Photo 中，表只索引元数据。
    this.version(6).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
      moments: 'id, createdAt, author',
      wishlist: 'id, status, createdAt, updatedAt',
      countdowns: 'id, targetDate, createdAt',
      diaries: 'id, entryDate, createdAt, updatedAt',
      bookmarks: 'id, targetType, targetId, createdAt, &[targetType+targetId]',
      artworks: 'id, category, createdAt, updatedAt',
      photos: 'id, takenAt, createdAt',
    })
    // Phase 2 第四批：读书 + 音乐 + 学习。
    this.version(7).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
      moments: 'id, createdAt, author',
      wishlist: 'id, status, createdAt, updatedAt',
      countdowns: 'id, targetDate, createdAt',
      diaries: 'id, entryDate, createdAt, updatedAt',
      bookmarks: 'id, targetType, targetId, createdAt, &[targetType+targetId]',
      artworks: 'id, category, createdAt, updatedAt',
      photos: 'id, takenAt, createdAt',
      readingNotes: 'id, status, createdAt, updatedAt',
      musicTracks: 'id, createdAt, updatedAt',
      studyRecords: 'id, studiedOn, createdAt, updatedAt',
    })
    // v8：会话分组。`sessions` 多一个 `groupId` 索引（按分组取会话是列表页的主要读法，
    // 不做索引就得全表扫回来再在内存里分堆）+ 新增 `sessionGroups` 表。
    this.version(8)
      .stores({
        sessions: 'id, updatedAt, pinnedAt, archivedAt, groupId',
        sessionGroups: 'id, createdAt',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
        moments: 'id, createdAt, author',
        wishlist: 'id, status, createdAt, updatedAt',
        countdowns: 'id, targetDate, createdAt',
        diaries: 'id, entryDate, createdAt, updatedAt',
        bookmarks: 'id, targetType, targetId, createdAt, &[targetType+targetId]',
        artworks: 'id, category, createdAt, updatedAt',
        photos: 'id, takenAt, createdAt',
        readingNotes: 'id, status, createdAt, updatedAt',
        musicTracks: 'id, createdAt, updatedAt',
        studyRecords: 'id, studiedOn, createdAt, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('sessions')
          .toCollection()
          .modify((session: ChatSession) => {
            if (session.groupId === undefined) session.groupId = null
          })
      })
    // v9：主屏 Widget。`&kind` 是**唯一索引** —— 把「每种 Widget 全屏最多一个」（SPEC §1.4）
    // 这条不变量交给 schema，而不是靠每个写入点自己记得先查一次：
    // 漏掉一处，主屏上就会出现两张倒数日卡片，而这种 bug 只在「换一个上主屏」时才显形。
    this.version(9).stores({
      sessions: 'id, updatedAt, pinnedAt, archivedAt, groupId',
      sessionGroups: 'id, createdAt',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
      moments: 'id, createdAt, author',
      wishlist: 'id, status, createdAt, updatedAt',
      countdowns: 'id, targetDate, createdAt',
      diaries: 'id, entryDate, createdAt, updatedAt',
      bookmarks: 'id, targetType, targetId, createdAt, &[targetType+targetId]',
      artworks: 'id, category, createdAt, updatedAt',
      photos: 'id, takenAt, createdAt',
      readingNotes: 'id, status, createdAt, updatedAt',
      musicTracks: 'id, createdAt, updatedAt',
      studyRecords: 'id, studiedOn, createdAt, updatedAt',
      homeWidgets: 'id, &kind, createdAt',
    })
    // v10：收藏分类 + 相册（SPEC §3.5.4 / §3.7.3）。新增两张分类表，`bookmarks` 与 `photos`
    // 各加一个归属索引（按分类取条目是筛选条的主要读法，不做索引就得全表拉回来再在内存里筛）。
    // 两张表用各自的实体名而不是合成一张「分类表」：分类数据本来就是各模块独立的，
    // 合并只会多出一个 `scope` 分支，却省不下真正不同的那部分（从属表与字段名都不一样）。
    // ⚠️ 与 v8 同类：老收藏 / 老照片没有归属字段，upgrade 里统一补成 `null`。
    // 不靠读取方把 undefined 当 null 容忍 —— 那样「归属字段一定有值」这条不变量
    // 就只活在读取方的记忆里，筛选条会因此漏掉一批本该落在「未分类」里的旧数据。
    this.version(10)
      .stores({
        sessions: 'id, updatedAt, pinnedAt, archivedAt, groupId',
        sessionGroups: 'id, createdAt',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt+id]',
        moments: 'id, createdAt, author',
        wishlist: 'id, status, createdAt, updatedAt',
        countdowns: 'id, targetDate, createdAt',
        diaries: 'id, entryDate, createdAt, updatedAt',
        bookmarks: 'id, targetType, targetId, createdAt, categoryId, &[targetType+targetId]',
        bookmarkCategories: 'id, createdAt',
        artworks: 'id, category, createdAt, updatedAt',
        photos: 'id, takenAt, createdAt, collectionId',
        photoCollections: 'id, createdAt',
        readingNotes: 'id, status, createdAt, updatedAt',
        musicTracks: 'id, createdAt, updatedAt',
        studyRecords: 'id, studiedOn, createdAt, updatedAt',
        homeWidgets: 'id, &kind, createdAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('bookmarks')
          .toCollection()
          .modify((bookmark: Bookmark) => {
            if (bookmark.categoryId === undefined) bookmark.categoryId = null
          })
        await tx
          .table('photos')
          .toCollection()
          .modify((photo: Photo) => {
            if (photo.collectionId === undefined) photo.collectionId = null
          })
      })
  }
}

export const db = new HabitatDb()

/** 水合失败必须拦截用户（float-phone 教训），由启动流程调用并捕获 */
export async function hydrateDb(): Promise<void> {
  await db.open()
}
