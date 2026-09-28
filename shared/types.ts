/**
 * 统一数据模型类型（技术方案 §6）
 * 前后端共享的唯一权威定义；实现细节（Dexie / Drizzle schema）各自映射。
 */

/** 统一基座（§6.1）：所有可收藏、可统计、可关联实体继承它 */
export interface BaseObject {
  id: string
  type: string
  createdAt: number
  updatedAt: number
  sourceId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

export type BubbleMode = 'chat' | 'native'

/** 聊天会话（本地 Dexie） */
export interface ChatSession extends BaseObject {
  type: 'chat-session'
  title: string
  /** 置顶是**时间戳而非布尔**（§6.2）：取消置顶后仍能回到原本的活跃顺序 */
  pinnedAt: number | null
  /** 所属分组；`null` = 未分组。指向已不存在的分组时按未分组处理（SPEC §2.1.3 兜底区） */
  groupId: string | null
  remark: string | null
  background: string | null
  bubbleMode: BubbleMode
  archivedAt: number | null
}

/**
 * 会话上下文压缩的一条可恢复摘要（PRODUCT_SPEC §2.5）。
 *
 * 摘要只是上下文投影，原消息永远留在 `messages`；通过消息 id 记录覆盖边界，
 * 这样编辑 / 重放 / 重新生成时不会把未来消息偷偷带进提示词。
 */
export interface ChatContextSummary {
  id: string
  text: string
  coveredFromMessageId: string
  coveredToMessageId: string
  coveredMessageCount: number
  coveredFrom: number
  coveredTo: number
  generatedAt: number
  updatedAt: number
  model: string
  profileId: string
  version: number
  source: 'model' | 'edited'
}

/** 会话元数据中的压缩状态；不新增 Dexie 表 / 索引，随 sessions 一起备份。 */
export interface ChatContextCompressionState {
  activeSummaryId: string | null
  versions: ChatContextSummary[]
}

/**
 * 会话分组（SPEC §2.1.3，本地 Dexie）。
 *
 * 只是一个「分区」：**删分组不删会话** —— 组内会话的 `groupId` 会被置回 `null` 落进未分组区。
 * 折叠状态跟着数据走（不是 UI 局部状态），刷新与换设备后保持一致。
 */
export interface SessionGroup extends BaseObject {
  type: 'session-group'
  name: string
  collapsed: boolean
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error' | 'aborted'

/**
 * 可扩展消息块（§6.2）：渲染器**按 kind 分发**。
 *
 * v1 里 `payload` 是 `unknown`、`kind` 是枚举串，渲染器只能靠 `as` 断言取字段。
 * 现在补上每种块的载荷契约并改成**可辨识联合**：switch 一下 payload 就自动收窄，
 * 少写一层运行时校验；日后新增块类型时先在这里加一条，渲染器会因穷尽检查报错提醒补分支。
 *
 * 载荷设计原则：**只放「怎么显示」，不放「这是什么」** —— url / 文案 / 尺寸足矣；
 * 语义（这是相册里的哪张、这是哪次工具调用）留在 `ChatMessage.metadata` 或对应实体上。
 */

export interface TextBlock {
  kind: 'text'
  payload: { text: string }
  order: number
}

/**
 * 富文本 / 小部件。
 * ⚠️ 内容可能来自 LLM，**不可直接 `dangerouslySetInnerHTML`**（详见 `docs/TASKS.md`：
 * 渲染前需经沙箱化，Phase 5 接入时再落地）。
 */
export interface HtmlBlock {
  kind: 'html'
  payload: { html: string }
  order: number
}

export interface ImageBlock {
  kind: 'image'
  payload: { url: string; alt?: string; width?: number; height?: number }
  order: number
}

export interface AudioBlock {
  kind: 'audio'
  payload: { url: string; durationMs?: number; transcript?: string }
  order: number
}

export interface FileBlock {
  kind: 'file'
  payload: { url: string; name: string; mime?: string; size?: number }
  order: number
}

/** 独立表情包消息块：与 Unicode emoji 分开，带图库 id + 发送时快照，资源删除不影响历史。 */
export interface StickerBlock {
  kind: 'sticker'
  payload: {
    stickerId: string
    name: string
    imageDataUrl: string
    mimeType: PhotoMime
    source?: string
    tags?: string[]
  }
  order: number
}

/** 工具调用结果（Phase 3 起由 MCP Gateway 产出） */
export interface ToolResultBlock {
  kind: 'tool-result'
  /**
   * `source` / `label` 是 Phase 6.5 新增的**展示元数据**（都是可选的，旧数据不受影响）：
   * 卡片要显示「✅ Nocturne · 搜索记忆」这种来源+动作，而不是内部工具名 `memory_search` ——
   * 工具名是适配层的实现细节，不该出现在用户界面上。
   */
  payload: {
    toolName: string
    ok: boolean
    summary?: string
    /** 可折叠详情（服务端已裁剪）；字符串直接按原文显示，不当 JSON 再序列化一遍 */
    result?: unknown
    source?: string
    label?: string
    /** 工具实际完成（或失败）的时间，和来源一起保留在本地卡片 */
    occurredAt?: number
    /**
     * 待确认事件的 id（Phase 6.5 P1，仅 `confirm` 级工具会有）。
     *
     * 有这个字段就说明**这次调用没有真的执行** —— 服务端把它挂成了一条待北北确认的事件，
     * 卡片要据此渲染「允许 / 拒绝」按钮，而不是显示「已完成」。
     * ⚠️ 不要用 `ok` 判断是否需要确认：挂起是**成功**的调用（`ok: true`），
     * 只是结果还没发生。把「挂起」混进 `ok` 里会让模型以为它失败了，从而重试。
     */
    eventId?: string
  }
  order: number
}

export interface WidgetBlock {
  kind: 'widget'
  payload: { title?: string; source?: string }
  order: number
}

/**
 * 能塞进 tab 里的**叶子块**集合。
 * ⚠️ 刻意排除 `tab-group` 自身：块里再套块组会形成递归类型，而 Dexie 的键路径推导
 * （`KeyPaths`，见 `web/src/db/db.ts` 的 `Table<ChatMessage>`）展开递归类型会直接报 TS2615。
 * 真要支持任意嵌套，得连同存储层一起重新设计（Phase 5 再评估）。
 */
export type LeafMessageBlock =
  | TextBlock
  | HtmlBlock
  | ImageBlock
  | AudioBlock
  | FileBlock
  | StickerBlock
  | ToolResultBlock
  | WidgetBlock

export interface TabGroupBlock {
  kind: 'tab-group'
  payload: { tabs: Array<{ label: string; blocks: LeafMessageBlock[] }> }
  order: number
}

export type MessageBlock =
  | TextBlock
  | HtmlBlock
  | ImageBlock
  | AudioBlock
  | FileBlock
  | StickerBlock
  | ToolResultBlock
  | WidgetBlock
  | TabGroupBlock

export type MessageBlockKind = MessageBlock['kind']

/** 消息版本 / 多候选（§6.3 提前量：Phase 1 建表即预留，一次建表同时满足编辑与重roll） */
export interface MessageCandidate {
  content: string
  origin: 'edit' | 'reroll'
  selected: boolean
}

/** 聊天消息（本地 Dexie） */
export interface ChatMessage extends BaseObject {
  type: 'chat-message'
  sessionId: string
  role: MessageRole
  status: MessageStatus
  replyToId: string | null
  blocks: MessageBlock[]
  versionOf: string | null
  candidates: MessageCandidate[]
  recalledAt: number | null
  editedAt: number | null
}

/* ---------- Home 共同生活（服务端 SQLite，Phase 6.5 起从 Dexie 迁入） ---------- */

/**
 * 内容作者位 —— 它同时**就是权限位**，不另设一套 role 字段。
 *
 * - `user`      用户自己产的普通内容：可自由读写删（SPEC §6.1）
 * - `companion` AI 私有内容（日记 / 主动留言）：用户默认只能看封面（SPEC §6.2 / §6.3）
 */
export type ContentAuthor = 'companion' | 'user'

/** 共同生活内容所在的空间；留言板与朋友圈共用对象基座，但不共用展示语义。 */
export type MomentChannel = 'board' | 'feed'

/**
 * 留言板的一条生活痕迹。
 *
 * `companion` 这个取值自 Phase 2 就写在类型里，但一直没被写进去过（`createMoment` 硬编码 `'user'`）；
 * Phase 6.5 起 AI 主动行为才真正能往这里落内容。
 */
export interface Moment extends BaseObject {
  type: 'moment'
  content: string
  author: ContentAuthor
  channel: MomentChannel
  /** 所属留言分组；null 表示未分组。删组时回到未分组，不删除留言。 */
  groupId: string | null
}

/** 留言板分组。分组只负责整理展示，不改变留言的作者与生命周期。 */
export interface MomentGroup extends BaseObject {
  type: 'moment-group'
  name: string
}

export type WishlistStatus = 'open' | 'done' | 'paused' | 'abandoned'

export type WishlistProgressSourceType = 'chat-message' | 'artwork' | 'music-track' | 'reading-note' | 'countdown-day'

export interface WishlistProgress extends BaseObject {
  type: 'wishlist-progress'
  note: string
  author: ContentAuthor
  sourceType: WishlistProgressSourceType | null
  sourceId?: string
}

export interface WishlistItem extends BaseObject {
  type: 'wishlist-item'
  title: string
  status: WishlistStatus
  completedAt: number | null
  author: ContentAuthor
  /** 纯本地日期 YYYY-MM-DD；不带时区。 */
  targetDate: string | null
  statusChangedAt: number
  statusReason: string | null
  progress: WishlistProgress[]
}

/** `targetDate` 固定为本地日期 `YYYY-MM-DD`，避免纯日期被时区偏移。 */
export type CountdownCategory = 'anniversary' | 'event' | 'deadline' | 'other'
export type CountdownRepeat = 'none' | 'yearly'
export type CountdownReminder = 'none' | 'on-day' | 'one-day-before'

export interface CountdownDay extends BaseObject {
  type: 'countdown-day'
  title: string
  targetDate: string
  /** 语义分类只影响展示与筛选，不改变倒数事实本身。 */
  category: CountdownCategory
  /** 首批支持每年重复，足够覆盖纪念日；更复杂的规则另行演进。 */
  repeat: CountdownRepeat
  /** 提醒写入现有通知收件箱；不在本地对象里保存“已提醒”状态。 */
  reminder: CountdownReminder
}

/** 主屏 Widget 的形态（SPEC §5.2 首批两种） */
export type HomeWidgetKind = 'board' | 'countdown'

/** 留言板 Widget 的展示范围；只保存引用语义，不复制留言正文。 */
export type BoardWidgetScope =
  | { kind: 'recent' }
  | { kind: 'group'; groupId: string }
  | { kind: 'moment'; momentId: string }

/**
 * 主屏 Widget（SPEC §1.4 / §5.2）：**只存引用，不复制被展示的数据** ——
 * 卡片内容始终从 `moments` / `countdowns` 实时读。
 *
 * 每种 `kind` 全表最多一条（由 Dexie `&kind` 唯一索引兜住）：
 * 「换一个倒数日上主屏」是**改 `refId`**，不是再加一条。
 *
 * 刻意不设 `order`：v0.1 至多两个 Widget，先后按 `createdAt` 定就够；
 * 等真做拖拽编排（§5.1）时再加，不留没有生产者的字段。
 */
export interface HomeWidget extends BaseObject {
  type: 'home-widget'
  kind: HomeWidgetKind
  /** 引用目标：倒数日 Widget 指向 `CountdownDay.id`；留言板统一为 `null`，范围见 `boardScope` */
  refId: string | null
  /** 倒数日为 null；老备份 / 老库迁移为留言板最近 3 条。 */
  boardScope: BoardWidgetScope | null
}

/**
 * AI 对「这篇给不给用户看」的决定（SPEC §3.4.3）。
 *
 * 三态是**同一件事的三种状态**，所以合成一个字段而不是拆 `private` + `locked` 两个布尔 ——
 * 拆开就会出现「private 且 locked」这种没有含义的组合，读的人还得猜哪个优先。
 */
export type DiaryVisibility = 'private' | 'open' | 'locked'

/**
 * 日记按本地日期归档；正文先存纯文本，避免在没有富文本沙箱前引入 HTML。
 *
 * ⚠️ **权威存储在服务端 SQLite**（2026-09-24 从 Dexie 迁入）—— AI 也在服务端跑，
 * 只有放服务端才谈得上「AI 和用户操作同一个真实数据源」（SPEC §6.3）。
 * 前端 Dexie 不再保留 `diaries` 表（v11 起）。
 */
export interface Diary extends BaseObject {
  type: 'diary'
  title: string
  content: string
  entryDate: string
  author: ContentAuthor
  visibility: DiaryVisibility
}

/**
 * 日记的**面向前端的视图** —— 与 `Diary` 分开，是因为它可能**没有正文**。
 *
 * 「用户看得到这篇日记存在」与「用户看得到这篇日记写了什么」是两件事（SPEC §3.4.2）：
 * 列表接口对 AI 私密日记只下发封面，`content` 为 `null`。
 * 用 `readable` / `editable` 显式表达权限，而不是让前端拿 `content === null` 去猜 ——
 * 「null 是因为没权限」和「null 是因为还没写」是两种完全不同的情况，不能用同一个信号。
 */
export interface DiaryView {
  id: string
  title: string
  entryDate: string
  author: ContentAuthor
  visibility: DiaryVisibility
  createdAt: number
  updatedAt: number
  /** 有权限时为正文；无权限时 `null`（**不是空串**） */
  content: string | null
  /** 按正文段落拆出的权限视图；私密段落只返回封面，不返回正文 */
  fragments: DiaryFragmentView[]
  /** 当前用户能否读到正文 */
  readable: boolean
  /** 当前用户能否编辑 / 删除（只有 `author='user'` 的日记可以） */
  editable: boolean
}

export interface DiaryFragmentView {
  id: string
  index: number
  content: string | null
  visibility: DiaryVisibility
  readable: boolean
}

/* ---------- Event Inbox · 事件收件箱（Phase 6.5 P1，服务端权威） ---------- */

/**
 * 事件类型。**两种事件的决策方相反**，这正是收件箱是「双向」的原因：
 *
 * - `tool_confirm` —— AI 想写日记 / 留言，**等北北点确认**（决策方 = user）
 * - `diary_access_request` —— 北北想看某篇私密日记，**等 AI 决定放不放**（决策方 = companion）
 *
 * 把两者放进同一张表而不是各建一套，是因为它们的生命周期完全一样
 * （创建 → 待决 → 决策 → 执行 → 结果回灌），只有「谁来点这个按钮」不同。
 */
export type RuntimeEventKind = 'tool_confirm' | 'diary_access_request'

/** 决策方：谁有权对这一条做出决定。 */
export type RuntimeEventDecider = 'companion' | 'user'

/**
 * 事件状态。
 *
 * `pending` 之外一律是**终态**：决策只能做一次，重复决策返回错误而不是静默覆盖
 * （否则卡片点两下就会写两篇日记）。
 */
export type RuntimeEventStatus =
  | 'pending'
  /** 已批准且**真的执行成功** */
  | 'approved'
  /** 被决策方拒绝（不执行任何副作用） */
  | 'denied'
  /** 批准了，但执行时失败（例如正文超长）—— 与 `denied` 分开，因为原因完全不同 */
  | 'failed'

/**
 * 事件收件箱里的一条。
 *
 * ⚠️ `title` / `detail` 是**给人看的**；执行载荷（工具名 + 参数、或日记 id）刻意不在这里 ——
 * 本形状会直接下发前端，把执行载荷放进来等于让它跟着接口露出去。
 */
export interface RuntimeEvent {
  id: string
  kind: RuntimeEventKind
  decider: RuntimeEventDecider
  status: RuntimeEventStatus
  /** 一句话（卡片标题 / 收件箱列表行） */
  title: string
  /** 展开详情，服务端已裁剪 */
  detail: string
  createdAt: number
  decidedAt: number | null
  /** 执行结果（给模型读的一段话）；未执行时为 `null` */
  result: string | null
  /**
   * 结果是否已注入过模型上下文。
   * 已决事件**只告诉模型一次** —— 每轮重复「北北已经允许你写日记了」既费 token 又会让它重复动作。
   */
  resultDelivered: boolean
  /** 涉及的能力 id（如 `diary.create`），前端据此显示图标/分组 */
  capabilityId: string | null
  /**
   * 这条事件**指向哪个业务对象**（日记 id / 留言 id；指向不明确时为 `null`）。
   *
   * 存在的理由很实际：日记页要能显示「这一篇你已经请求过了」。
   * 而执行载荷（`payload`）刻意不下发，前端就得靠这个字段自己匹配 ——
   * 没有它，用户只能靠「点了没反应」来判断，那是最差的一种反馈。
   */
  targetId: string | null
  /** 若这是片段级日记请求，指向具体 `fragment-N`；整篇请求为 `null`。 */
  targetFragmentId: string | null
}

/**
 * 收藏用 `targetType + targetId` 统一指向一切（技术方案 §6.2）。
 * 当前 UI 只生产 external-link；其余取值给后续各模块的“收藏”按钮共用。
 */
export type BookmarkTargetType =
  | 'external-link'
  | 'chat-message'
  | 'diary'
  | 'moment'
  | 'artwork'
  | 'photo'
  | 'reading-note'
  | 'reading-excerpt'
  | 'music-track'
  | 'study-record'

/**
 * 收藏分类（SPEC §3.5.4）：用户自建的**收纳**维度，**单归属**。
 *
 * ⚠️ 与 `ArtworkCategory` 不是一回事：那个是作品内建的四种类型（字面量联合，不可增删），
 * 这个是可以随时新建 / 改名 / 删除的独立实体。多维度标记交给后续的「标签」，不让分类兼任。
 */
export interface BookmarkCategory extends BaseObject {
  type: 'bookmark-category'
  name: string
}

export interface Bookmark extends BaseObject {
  type: 'bookmark'
  targetType: BookmarkTargetType
  targetId: string
  title: string
  note: string | null
  /** 所属分类；`null` = 未分类。指向已不存在的分类时按未分类处理（SPEC §3.5.4 兜底区） */
  categoryId: string | null
  /** 多维度标记；与 categoryId 的单归属收纳语义分开。 */
  tags: string[]
}

export type ArtworkCategory = 'writing' | 'visual' | 'audio' | 'other'

export interface Artwork extends BaseObject {
  type: 'artwork'
  title: string
  category: ArtworkCategory
  description: string
  externalUrl: string | null
}

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

/** 分类相册（SPEC §3.7.3）：与收藏分类同构，同样**单归属**；界面文案叫「相册」。 */
export interface PhotoCollection extends BaseObject {
  type: 'photo-collection'
  name: string
}

/** Phase 2 先以内联 data URL 保存，确保 IndexedDB 与 JSON 备份都能原样恢复。 */
export interface Photo extends BaseObject {
  type: 'photo'
  title: string
  caption: string | null
  imageDataUrl: string
  mimeType: PhotoMime
  sizeBytes: number
  takenAt: string
  /** 所属相册；`null` = 未分类。指向已不存在的相册时按未分类处理（SPEC §3.7.3 兜底区） */
  collectionId: string | null
}

export type ReadingStatus = 'want' | 'reading' | 'finished'

/** 阅读器第一切片：保存在既有 ReadingNote.metadata.reader 下，不另造平行书库表。 */
export type ReadingFormat = 'txt'

export type ReadingTheme = 'paper' | 'sepia' | 'night'
export type ReadingFontSize = 'small' | 'medium' | 'large'

export interface ReadingAnnotation {
  id: string
  paragraphIndex: number
  text: string
  note: string
  author: 'user' | 'companion'
  createdAt: number
}

/** 本地优先表情图库。原图以内联 data URL 保存，消息发送时另存快照。 */
export interface Sticker extends BaseObject {
  type: 'sticker'
  name: string
  imageDataUrl: string
  mimeType: PhotoMime
  sizeBytes: number
  category: string | null
  tags: string[]
  source: 'user' | 'mcp'
}

export interface ReadingVocabulary {
  id: string
  paragraphIndex: number
  term: string
  note: string
  createdAt: number
}

export interface ReadingBookState {
  format: ReadingFormat
  content: string
  currentParagraph: number
  bookmarkParagraph: number | null
  readingSeconds: number
  annotations: ReadingAnnotation[]
  theme: ReadingTheme
  fontSize: ReadingFontSize
  vocabulary: ReadingVocabulary[]
}

export interface ReadingNote extends BaseObject {
  type: 'reading-note'
  bookTitle: string
  author: string | null
  status: ReadingStatus
  note: string
}

/** 每日品读只保存一次片段选择的事实，正文来自当时的书架段落快照。 */
export interface DailyReadingEntry extends BaseObject {
  type: 'daily-reading'
  sourceBookId: string
  paragraphIndex: number
  bookTitle: string
  author: string | null
  text: string
}

export interface MusicTrack extends BaseObject {
  type: 'music-track'
  title: string
  artist: string | null
  note: string | null
  externalUrl: string | null
}

/** 服务器权威的“一起听”当前会话；曲目本体仍复用本地 MusicTrack 快照。 */
export type ListeningPlaybackState = 'idle' | 'playing' | 'paused'

export interface ListeningSessionView {
  id: 'main'
  track: Pick<MusicTrack, 'id' | 'title' | 'artist' | 'externalUrl'> | null
  state: ListeningPlaybackState
  positionSeconds: number
  startedAt: number | null
  updatedAt: number
  listeners: { user: boolean; companion: boolean }
}

/** `studiedOn` 是本地日期；时长统一存分钟，避免展示层反复换算。 */
export interface StudyRecord extends BaseObject {
  type: 'study-record'
  subject: string
  note: string
  studiedOn: string
  durationMinutes: number
}

/** AI 伴学卡片：正文由服务端生成，复习状态由浏览器本地持有。 */
export interface StudyCard extends BaseObject {
  type: 'study-card'
  subject: string
  front: string
  back: string
  example: string | null
  hint: string | null
  source: 'ai' | 'user'
  dueOn: string
  intervalDays: number
  ease: number
  repetitions: number
  lastReviewedAt: number | null
}

export interface StudyCardDraft {
  front: string
  back: string
  example: string | null
  hint: string | null
}

/* ---------- 学习伴学 · 今日任务（第 6 批；纯本地，按天归组） ---------- */

export interface StudyTask {
  id: string
  /** 归属哪一天（YYYY-MM-DD）；隔天自动就是新的一页，昨天的任务不追到今天 */
  dayKey: string
  label: string
  done: boolean
  createdAt: number
}

/** 学习资料：先保存用户明确提供的 TXT / Markdown 内容或安全的外部链接。 */
export type StudyMaterialKind = 'text' | 'link'

export interface StudyMaterial extends BaseObject {
  type: 'study-material'
  subject: string
  title: string
  kind: StudyMaterialKind
  content: string | null
  url: string | null
}

/* ---------- 一起听 / 听雨 · 时长统计（第 6 批；纯本地，一天一行累加秒数） ---------- */

export type ListenKind = 'music' | 'rain'

export interface ListenSession {
  /** `${kind}:${dayKey}` —— 一天一行，秒数往上累加 */
  id: string
  kind: ListenKind
  dayKey: string
  seconds: number
  updatedAt: number
  createdAt: number
}

/* ---------- LLM 方案（§6.2 ApiProfile / §7.1 多方案管理） ---------- */

/** 适配器类型。§7.1：以 OpenAI Chat Completions 兼容协议为最小公分母，后续可加原生适配器 */
export type LlmProviderKind = 'openai-compat' | 'elevenlabs'

/** Provider Center 的四个独立能力入口（PRODUCT_SPEC §9.3）。 */
export type ProviderCapability = 'chat' | 'voice' | 'vision' | 'image'

/** 当前生产绑定。voice 的 secondaryModel 用于可选的语音转写模型。 */
export interface ProviderCapabilityBinding {
  capability: ProviderCapability
  profileId: string
  model: string
  secondaryModel: string | null
  lastTestedAt: number | null
  lastLatencyMs: number | null
  lastError: string | null
  updatedAt: number
}

export interface ProviderBindingSnapshot {
  profileId: string
  model: string
  secondaryModel: string | null
}

export type ProviderSchemeBindings = Partial<Record<ProviderCapability, ProviderBindingSnapshot>>

/** 四通道绑定的命名快照；只引用 profileId，不复制密钥。 */
export interface ProviderScheme {
  id: string
  name: string
  bindings: ProviderSchemeBindings
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface ProviderCenterState {
  bindings: ProviderCapabilityBinding[]
  schemes: ProviderScheme[]
}

export type ProviderDraftErrorCategory =
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'protocol'
  | 'unsupported'
  | 'empty-models'
  | 'empty-voices'
  | 'unknown'

/** 未保存草稿：密钥只随本次请求进入服务端，任何响应都不会回显。 */
export interface ProviderDraftInput {
  profileId?: string
  provider?: LlmProviderKind
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  streamOptions?: boolean
  voiceSettings?: ElevenLabsVoiceSettings
}

export interface ProviderDraftModelsResult {
  ok: boolean
  latencyMs: number
  models: string[]
  errorCategory: ProviderDraftErrorCategory | null
  error: string | null
}

export interface ElevenLabsVoiceOption {
  id: string
  name: string
  category: string | null
  description: string | null
  labels: Record<string, string>
}

export interface ProviderDraftVoicesResult {
  ok: boolean
  latencyMs: number
  voices: ElevenLabsVoiceOption[]
  errorCategory: ProviderDraftErrorCategory | null
  error: string | null
}

export interface ProviderDraftTestInput extends ProviderDraftInput {
  capability: ProviderCapability
  model: string
  secondaryModel?: string
  /** ElevenLabs 语音 ID；仅 voice 能力使用。 */
  voiceId?: string
  /** vision 测试图；只在识图能力测试中使用。 */
  dataUrl?: string
}

export interface ProviderDraftTestResult {
  capability: ProviderCapability
  ok: boolean
  latencyMs: number
  testedAt: number
  errorCategory: ProviderDraftErrorCategory | null
  error: string | null
  /** 语音或生图测试的可预览 data URL；聊天 / 识图为 null。 */
  previewDataUrl: string | null
  /** 识图测试的文本结果。 */
  description: string | null
}

/** 同一方案下不同服务各用哪个模型（§6.2 modelMap） */
export interface ApiProfileModelMap {
  chat?: string
  tts?: string
  /** ElevenLabs voice id；仅 voice 能力使用，不是模型名。 */
  voice?: string
  /** ElevenLabs 每次请求覆盖的声音参数；仅原生 voice Provider 使用。 */
  voiceSettings?: ElevenLabsVoiceSettings
  transcription?: string
  vision?: string
  image?: string
  embedding?: string
}

export interface MediaTranscriptionResult {
  text: string
  model: string
}

export interface MediaVisionResult {
  description: string
  model: string
}

export interface MediaImageResult {
  dataUrl: string
  model: string
}

export interface McpToolDescriptor {
  serverId: string
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
}

/**
 * LLM 方案（§6.2）：一份「baseUrl + 鉴权 + 模型映射」的组合。
 * 换模型 / 换服务商只改这里，业务代码不动（§7.1）。
 *
 * ⚠️ 本结构**不存任何密钥**：`keyRef` 只是「持有该密钥的环境变量名」，
 * 真值只活在服务端进程环境里（铁律 3：API Key 不出服务端）。
 */
export interface ApiProfile {
  id: string
  name: string
  provider: LlmProviderKind
  /** 不带结尾斜杠；兼容层自动拼 `/chat/completions`、`/models` */
  baseUrl: string
  /** 环境变量名，如 `'DEEPSEEK_API_KEY'`；留空串表示该上游不需要鉴权 */
  keyRef: string
  modelMap: ApiProfileModelMap
  /** 附加请求头（部分中转需要）。值可能含密钥，故**不下发前端** */
  headers?: Record<string, string>
  /**
   * 是否带 `stream_options: { include_usage: true }`（缺省 = true）。
   * 绝大多数上游靠它在末包回 usage（记账用）；极少数老自建上游会因此 400，可关。
   */
  streamOptions?: boolean
  isActive: boolean
}

/**
 * 凭据就绪情况（脱敏视图用）。
 *
 * 为什么单列它而不只看 `hasKey`：`keyRef` 为空串表示「该上游不需要鉴权」（本地 vLLM / Ollama），
 * 这种方案 `hasKey` 也恒为 true，于是「不需要密钥」与「密钥已配好」在 UI 上无法区分，文案容易写错。
 */
export type ApiKeySource =
  /** 密钥存在服务端（用户在此页填的），可直接用 */
  | 'stored'
  /** 密钥来自 `keyRef` 指向的环境变量，可直接用 */
  | 'env'
  /** 声明了 keyRef 但环境变量没设 —— 不可用，要提示用户去填 */
  | 'missing'
  /** `keyRef` 为空串：该上游不需要鉴权，直接可用 */
  | 'not-required'

/** 下发给前端的方案视图（脱敏）：只暴露 header 的**名字**，不暴露值 */
export interface ApiProfilePublic {
  id: string
  name: string
  provider: LlmProviderKind
  baseUrl: string
  keyRef: string
  /** 凭据是否已就绪、可直接发起调用（`keySource !== 'missing'`） */
  hasKey: boolean
  /** 凭据来自哪里 —— UI 文案据此区分「已保存」/「来自环境变量」/「缺密钥」/「无需密钥」 */
  keySource: ApiKeySource
  modelMap: ApiProfileModelMap
  headerNames: string[]
  /** 与 ApiProfile.streamOptions 同义；不下发敏感信息，这个开关无所谓 */
  streamOptions: boolean
  isActive: boolean
}

/**
 * 新建方案的入参。
 * ⚠️ **密钥不在这里** —— 配置与凭据分两个端点（`PUT /api/providers/:id/secret`）。
 * 好处：改 baseUrl 不会误清密钥，密钥也永远不会被任何 GET 回读。
 */
export interface ApiProfileCreateInput {
  name: string
  provider?: LlmProviderKind
  baseUrl: string
  modelMap: ApiProfileModelMap
  /** 留空表示该上游不需要鉴权 */
  keyRef?: string
  /** 附加请求头。其值可能含凭证，故只在写入时单向传递，不回读 */
  headers?: Record<string, string>
  /** 缺省 = 开；显式 false 才关（部分不支持 stream_options 的自建上游） */
  streamOptions?: boolean
  isActive?: boolean
}

/** 更新方案的入参：全字段可选，只改送来的那些 */
export type ApiProfileUpdateInput = Partial<ApiProfileCreateInput>

/** 写入密钥的请求体（只进不出，任何接口都不会把它读回来） */
export interface ApiProfileSecretInput {
  secret: string
}

/** 方案连通性探测结果（`POST /api/providers/:id/test`；探测失败也是「结果」，不抛错） */
export interface LlmProbeResult {
  profileId: string
  ok: boolean
  latencyMs: number
  modelCount: number
  /** 只带前几个模型名，够 UI 展示即可 */
  sampleModels: string[]
  /** ok=false 时的可读原因 */
  error: string | null
}

/* ---------- 服务端实体（SQLite，Phase 0 仅诊断/健康相关） ---------- */

export type McpServerState = 'disconnected' | 'connecting' | 'handshake' | 'ready' | 'error'

/** MCP Gateway 每个 server 的聚合健康状态（§7.2② → GET /api/health/mcp） */
export interface McpServerHealth {
  serverId: string
  name?: string
  state: McpServerState
  /** 是否配置了连接地址 —— false 时 UI 应显示「未配置」而不是「异常」 */
  configured: boolean
  /** 是否允许 Gateway 将该 server 接入工具面。 */
  enabled?: boolean
  /** 是否允许 AI Runtime 自主绑定该 server 的工具；用户发起工具仍可见。 */
  allowAutonomous?: boolean
  toolCount: number
  lastError: string | null
  lastCheckedAt: number | null
}

export interface ElevenLabsVoiceSettings {
  stability?: number
  similarityBoost?: number
  style?: number
  useSpeakerBoost?: boolean
  speed?: number
}

export interface ServerHealth {
  ok: boolean
  service: string
  time: string
}

export interface McpHealth {
  ok: boolean
  servers: McpServerHealth[]
}

/** MCP Manager 对外展示的脱敏 server 视图；token / header 值永不下发。 */
export interface McpServerView extends McpServerHealth {
  name: string
  url: string | null
  hasToken: boolean
  headerNames: string[]
  createdAt: number
  updatedAt: number
}

export interface McpManagerState {
  servers: McpServerView[]
}

export interface McpServerCreateInput {
  id?: string
  name: string
  url: string
  token?: string
  headers?: Record<string, string>
  enabled?: boolean
  allowAutonomous?: boolean
}

export interface McpServerUpdateInput {
  name?: string
  url?: string
  token?: string
  clearToken?: boolean
  headers?: Record<string, string>
  enabled?: boolean
  allowAutonomous?: boolean
}

export interface McpToolView {
  serverId: string
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
}

export interface McpTestResult {
  serverId: string
  ok: boolean
  latencyMs: number
  toolCount: number
  sampleTools: string[]
  error: string | null
}

/** Nocturne 原生 Dashboard 受保护入口状态；不向浏览器下发 MCP URL / token。 */
export interface NocturneDashboardState {
  configured: boolean
  error: string | null
}

/* ---------- Eventide 状态（服务端 SQLite + Python sidecar） ---------- */

/**
 * Eventide 的宿主持久化快照。`state` 是上游可往返的 JSON，habitat 不复制其内部字段定义；
 * `stateCard` 给模型上下文，`payload` 给未来 UI，两条消费路径互不解析对方格式。
 */
export interface BodyStateSnapshot {
  state: Record<string, unknown>
  stateCard: string | null
  payload: Record<string, unknown>
  settledAt: number
}

export interface StateProviderHealth {
  ok: boolean
  configured: boolean
  service: 'eventide'
  revision: string | null
  lastError: string | null
  lastCheckedAt: number
}

/* ---------- Phase 3B 主动行为 / 预算 / 钱包 ---------- */

export type AutomationKind = 'chat' | 'wake' | 'solitude' | 'dream' | 'settlement'

/**
 * 自主行动类型（Phase 7B · 决策契约）：一次后台运行（wake/solitude）里，
 * 模型决策可以产出的行动。`surf` 只出现在独处运行里。
 */
export type AutomationActionType = 'message' | 'messageboard' | 'diary' | 'surf'

/** 单个行动的执行结果（审计用：run 的 outcome 拆到行动级） */
export interface AutomationActionRecord {
  id: number
  runId: string
  idx: number
  type: AutomationActionType
  status: 'completed' | 'failed' | 'skipped'
  reason: string | null
  /** 行动产物的引用（通知 id / 留言 id / 日记 id / 独处记录 id） */
  refId: string | null
  at: number
}

export interface AutomationPolicy {
  enabled: boolean
  wakeEnabled: boolean
  solitudeEnabled: boolean
  dreamEnabled: boolean
  timeZone: string
  quietStart: string
  quietEnd: string
  minSilenceMinutes: number
  wakeCooldownMinutes: number
  maxUnansweredWakes: number
  maxDailyProactiveRuns: number
  maxDailyApiCalls: number
  maxDailyTokens: number
  maxDailyCostCents: number | null
  solitudeStart: string
  solitudeEnd: string
  triggerWords: string[]
  dreamSeed: string | null
  /** 独处冲浪（Phase 7B）：独处时光里是否允许自主选题浏览并记录。默认关闭 */
  surfEnabled: boolean
}

export interface AutomationRuntimeState {
  lastCounterpartAt: number | null
  lastWakeAt: number | null
  unansweredWakes: number
  lastSolitudeDayKey: string | null
  lastDreamDayKey: string | null
  updatedAt: number
}

export type AutomationRunStatus = 'reserved' | 'completed' | 'failed' | 'skipped'

export interface AutomationRunRecord {
  id: string
  kind: AutomationKind
  status: AutomationRunStatus
  reason: string | null
  usageRecordId: number | null
  dayKey: string
  at: number
  finishedAt: number | null
  /** 行动级审计（Phase 7B）：runs 接口按 run 聚合返回；wake/solitude 运行才有 */
  actions?: AutomationActionRecord[]
}

export interface BudgetDecision {
  allowed: boolean
  reason: string | null
  reservationId: string | null
}

export type NotificationKind = 'proactive' | 'system' | 'wake' | 'task' | 'api-error' | 'mcp-error'

/** 通知偏好分类；分类开关只约束推送 / 主动打扰，不删除站内收件箱事实。 */
export type NotificationCategory =
  | 'proactive'
  | 'messageboard'
  | 'diary'
  | 'moment'
  | 'countdown'
  | 'listening'
  | 'wake'
  | 'task'
  | 'relationship'
  | 'call'

export interface NotificationCategoryPreferences {
  proactive: boolean
  messageboard: boolean
  diary: boolean
  moment: boolean
  countdown: boolean
  listening: boolean
  wake: boolean
  task: boolean
  relationship: boolean
  call: boolean
}

export interface NotificationPreferences {
  enabled: boolean
  quietHoursEnabled: boolean
  quietStart: string
  quietEnd: string
  categories: NotificationCategoryPreferences
  updatedAt: number
}

export interface NotificationRecord {
  id: string
  kind: NotificationKind
  title: string
  body: string
  metadata: Record<string, unknown>
  readAt: number | null
  createdAt: number
}

export interface SolitudeEntry {
  id: string
  body: string
  metadata: Record<string, unknown>
  createdAt: number
}

export interface EventLogRecord {
  id: number
  eventType: string
  dayKey: string
  hourKey: string
  metrics: Record<string, unknown>
  refId: string | null
  at: number
}

export type CallDirection = 'user' | 'companion'
export type CallStatus = 'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled'
export type CallSpeaker = 'user' | 'companion'

/** 服务端电话事实源；正文仍与当前聊天会话保持同一上下文。 */
export interface CallSessionRecord {
  id: string
  chatSessionId: string
  direction: CallDirection
  status: CallStatus
  createdAt: number
  answeredAt: number | null
  endedAt: number | null
  durationMs: number
  updatedAt: number
}

export interface CallTurnRecord {
  id: string
  callId: string
  sequence: number
  speaker: CallSpeaker
  text: string
  at: number
}

export type CallEvent =
  | { type: 'state'; call: CallSessionRecord }
  | { type: 'turn'; callId: string; turn: CallTurnRecord }

export interface WalletSummary {
  balance: number
  updatedAt: number
}

export interface WalletTransactionRecord {
  id: string
  delta: number
  balanceAfter: number
  reason: string
  refType: string | null
  refId: string | null
  createdAt: number
}

/* ---------- Phase 4 Life：价格、统计、通知与运行可视化 ---------- */

export interface PriceSnapshotRecord {
  id: string
  provider: string
  model: string
  promptCentsPerMillion: number
  completionCentsPerMillion: number
  validFrom: number
  createdAt: number
}

export interface LifeDaySummary {
  dayKey: string
  eventCount: number
  failedEventCount: number
  apiCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callDurationMs: number
  listeningDurationMs: number
  studyActivityCount: number
  countdownActivityCount: number
  bookmarkActivityCount: number
  wishlistActivityCount: number
  pricedCostCents: number
  unpricedCalls: number
}

/**
 * Life 当天的共同生活时间线项。它是 event_log 的可读投影，
 * 保留原始类型和 metrics 供详情/排障使用，但普通页面不直接展示对象。
 */
export interface LifeTimelineItem {
  id: string
  eventId: number
  eventType: string
  at: number
  source: string
  title: string
  detail: string | null
  refId: string | null
  metrics: Record<string, unknown>
}

export interface UsageBreakdown {
  key: string
  calls: number
  totalTokens: number
  pricedCostCents: number
  unpricedCalls: number
}

export interface LifeMonthSummary {
  month: string
  timeZone: string
  days: LifeDaySummary[]
  totals: Omit<LifeDaySummary, 'dayKey'>
}

export interface LifeLedgerView {
  summary: LifeMonthSummary
  byService: UsageBreakdown[]
  byModel: UsageBreakdown[]
  priceSnapshots: PriceSnapshotRecord[]
  wallet: WalletSummary
  walletTransactions: WalletTransactionRecord[]
}

export interface LifeRuntimeView {
  server: ServerHealth
  eventide: StateProviderHealth
  /** Life 只消费 UI payload，不下发 Eventide 往返 state 或隐藏状态卡。 */
  bodyState: { payload: Record<string, unknown>; settledAt: number } | null
  mcp: McpHealth
  automation: {
    policy: AutomationPolicy
    runtime: AutomationRuntimeState
    runs: AutomationRunRecord[]
  }
}

export interface PushStatus {
  supported: boolean
  configured: boolean
  publicKey: string | null
  subscriptionCount: number
  lastError: string | null
}

/* ---------- MCP 诊断日志（§7.2②「逐请求可回放」的查询侧） ---------- */

/** 'out' = Gateway→Server 请求；'in' = Server→Gateway 响应 / 通知 */
export type McpDiagnosticDirection = 'in' | 'out'

/**
 * 一条诊断记录（`mcp_diagnostic_log` 的下发视图）。
 * 表里的原始字段原样下发：这是**排障用的证据**，不该在这里做二次解释，
 * 否则「页面上看到的原因」和「库里存的原因」可能对不上。
 */
export interface McpDiagnosticEntry {
  id: number
  serverId: string
  direction: McpDiagnosticDirection
  /** 协议方法或阶段标记：initialize / tools/list / tools/call … */
  method: string
  httpStatus: number | null
  /** 是否属于握手阶段（initialize 及其响应） */
  handshake: boolean
  latencyMs: number | null
  error: string | null
  at: number
}

/**
 * 诊断查询条件 —— 全部可选，语义是「不提就不筛」。
 * `handshake` 用三态表达：`undefined` = 全部，`true` = 只看握手，`false` = 只看工具调用。
 */
export interface McpDiagnosticQuery {
  serverId?: string
  handshake?: boolean
  errorsOnly?: boolean
  /** 每页条数，默认 50，上限 200 */
  limit?: number
  /** 游标：只取 id 小于它的（即更早的记录） */
  before?: number
}

export interface McpDiagnosticPage {
  /** 按 id 倒序（最新在前） */
  entries: McpDiagnosticEntry[]
  /** 满足筛选条件的**总条数**（不含游标，所以翻页时不会越翻越小） */
  total: number
  /** 其中带 error 的条数 */
  errorCount: number
  /** 还有更早的记录：把最后一条的 `id` 当下一轮的 `before` */
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Phase 7A · Prompt / 世界书（SPEC §9.4）
// ---------------------------------------------------------------------------

/** 世界书注入模式：always = 恒定注入；keyword = 命中最近对话才注入 */
export type WorldbookMode = 'always' | 'keyword'

/**
 * 世界书条目。**服务端权威**（Runtime 在服务端拼上下文），前端只是管理 UI；
 * 不进 web 备份格式 —— 服务端数据由服务端自己的备份负责。
 */
export interface WorldbookEntry {
  id: string
  title: string
  content: string
  keys: string[]
  mode: WorldbookMode
  enabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** Prompt 查看块（SPEC §9.4.3）：builtin = 内置只读；custom = 自定义可编辑 */
export interface PromptViewBlock {
  /** 注入时的 system 块名 */
  name: string
  label: string
  source: 'builtin' | 'custom'
  content: string
}

/** 「本轮 Prompt 查看」响应：persona 单独给（设置页编辑器要用），blocks 按注入顺序 */
export interface PromptView {
  persona: { content: string; customized: boolean }
  blocks: PromptViewBlock[]
}

/** Eventide 历史快照点（状态页趋势 / 最近变化用；payload 为上游自定的结构化状态） */
export interface EventideHistoryPoint {
  settledAt: number
  payload: Record<string, unknown>
}
