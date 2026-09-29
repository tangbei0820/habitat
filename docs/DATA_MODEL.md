# DATA_MODEL · 数据模型

> **权威关系**：产品行为以 `docs/PRODUCT_SPEC.md` 为准 ｜ 实体设计与归属以《栖息地初版技术方案分析.md》§6 为准 ｜
> 本文件记录**落地的实现口径**（字段、索引、约束、归属），是前两者的落地层。
> 不复制 SPEC 的交互定义，也不改技术方案的架构决策。
> 最后更新：2026-09-28

---

## 0. 怎么用

改数据前按这个顺序走，别跳步：

1. 读 `PRODUCT_SPEC.md` 对应章节 —— 先确认**目标行为**
2. 读本文件的字段表 —— 确认改哪个实体、影响哪些已有数据
3. 改 `shared/types.ts`（前后端共享的唯一权威定义）
4. 改 Dexie：**新增 `version(n+1)`，历史版本声明只增不改**（铁律 5，float-phone 丢数据的教训）
5. 若动的是服务端表：Drizzle schema + 「缺则补」的 `ALTER` 演进

## 1. 归属总表

| 数据 | 存放 | 写入方 |
|---|---|---|
| 聊天记录、Home 十类生活数据 | **前端 Dexie**（IndexedDB） | `web/src/db/*` 仓储层 |
| LLM 方案与凭据、用量账本、MCP 诊断日志、Eventide 当前状态 | **服务端 SQLite** | `server/src/db/*` |

两条边界不可越：**铁律 3** 前端不直连 LLM / Nocturne / Eventide；**铁律 4** 记忆只走 MCP 单通道。
页面**不直接碰 Dexie**，一律经仓储层 —— 读写口径只有一处，日后加分页 / 导出 / 迁移才不用回头改页面。

## 2. 统一基座（技术方案 §6.1）

```ts
interface BaseObject {
  id: string
  type: string            // 字符串判别：'chat-message' | 'diary' | …
  createdAt: number
  updatedAt: number
  sourceId?: string       // 来源对象 id
  sessionId?: string      // 来源会话 id
  metadata?: Record<string, unknown>
}
```

`sourceId` / `sessionId` 是**跨模块引用的骨架**（PRODUCT_SPEC §4）。收藏、作品、相册要「跳回原处」全靠它 ——
**任何新实体都不要另发明一套来源字段**，否则跨模块联动会长出四套互不认识的引用方式。

### 2.1 RelationshipState / RelationshipRecoveryRequest（服务端 SQLite）

关系暂停不修改或删除 `ChatMessage`，服务端 SQLite 是唯一事实源：

| 表 | 关键字段 | 说明 |
|---|---|---|
| `relationship_state` | 固定 `id='relationship-main'`、`status`、`paused_by`、`reason`、`started_at`、`expires_at`、`updated_at` | 当前关系快照；暂停时 `expires_at` 最多距开始 60 分钟，读取时惰性自动恢复 |
| `relationship_request` | `id`、`requested_by`、`decider`、`status`、`created_at`、`decided_at` | 恢复申请审计；`pending / approved / denied / expired` 终态均保留，重复 pending 申请复用原记录 |

关系事件（拍一拍、暂停、申请、决定、自动恢复）追加到 `event_log`，因此可以被 Life 时间线追溯；通知收件箱只保存系统 / 主动提示，不承担状态读取。前端聊天时间线中的用户侧关系卡是本地 `role='system'` 消息，带 `metadata.relationshipEvent`，历史组装时排除，避免关系事件伪装成模型需要回答的文本。

## 3. Chat

### 3.1 ChatSession（本地表 `sessions`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | `string` | 首条消息自动取名（截 18 字） |
| `pinnedAt` | `number \| null` | **置顶 = 时间戳而非布尔**（技术方案 §6.2），排序按它降序 |
| `groupId` | `string \| null` | 所属分组；`null` = 未分组。**置顶不改写它**（见 3.5） |
| `remark` | `string \| null` | 会话备注（SPEC §2.2.1 聊天设置） |
| `background` | `string \| null` | 会话背景 |
| `bubbleMode` | `'chat' \| 'native'` | 气泡模式 |
| `archivedAt` | `number \| null` | 归档（尚无 UI 生产者） |

索引：`id, updatedAt, pinnedAt, archivedAt, groupId`

`ChatSession.metadata.contextCompression`（V2-B）保存上下文摘要版本链与当前启用版本：摘要覆盖的首尾消息 id / 时间、生成模型与时间、正文、编辑来源。它不新增索引或表，随 `sessions` 一起进入现有备份；原始 `messages` 永不因压缩删除。

### 3.2 ChatMessage（本地表 `messages`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `string` | 所属会话 |
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | 消息角色 |
| `status` | `'pending' \| 'streaming' \| 'done' \| 'error' \| 'aborted'` | 流式草稿 → 收尾定性 |
| `replyToId` | `string \| null` | 回复的目标消息 |
| `blocks` | `MessageBlock[]` | **当前展示版本的投影**（渲染与历史组装都读它） |
| `versionOf` | `string \| null` | 版本关系（预留给「同一条消息的多条记录」形态） |
| `candidates` | `MessageCandidate[]` | 版本链，见 3.3 |
| `recalledAt` | `number \| null` | 非空 = 已撤回（见 3.4） |
| `editedAt` | `number \| null` | 最后一次编辑时间（见 3.4） |

索引：`id, sessionId, createdAt, [sessionId+createdAt+id]`

`metadata.reasoning` 存思维链，落库前经 `capReasoning()`（上限 32 000 字符，超限保留头尾）。

`blocks` 的载荷按 kind 走可辨识联合（`shared/types.ts`）。两条与落库有关的约定：

- **`audio` 块**（语音条，SPEC §2.4.4）与相册图片同款处理：音频以**内联 data URL** 存进
  `payload.url`，`payload.durationMs` 存实测时长。选内联而不是 Blob / 对象 URL，
  是为了让 IndexedDB 与 JSON 备份都能原样恢复（铁律 5）。代价是备份体积——
  单条上限 60 秒、实测约 80 kbps，60 秒约 600 KB，base64 再涨约 33%（已记入 `TASKS.md` 待优化）。
- **`messageText()` 只取 `text` 块**，所以语音条没有「纯文本投影」。
  会话列表预览、版本登记、**对话上下文组装**都读它，因此语音条默认不会进上下文。
  T-019 给 `historyUpTo()` 开了一个**只针对语音条**的口子：补一句 `[语音条 0:03]` 占位，
  让模型知道「用户发了一条语音」（否则它会对着空白答话）。
  **这不是把非文本块放进上下文的通用规则**，图片 / 文件仍是跳过的既有行为。
- **`tool-result` 块**（Phase 6.5 扩充）：`payload` 增加两个**可选**展示字段
  `source`（如 `Nocturne`）与 `label`（如 `搜索记忆`），卡片据此显示「✅ Nocturne · 搜索记忆」，
  而不是把内部工具名 `memory_search` 摆给用户看。旧数据没有这两个字段 → 渲染回退成
  `工具 {toolName}`，**无需迁移、Dexie 不升版本**（纯字段追加，不是索引变化）。

**AI 自主工具调用的消息形态（P0）**：一轮 AI 回复里若发生工具调用，工具卡与正文落在
同一条助手消息的 `blocks` 中，按 `order` 保留「正文 → 工具 → 后续正文」的真实顺序；
只有 Mini Terminal 的手动调用仍使用独立 `role='tool'` 消息。两条约定：

- 它是**系统的既成事实**，不是可选装饰 —— 落库失败会记日志，但不会让已生成的回复作废。
- 卡片落库失败会记日志，但不会让已生成的回复作废；刷新后同一条助手消息仍可恢复工具卡顺序。

### 3.3 MessageCandidate —— 唯一的版本链（技术方案 §6.3）

```ts
interface MessageCandidate {
  content: string
  origin: 'edit' | 'reroll'
  selected: boolean
}
```

**一条消息只有一套版本历史**：「换一个」（`reroll`）与「编辑」（`edit`）都往这条链上追加，
界面共用同一个 `‹ n/N ›` 导航（SPEC §2.3.4 明确要求「不另发明第二套历史」）。

三条硬约束：

1. **首次追加时把当前正文也登记成一条版本** —— 否则替换之后无从切回，而用户点「换一个」时最常见的念头恰恰是「还是刚才那个好」。
2. **`blocks` 必须与 `selected` 的那条候选同步**。两者一旦分家，就会出现「屏幕上看到的」和「下一轮送出去的」不是同一段话。
3. **上限 `MAX_CANDIDATES = 8`，淘汰最旧的未选中项** —— 绝不淘汰刚选中的那个，否则 `n/N` 里会出现一个屏幕上正显示、却找不到对应条目的版本。

### 3.4 编辑与撤回的落库口径（SPEC §2.3.4 / §2.3.5）

| 动作 | 落库口径 |
|---|---|
| **编辑** | 旧正文进 `candidates`（`origin: 'edit'`），新正文成为 `blocks` 与选中候选；同时写 `editedAt` |
| **撤回** | 只写 `recalledAt`。**正文与版本链原样保留** —— 既为了可恢复，也因为界面痕迹需要它 |
| **恢复撤回** | `recalledAt` 置回 `null`，正文照旧（不需要动任何内容字段） |
| **删除** | 物理移除该行，**不留痕、不回收站**，数据兜底交给导出 / 备份 |

**撤回不进模型上下文**：落点是**上下文组装**（`historyUpTo`），而不是 `messageText()` ——
后者是「取纯文本投影」，与「这段该不该送出去」是两件事。混在一起会让所有复用它的地方
（列表预览、版本登记）都被动地跟着改行为。

内容未变时编辑**不新增版本** —— 否则 `‹ n/N ›` 里会出现两条一模一样的。

### 3.5 会话分组（本地表 `sessionGroups`，SPEC §2.1.3）

```ts
interface SessionGroup extends BaseObject {
  type: 'session-group'
  name: string
  collapsed: boolean
}
```

索引：`id, createdAt`

| 动作 | 落库口径 |
|---|---|
| **创建** | 名称 trim 后非空、上限 30 字（分区标题只有一行）；`collapsed` 默认 `false` |
| **重命名** | 改 `name` 并更新 `updatedAt`（分组本身就是被编辑的对象） |
| **折叠 / 展开** | 只改 `collapsed`，**不动 `updatedAt`** —— 它不算「分组被编辑过」 |
| **删除分组** | 同一事务内把组内会话的 `groupId` 置回 `null`，再删分组行。**只删分区，不删会话**（返回被移出的条数，供确认语说明影响） |
| **会话移入 / 移出** | 只改会话的 `groupId`，**不刷新 `updatedAt`** —— 换分区不代表这段对话又活跃了 |
| **置顶** | 只改 `pinnedAt`，**`groupId` 原样不动**（SPEC §2.1.2：置顶是显示上的浮动，取消后回落到原分组） |

**置顶与分组的优先级**：置顶**优先于分组**，置顶会话在列表最顶单独成区、脱离原分组显示；
列表分区顺序为「置顶区 → 各分组（创建顺序）→ 未分组区」。

**未分组区是兜底区**：`groupId` 为 `null`、**或指向已不存在的分组**的会话都渲染在这里。
写入侧（`setSessionGroup` / `deleteSessionGroup`）已保证不会产生悬空引用，但导入的备份与手工改过的库不受我们控制 ——
兜底放在**渲染**层，任何新的读取点都不会因为「这条会话哪个分区都不属于」而把它漏掉。

## 4. Home 生活实体

原本十类，**2026-09-24 起只剩八类在本地** —— `Moment`（留言板）与 `Diary`（日记）
已迁到服务端 SQLite（理由与字段见 §11）。剩下这八类仍住 Dexie：

| 实体 | 表 | 关键字段 |
|---|---|---|
| `WishlistItem` | `wishlist` | `title`, `status: 'open' \| 'done' \| 'paused' \| 'abandoned'`, `completedAt`, `author`, `targetDate`, `statusChangedAt`, `statusReason`, `progress[]` |
| `CountdownDay` | `countdowns` | `title`, `targetDate`（本地 `YYYY-MM-DD`）, `category`, `repeat`, `reminder` |
| `Bookmark` | `bookmarks` | `targetType`, `targetId`, `title`, `note`, `categoryId`, `tags[]` |
| `Artwork` | `artworks` | `title`, `category`, `description`, `externalUrl` |
| `Photo` | `photos` | `title`, `caption`, `imageDataUrl`, `mimeType`, `sizeBytes`, `takenAt`, `collectionId` |
| `ReadingNote` | `readingNotes` | `bookTitle`, `author`, `status`, `note`；TXT / PDF / EPUB 共读书籍的 `BaseObject.metadata.reader` 保存本机提取后的段落正文、格式、当前段落、书签、阅读秒数、阅读外观（字体 / 主题）、用户 / 小栖的文本锚点批注与生词（不新增平行书库表）；批注收藏复用 `Bookmark(targetType=reading-annotation)` |

聊天 Runtime 的 `readingCatalog` 是一次请求内的临时投影，不是新表：浏览器从上述 `ReadingNote` 裁出当前段落附近窗口、批注与生词，服务端仅用于 `reading_context` / `reading_status` / `reading_read` / `reading_advance` / `reading_annotate` / `reading_vocabulary` / `reading_activity` 校验与回灌。`reading_status` 只读取本轮目录里的进度、书签、累计时长与窗口边界；`reading_activity` 只读取本轮目录里的最近批注 / 生词，不建立独立活动表，也不声称覆盖完整历史。小栖翻页仍写回 `currentParagraph`，批注 / 生词仍写回原 `ReadingBookState.annotations` / `vocabulary`，因此不新增 Dexie 版本、备份字段或服务端书库。
| `DailyReadingEntry` | `dailyReadings` | `sourceBookId`, `paragraphIndex`, `bookTitle`, `author`, `text`；每日品读历史只保存片段快照与原书锚点，批注继续写回 `ReadingBookState.annotations`；主屏 `daily-reading` Widget 只引用其 `id` |
| `MusicTrack` | `musicTracks` | `title`, `artist`, `note`, `externalUrl` |
| `ListeningSessionView` | 服务端 `app_kv:listening.session.main` + `app_kv:listening.queue.main` | 当前曲目最小快照、`state`, `positionSeconds`, `startedAt`, `listeners`, 最多 50 首队列；不复制音乐库 |
| `ListeningHistoryItem` | 服务端 `event_log` 的播放事实投影 | `trackId`, `title`, `artist`, `totalSeconds`, `playCount`, `lastPlayedAt`；按轨道聚合，不复制音乐库 |
| `ListeningComment` | 服务端 `event_log` 的 `listening.comment.created` 事实 | 曲目快照、作者 `user|companion`、正文与时间；不改写 `MusicTrack`，按曲目回放 |
| `StudyRecord` | `studyRecords` | `subject`, `note`, `studiedOn`, `durationMinutes` |
| `StudyCard` | `studyCards` | `subject`, `front`, `back`, `example`, `hint`, `dueOn`, `intervalDays`, `ease`, `repetitions`；默认按 `dueOn <= 本地今天` 进入到期队列 |
| `StudyMaterial` | `studyMaterials` | `subject`, `title`, `kind=text|link`；文字资料保存受限正文，链接只保存安全的 `http(s)` 地址，卡片生成可选择文字资料作为上下文 |
| `Sticker` | `stickers` | `name`, `imageDataUrl`, `mimeType`, `sizeBytes`, `category`, `tags`, `source`；消息发送时另存快照，删除图库条目不影响历史 |

另有**两张分类表**（不是生活数据本身，是收纳容器）：

| 实体 | 表 | 关键字段 | 依据 |
|---|---|---|---|
| `BookmarkCategory` | `bookmarkCategories` | `name`（≤30 字） | SPEC §3.5.4 |
| `PhotoCollection` | `photoCollections` | `name`（≤30 字） | SPEC §3.7.3 |

两张表**结构同构但各自独立**：分类数据本来就是各模块独立的（收藏的分类不出现在相册的筛选条里），
合并成一张带 `scope` 的表只会多一个分支，省不下真正不同的那部分（从属表与归属字段名都不一样）。
⚠️ `BookmarkCategory` 与 `ArtworkCategory` 名字相近但不是一回事：后者是作品内建的四种类型
（字面量联合，不可增删），前者是可以随时新建 / 改名 / 删除的实体。

约定：

- **分类是单归属**：`categoryId` / `collectionId` 为 `null` 即「未分类」；一个条目最多属于一个分类。
  多维度标记交给后续的**标签**，不让分类兼任（SPEC §3.5.4 / §3.7.3）。
- **归属字段一定有值**：老数据在迁移里补 `null`，导入的旧备份也在导入时补 `null` —— 不留 `undefined`。
- **未分类是兜底区**：`null` 与「指向已不存在分类」的脏引用都归到未分类（同会话分组的做法）。
- **纯日期一律存本地字符串**（`YYYY-MM-DD`），避免纯日期被时区偏移成前一天。
- **时长统一存分钟**，展示层不再反复换算。
- 未接入富文本沙箱前，正文一律**纯文本**，不引入 HTML 旁路。

## 5. 跨模块引用契约（SPEC §4）

| 关系 | 载体 | 约束 |
|---|---|---|
| 收藏 → 任意内容 | `Bookmark.targetType + targetId` | 唯一复合索引 `&[targetType+targetId]` **从数据层**阻止同一目标重复收藏 |
| 留言收藏 → 原留言 | `Bookmark.targetType='moment'` + `sourceId` + `metadata.source*` | 保存作者、创建时间与正文快照；编辑原留言不回写既有收藏；来源链接回 `/home/board#<id>` |
| 作品 → 来源内容 | `BaseObject.sourceId` / `sessionId` | 本体尽量**引用原始对象**，必要时存稳定快照（SPEC §3.6.3） |
| 相册 → 来源消息 | `BaseObject.sourceId` / `sessionId` | 保留原图 + 来源 + 时间 + 发送方 / 生成方（SPEC §4.4） |
| 主屏 Widget → 被展示内容 | `HomeWidget.kind` + `refId` / `boardScope`（本地表 `homeWidgets`） | **只存引用、不复制数据**（SPEC §1.4）；留言板 `boardScope` 可指向 recent / group / moment；每日品读 `refId` 指向 `DailyReadingEntry.id`；唯一索引 `&kind` 从数据层保证**每种 Widget 至多一条**；`sortOrder` 只负责展示顺序；引用失效时渲染层不渲染，删实体时同事务清引用 |
| 收藏 → 分类 | `Bookmark.categoryId`（本地表 `bookmarkCategories`） | 单归属；删分类**不删收藏**，同事务把类内 `categoryId` 置 `null`（SPEC §3.5.4） |
| 照片 → 相册 | `Photo.collectionId`（本地表 `photoCollections`） | 单归属；删相册**不删照片**，同事务把册内 `collectionId` 置 `null`（SPEC §3.7.3）。⚠️ 「移出相册」只置空归属，与「删除照片」是两件事 |

`BookmarkTargetType` 的合法取值集中在 `shared/types.ts`。新增来源类型时**只加这一个枚举**，
`Bookmark` 表结构不动 —— 这正是选 `targetType + targetId` 而不是给每类内容建关联表的原因。

## 6. P0 待新增（方向已定，尚未落库）

| 项 | 改动 | 依据 |
|---|---|---|
| ~~会话分组~~ | ✅ 已落地（T-018）；P0 追加 `SessionGroup.sortOrder`、Dexie v21 与上下调序入口 | SPEC §2.1.3 |
| 日记权限模型 | ✅ **已落地（T-036 / T-037 / T-068）**：服务端权威、整篇请求 / AI 决策、片段级 `fragment_visibility_json` 覆盖与安全过滤 | SPEC §3.4 / §6.3 |
| 作品来源引用 | 复用基座的 `sourceId` / `sessionId`，**不新增字段**；聊天来源已落地（T-016） | SPEC §3.6.3 |
| 相册来源引用 | 同上；聊天图片来源与 block 位置已落地（T-016）；自动收集沿用同一稳定键，来源元数据可标记 `sourceImageOrigin=generated` | SPEC §3.7.2 |

相册“自动收集聊天图片”是本机偏好，不是照片实体字段：三个来源开关（用户发送 / AI 发送 / AI 生成）保存在前端 `localStorage`，默认关闭，既不进 Dexie 备份也不上送服务端。开启后只处理新消息；关闭不会删除已收照片。自动与手动入口都调用同一个 `createMessagePhotos()`，所以仍以 `message.id + image block.order` 去重。

> 日记的「AI 决定允许 / 拒绝查看」与片段级开放已经接入服务端能力注册表；后续只补更细的片段请求与富媒体锚点，不再把当前能力标成占位。

## 7. 迁移现状（Dexie）

| 版本 | IndexedDB 版本 | 内容 |
|---|---|---|
| v1 | 10 | `sessions` / `messages` 基础索引 |
| v2 | 20 | `messages` 补 `[sessionId+createdAt]`（长会话按时间分页） |
| v3 | 30 | 游标换 `[sessionId+createdAt+id]` —— createdAt 撞毫秒不漏条 |
| v4 | 40 | 留言 / 愿望 / 倒数日（Phase 2 第一批） |
| v5 | 50 | 日记 / 统一收藏（第二批） |
| v6 | 60 | 作品 / 相册（第三批） |
| v7 | 70 | 读书 / 音乐 / 学习（第四批） |
| v8 | 80 | `sessions` 加 `groupId` 索引 + `sessionGroups` 表（会话分组，T-018）。**本版是首个带 `upgrade()` 回调的迁移**：给所有老会话补 `groupId: null` |
| v9 | 90 | 新增 `homeWidgets` 表（主屏 Widget，T-020）。纯新增表，**不需要 `upgrade()` 回调** —— 它对留言板 / 倒数日只是多了一条引用，没动那两张表的任何字段。`&kind` 是唯一索引 |
| v10 | 100 | `bookmarks` 加 `categoryId` 索引 + `bookmarkCategories` 表；`photos` 加 `collectionId` 索引 + `photoCollections` 表（收藏分类与相册，T-021）。**带 `upgrade()` 回调**：给老收藏补 `categoryId: null`、老照片补 `collectionId: null`（同 v8 的理由 —— 不让「归属字段一定有值」只活在读取方的记忆里） |
| v11 | 110 | 新增中转表 `legacyUploads`（日记与留言板迁往服务端，T-036）。⚠️ **本版刻意不带 `upgrade()` 回调**，见下方「v11 为什么不用 upgrade」 |
| v12 | 120 | 新增 `listenSessions` / `studyTasks`（一起听时长与学习今日任务，T-046）；纯新增表，不需要 `upgrade()` 回调 |
| v13 | 130 | 新增 `studyCards`（AI 伴学卡片与本地复习状态，T-063）；生成走服务端 `/api/study/cards/generate`，纯新增表，不需要 `upgrade()` 回调 |
| v14 | 140 | 新增 `stickers`（本地表情图库，T-077）；消息块保存发送时快照，纯新增表，不需要 `upgrade()` 回调 |
| v15 | 150 | `CountdownDay` 补 `category` / `repeat` / `reminder`（T-100）；保留原日期索引，upgrade 为老记录补 `other` / `none` / `none` |
| v16 | 160 | `WishlistItem` 补作者、目标日期、暂停 / 放弃状态、状态原因与嵌套进展（T-102）；upgrade 为老记录补默认值 |
| v17 | 170 | `Bookmark` 补 `tags[]` 多维标签（T-104）；upgrade 为老收藏补空数组，不新增索引 |
| v18 | 180 | `HomeWidget` 补 `boardScope`（T-108）；老留言板 Widget 迁移为 `{kind:'recent'}`，倒数日明确写 `null` |
| v19 | 190 | 新增 `studyMaterials`（T-116）；保存本地 TXT / Markdown 文字资料与安全 `http(s)` 链接，纯新增表，不需要 `upgrade()` 回调 |
| v20 | 200 | 每日品读历史 `dailyReadings`（T-120）；保存片段快照与来源锚点 |
| v21 | 210 | `SessionGroup.sortOrder`（P0）；老分组按创建顺序补顺位 |
| v22 | 220 | `HomeWidget.sortOrder`（T-126）；老 Widget 按创建顺序补顺位，主屏支持可访问上下调序 |

Dexie 把声明版本 ×10 作为 IndexedDB 版本号，验收脚本据此刻画版本（`verify-chat.mjs`）。
**每次升版都要在 `db.ts` 的版本注释里写清「为什么」**；只写「加了张表」等于没写。

### v11 为什么不用 `upgrade()`（一个容易反着猜的地方）

**Dexie 的 `stores()` 是跨版本累加的，删表删不掉。**
源码 `Version.prototype.stores` 里是一句 `extend(storesSpec, version._cfg.storesSource)` ——
它把 v1..vn **所有**版本的声明合并成一份 schema，后面的 `deleteRemovedTables()` 也只认这份合并结果。
⇒ **「新版本不声明某张表」不等于删掉它**：只要某个历史版本声明过，表壳就一直在
（升级事务末尾的 `createMissingTables` 甚至会把缺的表再建回来）。
实测：升级到 v11 后 `diaries` / `moments` 两张表仍在库里，里面的数据也还在。

于是 v11 不再假装「删表」：
- `diaries` / `moments` 的**表壳永久存在**（空壳）。别再去"清理"它 —— 清不掉。
- `db.diaries` / `db.moments` 这类入口在类型层面**刻意不再暴露**；搬迁代码用 `db.table('diaries')`
  字符串取表，这是明确的「我知道表还在，但它不该再当活表用」。
- 搬迁**不挂 `upgrade()`，挂在启动期**（`web/src/db/legacy-upload.ts`）。
  理由：既然旧表删不掉、旧数据本来就一直在，那升级回调就不是"最后一个安全时机"，
  而它**一辈子只跑一次** —— 那次没搬干净（当时离线 / 浏览器中途关掉 / 跑的是还没写搬迁逻辑的旧构建）
  就再没有第二次机会。挂启动期则**每次启动都收敛**：表里还剩什么就搬什么。

> ⚠️ v8 为什么用 `upgrade()` 补字段，而不是「读的时候把 `undefined` 当 `null` 容忍」：
> 后者会让「会话一定有 `groupId`」这条不变量只存在于**读取方的记忆**里，
> 任何忘记兜底的新读取点都会让会话从列表里凭空消失。字段补齐放在迁移里，只写一次、对所有人成立。

**每次加表 / 加字段都要同步 `web/src/lib/backup.ts` 的备份格式版本**（铁律 5），否则导出会漏表：
备份格式与 Dexie 版本并非同一套编号，各自演进，但**必须同一次任务里一起改**。

| 备份格式 | 对应内容 |
|---|---|
| v1–v2 | 聊天 |
| v3 | + 日记 / 收藏 |
| v4 | + 作品 / 相册 |
| v5 | + 读书 / 音乐 / 学习 |
| v6 | + 会话分组（T-018）；旧版导入时分组按空处理，会话 `groupId` 补成 `null` |
| v7 | + 主屏 Widget（T-020）；旧版导入时主屏回到「一张 Widget 都没有」 |
| v8 | + 收藏分类与相册（T-021）；旧版导入时两张分类表按空处理，收藏 `categoryId` / 照片 `collectionId` 补成 `null`（落进「未分类」） |
| v9 | **− 日记 / 留言板**（T-036）：它们已归服务端，而这份备份的语义始终是「本地那张库的快照」，且必须**离线也能导出** —— 从服务端拉会让它变成「一半离线一半在线」，在最需要它的时候最不可靠。⚠️ 旧备份（v2–v8）里这两块**不丢**：导入时转存进 `legacyUploads` 中转表，由启动流程 / 导入流程上传到服务端，并按 `legacyDiaries` / `legacyMoments` 报数 |
| v10 | + 一起听时长 `listenSessions` / 学习任务 `studyTasks`（T-046，随 Dexie v12 补进备份白名单）；旧版导入时两张表按空处理 —— 那时这两个功能还不存在 |
| v11 | + AI 伴学卡片 `studyCards`（本地复习状态；生成调用走服务端 `/api/study/cards/generate`）；旧版导入时按空处理 |
| v12 | + 本地表情图库 `stickers`；旧版导入时按空处理，历史消息不依赖图库条目 |
| v13 | 倒数日补分类、每年重复与提醒字段；旧版导入时为缺失字段补默认值 |
| v14 | 愿望清单补作者、目标日期、暂停 / 放弃状态、状态原因与嵌套进展；旧版导入时补 `author=user`、空目标日 / 原因 / 进展 |
| v15 | 收藏补 `tags[]` 多维标签；旧版导入时补空数组，标签不改变分类的单归属语义 |
| v16 | `HomeWidget` 补 `boardScope`（T-108）；旧版导入时留言板范围回退为 `recent`，倒数日范围为 `null` |
| v17 | + 学习资料 `studyMaterials`（T-116）；旧版导入时按空处理，链接不在导入阶段抓取远程内容 |
| v18 | + 每日品读历史 `dailyReadings`（T-120）；旧版导入时按空处理 |
| v19 | + 会话分组顺序与兼容字段（P0） |
| v20 | + 主屏 Widget `sortOrder`（T-126）；旧版备份按 `createdAt` 顺序兼容 |
> ⚠️ v7 导入时**必须按 `kind` 去重**：`&kind` 是唯一索引，手改过的备份（例如两条 `board`）会让
> `bulkAdd` 抛 `ConstraintError`，导致**整份备份一个字都导不进去**。保留 `createdAt` 最早的那条，
> 与「先上主屏的在前」的排序语义一致。

> **P1 第一批（T-019，输入区快捷栏 + 请求回复拆开 + 语音条）零 schema 改动** ——
> `sessionGroups` 与 Dexie v8 保持不动，备份格式也停在 v6。原因：
> ①「待回复」由消息序列推导（末尾连续的 `user` 消息），不落字段；
> ② 语音条复用 `audio` 块，载荷契约早就定好了；
> ③ 表情 / 更多功能都只是往输入框写文本。
> 这一条值得记下来：**「能不能不加字段」应当先问一遍**，因为每加一个字段都要连带一次 Dexie 升版
> 加一次备份升版，而两份版本号还得在同一个任务里一起改。

## 8. Eventide 状态（服务端表 `body_state_snapshot`）

Phase 3B 切片一落地。单人格阶段固定使用 `id='primary'` 的一行：

| 字段 | 类型 | 说明 |
|---|---|---|
| `state_json` | JSON 文本 | Eventide 自己的可往返状态；habitat 不解析、不复制上游内部字段定义 |
| `state_card` | 文本 / null | `<ephemeral_state>` 隐藏状态卡，后续进入聊天上下文 |
| `payload` | JSON 文本 | 给未来 UI 使用的结构化七项状态，不从状态卡反解析 |
| `settled_at` | 毫秒时间戳 | 本快照推进到哪个时刻 |
| `updated_at` | 毫秒时间戳 | SQLite 行最后写入时间 |

**持久化归 Node、计算归 Python**：`eventide-sidecar` 每次接收旧 state 并返回新 state，自身不落用户数据；
Node 收到完整成功响应后才覆盖这行。sidecar 重启不会丢周期进度，上游内部 schema 变化也只影响它自己的
`load_state` / `dump_state`，不会扩散成 habitat 的字段迁移。

## 9. Phase 3B 主动行为（服务端 SQLite）

| 表 | 权威内容 | 关键不变量 |
|---|---|---|
| `automation_policy` | 总开关、分功能开关、时区、时间窗、静默 / 冷却 / 次数 / Token / 费用上限、触发词、梦种 | 单用户固定 `primary`；默认全部主动功能关闭 |
| `automation_state` | 最后用户互动、最后唤醒、连续未回复、每日独处 / 梦境标记 | **不保存聊天正文**；用户发言原子清零未回复计数 |
| `automation_run` | BudgetGuard 预约与结果 | LLM 调用前先写 `reserved`；并发检查把未完成预约一起计入预算 |
| `event_log` | 状态 / 主动行为事实 | Phase 4 统计只聚合此表，不反查聊天库 |
| `notification` | 主动唤醒与系统通知 | 主动消息先进收件箱，不直接写前端 Dexie |
| `app_kv:notification.preferences` | 通知总开关、分类开关、Quiet Hours | 只影响 Push / 主动打扰；不删除、不覆盖 `notification` 事实 |
| `solitude_entry` | AI 私有独处记录与梦卡 | 与通知、用户日记分库；梦卡用 metadata 标识 |
| `wallet` | 当前余额缓存 | 只能与流水在同一事务更新，余额不得小于 0 |
| `wallet_transaction` | 不可变钱包流水 | 每次变化保留 delta、变化后余额、原因与可选来源引用 |

费用预算读取 `usage_record.cost`。存在 `cost=null` 的调用就视为“费用不可计算”；若用户启用了费用上限，
BudgetGuard 会安全拒绝后续调用，而不是按 0 元放行。

## 10. Phase 4 Life（服务端 SQLite）

| 表 / 字段 | 权威内容 | 关键不变量 |
|---|---|---|
| `price_snapshot` | provider + model 的输入 / 输出每百万 Token 分价、生效时间 | **只追加**；同一有效期以后创建的版本供新调用采用 |
| `usage_record.price_snapshot_id` | 本次费用采用的价格版本 | null = 未定价；一旦绑定不因以后改价重算 |
| `push_subscription` | 浏览器 endpoint 与协议密钥、最近成功 / 错误 | 失效 endpoint（404/410）自动删除；推送失败不删除站内通知 |

Life 月历与账本是查询模型，不复制事实表：月历按 `event_log.day_key` + `usage_record.day_key` 聚合；钱包仍读
`wallet` / `wallet_transaction`；运行页聚合现有健康端点、`body_state_snapshot` 与 `automation_*`。
价格快照新增后只回填 `price_snapshot_id IS NULL` 且调用时间在有效期内的记录。历史方案若已删除，已有费用仍按
`profile_id` 与绑定快照保留；无法识别 provider 的老未定价记录继续明确显示未定价，不猜测归属。

## 11. Phase 6.5 共同生活数据（服务端 SQLite，T-036）

从 Dexie 迁入的两张表。**搬家的唯一理由**：AI 跑在服务端，而
「AI 写日记」「用户请求查看某篇」「AI 决定放不放」这三件事都只能发生在服务端 ——
数据留在浏览器里，AI 就只能对着假数据演戏（SPEC §6.3 明令禁止）。

| 表 | 字段 | 关键不变量 |
|---|---|---|
| `diary` | `id` / `title` / `content` / `entry_date` / `author` / `visibility` / `fragment_visibility_json` / `created_at` / `updated_at` | `author` **就是权限位**：`user` 的日记用户可自由读写删；`companion` 默认私密。`fragment_visibility_json` 只保存 `fragment-N -> open/locked` 覆盖，缺省继承整篇权限；**正文过滤只走 `db/diary.ts` 的 `toDiaryView()` 这一个出口** |
| `moment` | `id` / `content` / `author` / `channel` / `group_id` / `created_at` / `updated_at` | 无可见性概念（写出来就是给人看的），只有「谁能删」：用户只能删自己的；`channel=board|feed` 分离留言板与朋友圈；`group_id` 只对留言板有意义 |
| `moment_group` | `id` / `name` / `created_at` / `updated_at` | 名称唯一；只是整理容器，删除分组只把留言移回未分组，不删除留言或收藏快照 |
| `moment_comment` | `id` / `moment_id` / `parent_id` / `content` / `author` / `created_at` / `updated_at` | 只允许挂在 `channel=feed` 的动态上；用户可改 / 删自己的回应，删除父回应级联删除子回应；创建追加 Life 事实 |

字段约定：

- `author`：`'user' | 'companion'`（`ContentAuthor`）。**不设第二套 role 字段** —— 作者位与权限位是同一件事。
- `visibility`：`'private' | 'open' | 'locked'`。三态是**同一件事的三种状态**，
  所以合成一个字段而不是拆 `private` + `locked` 两个布尔（拆开会造出「private 且 locked」这种没含义的组合）。
- `entry_date`：本地日期 `YYYY-MM-DD` 字符串，同 `CountdownDay.targetDate` 的理由（避免纯日期被时区推一天）。
- ⚠️ 无权限时**不发正文**：`DiaryView.content` 为 `null`（**不是空串**），并显式给 `fragments[].readable` / `readable` / `editable`；部分开放时只下发已开放片段。
  让前端拿 `content === null` 去猜「没权限还是还没写」是不行的 —— 那是两件完全不同的事。

**迁移怎么保证不丢数据**：整套搬迁在**启动期**跑（`web/src/db/legacy-upload.ts`，三轮：收编 → 上传 → 清源）。
先把旧表 `diaries` / `moments` 里剩余的行登记进中转表 `legacyUploads`（按 `kind:id` 去重），
再整批发给 `/api/diary/import` 与 `/api/moments/import`。
两个导入端点都**幂等**（已存在的 id 跳过、不覆盖），所以重复触发不产生副本；
**服务端确认收下之后**才删中转行、并从旧表删掉那几行 —— 传一半就清，等于把用户的东西弄丢。
「每次启动都跑」这件事本身就是安全网：老设备的遗留数据、旧构建没搬干净的数据，都会在下次启动收敛。

（为什么不放 Dexie 的 `upgrade()`：见上文「v11 为什么不用 upgrade」。总结一句 —— 旧表壳删不掉，
而 upgrade 只跑一次。）

⚠️ **迁移上来的旧日记一律标 `author='user'`**，所以北北已写好的日记不会因迁移变成只读。
AI 的日记只能由 AI 侧写入（P1 的工具层，`db/diary.ts` 的 `createCompanionDiary`），
用户接口**不接受 `author` 入参**（SPEC §3.4.2）。

留言板的历史视图按 `moment.created_at` 在前端分成「今天 / 昨天 / 某年某月某日」，不复制时间线数据；
服务端 `GET /api/moments?channel=board&groupId=` 负责留言板分组筛选，`none` 代表未分组。
朋友圈复用同一事实表但固定使用 `channel=feed`，因此不会混入留言板 Widget / 分组；分组整理不会改变 `updated_at`，
这样移动留言不会把它伪装成刚刚发生的生活事件。当前朋友圈 P1 开放文字动态、回应树与用户自有 CRUD；动态 / 回应创建追加 Life 事实。
图片 / 音乐 / 作品引用、互动通知与 AI 自主发布另行接入。

---

## 12. Phase 6.5 事件收件箱（服务端 SQLite，T-037）

一张表承载**两个方向的待决**：

| 事件类型 | 谁发起 | **谁决定** | 决定后发生什么 |
| --- | --- | --- | --- |
| `tool_confirm` | AI 想写日记 / 留言 | **北北**（`decider='user'`） | 真写入（允许）或什么都不做（拒绝） |
| `diary_access_request` | 北北想看某篇私密日记或其中一段 | **AI**（`decider='companion'`） | 整篇转 `open`，片段只开放该段（允许）或保持原权限（拒绝） |

| 表 | 字段 | 关键不变量 |
|---|---|---|
| `runtime_event` | `id` / `kind` / `decider` / `status` / `title` / `detail` / `payload_json` / `result` / `result_delivered_at` / `capability_id` / `target_id` / `target_fragment_id` / `expires_at` / `created_at` / `decided_at` | `decider` **就是权限位**；`pending` 之外一律终态；过期 / 撤回不删除原事件 |

字段约定：

- `decider`：`'user' | 'companion'`。它说清了**这条在等谁** —— 注入模型上下文只取 `companion` 的待决，
  前端确认卡只认 `user` 的。两边都拿不到对方的。
- `status`：`pending` / `approved`（批准**且执行成功**）/ `denied`（被拒，无副作用）/ `failed`（批准了但没做成）。
  **`denied` 与 `failed` 必须分开**：前者是决定，后者是故障。给用户看的文案完全不同，
  混在一起会让人以为是自己点错了。
- `payload_json`：执行器要用的数据（工具名 + 参数 / 日记 id）。**刻意不进对外的 `RuntimeEvent` 形状** ——
  那个形状会直接序列化下发前端，把执行载荷放进去等于让它跟着接口一起露出去。
- `target_id`：指向的业务对象（日记 id）。存在的理由很实际：日记页要能显示「这一篇你已经请求过了」，
  而前端拿不到 `payload`，只能靠这个字段自己匹配（否则用户只能靠「点了没反应」判断，那是最差的反馈）。
- `target_fragment_id`：片段级日记请求的 `fragment-N`；整篇请求与其它事件为 `NULL`，用于刷新后恢复「这一段已请求」状态。
- `result_delivered_at`：已决结果是否已注入过模型。**只注入一次** —— 重复说「北北已经允许你写日记了」
  既费 token，又会让它以为要再写一篇。

**为什么不用 `notification` 表**（Phase 4 已在用）：那张是**单向广播**（AI 主动唤醒你，只读、只能标已读），
这张是**双向待决**（有状态、有决策、有执行结果）。合并之后「已读」与「已决定」会变成同一个字段，
而它们根本不是一回事。

**接口为什么不叫 `/api/events`**：那个路径已经是 Eventide 的**状态事件流水**（`event_log`）。
两者语义不同 —— 那张是「发生过什么」，这张是「等你决定什么」。所以用 `/api/inbox`。

**决策只能做一次**：`settleEvent()` 带 `status='pending'` 条件更新，已决的返回 `null` 并让调用方报错。
这不是顺手加的校验 —— 确认卡点两下就会写两篇日记。同一条纪律的另一个面是
「**拒绝不等于删掉**」：拒绝只改事件状态，绝不动日记本身。

---

## 13. V2-A Provider Center（服务端 SQLite，T-058）

`api_profile` / `api_secret` 继续分别承担“可复用连接配置 / 只进不出的凭据”；没有复制一套媒体 Provider。
新增两张表只表达四个能力如何绑定这些连接：

| 表 | 字段 | 关键不变量 |
|---|---|---|
| `provider_capability_binding` | `capability`（主键）/ `profile_id` / `model` / `secondary_model` / 最近测试时间、延迟、错误 / `updated_at` | 四种 capability 各至多一行；`voice.secondary_model` 是可选 ASR，其余为空；手改单卡会清除 scheme 的 active 标记 |
| `provider_scheme` | `id` / 唯一 `name` / `bindings_json` / `is_active` / 时间 | JSON 只保存四份 `{profileId, model, secondaryModel}` 快照，**不含密钥**；激活前验证所有引用，四行绑定在一个事务中整体替换 |

演进规则：启动时 `CREATE TABLE IF NOT EXISTS` 补表；不改 Dexie、不升前端备份版本。老库在首次读取 Provider Center 时，
只按原 active profile 已存在的 `modelMap` 槽位补种绑定，未配置能力保持空。删除 Provider 前同时检查当前绑定与所有方案引用；
仍被引用时拒绝，避免留下指向不存在连接的方案。

## 14. V2-A MCP Manager（服务端 SQLite，T-059）

MCP 连接配置由服务端持有，浏览器只拿脱敏视图；不改 Dexie、不升前端备份版本。

| 表 | 字段 | 关键不变量 |
| --- | --- | --- |
| `mcp_server` | `id` / `name` / `url` / `headers` / `enabled` / `allow_autonomous` / `created_at` / `updated_at` | URL 只接受 http(s)；`enabled=false` 不握手；`allow_autonomous` 只记录策略，不代表当前已经绑定任意原始工具 |
| `mcp_server_secret` | `server_id` / `token` / `updated_at` | 一对一；token 只在服务端使用，任何 API 回执都只返回 `hasToken` |

启动时环境变量 MCP 注册表只作一次性种子：缺 id 才插入，已有记录不被 `.env` 覆盖。删除时 secret 与配置在同一事务内清理。连接配置修改后 Gateway 整体热加载，避免半套注册表。
