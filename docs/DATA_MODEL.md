# DATA_MODEL · 数据模型

> **权威关系**：产品行为以 `docs/PRODUCT_SPEC.md` 为准 ｜ 实体设计与归属以《栖息地初版技术方案分析.md》§6 为准 ｜
> 本文件记录**落地的实现口径**（字段、索引、约束、归属），是前两者的落地层。
> 不复制 SPEC 的交互定义，也不改技术方案的架构决策。
> 最后更新：2026-09-23

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

## 4. Home 生活实体（本地）

十类生活数据，全部继承基座：

| 实体 | 表 | 关键字段 |
|---|---|---|
| `Moment` | `moments` | `content`, `author: 'user' \| 'companion'` |
| `WishlistItem` | `wishlist` | `title`, `status: 'open' \| 'done'`, `completedAt` |
| `CountdownDay` | `countdowns` | `title`, `targetDate`（本地 `YYYY-MM-DD`） |
| `Diary` | `diaries` | `title`, `content`（纯文本）, `entryDate` |
| `Bookmark` | `bookmarks` | `targetType`, `targetId`, `title`, `note`, `categoryId` |
| `Artwork` | `artworks` | `title`, `category`, `description`, `externalUrl` |
| `Photo` | `photos` | `title`, `caption`, `imageDataUrl`, `mimeType`, `sizeBytes`, `takenAt`, `collectionId` |
| `ReadingNote` | `readingNotes` | `bookTitle`, `author`, `status`, `note` |
| `MusicTrack` | `musicTracks` | `title`, `artist`, `note`, `externalUrl` |
| `StudyRecord` | `studyRecords` | `subject`, `note`, `studiedOn`, `durationMinutes` |

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
| 作品 → 来源内容 | `BaseObject.sourceId` / `sessionId` | 本体尽量**引用原始对象**，必要时存稳定快照（SPEC §3.6.3） |
| 相册 → 来源消息 | `BaseObject.sourceId` / `sessionId` | 保留原图 + 来源 + 时间 + 发送方 / 生成方（SPEC §4.4） |
| 主屏 Widget → 被展示内容 | `HomeWidget.kind` + `refId`（本地表 `homeWidgets`） | **只存引用、不复制数据**（SPEC §1.4）；唯一索引 `&kind` 从数据层保证**每种 Widget 至多一条**；`refId` 失效时渲染层不渲染，删实体时同事务清引用 |
| 收藏 → 分类 | `Bookmark.categoryId`（本地表 `bookmarkCategories`） | 单归属；删分类**不删收藏**，同事务把类内 `categoryId` 置 `null`（SPEC §3.5.4） |
| 照片 → 相册 | `Photo.collectionId`（本地表 `photoCollections`） | 单归属；删相册**不删照片**，同事务把册内 `collectionId` 置 `null`（SPEC §3.7.3）。⚠️ 「移出相册」只置空归属，与「删除照片」是两件事 |

`BookmarkTargetType` 的合法取值集中在 `shared/types.ts`。新增来源类型时**只加这一个枚举**，
`Bookmark` 表结构不动 —— 这正是选 `targetType + targetId` 而不是给每类内容建关联表的原因。

## 6. P0 待新增（方向已定，尚未落库）

| 项 | 改动 | 依据 |
|---|---|---|
| ~~会话分组~~ | ✅ 已落地（T-018）：`ChatSession.groupId` + `sessionGroups` 表 → Dexie v8 | SPEC §2.1.3 |
| 日记权限模型 | `Diary` 加 `author`、可见性 / 锁定；新增「查看请求」实体 | SPEC §3.4 / §6.3 |
| 作品来源引用 | 复用基座的 `sourceId` / `sessionId`，**不新增字段**；聊天来源已落地（T-016） | SPEC §3.6.3 |
| 相册来源引用 | 同上；聊天图片来源与 block 位置已落地（T-016） | SPEC §3.7.2 |

> ⚠️ 日记的「AI 决定允许 / 拒绝查看」需要 AI 侧决策能力，属 Eventide 与主动行为链路之后
> （SPEC §3.4.5）。P0 只落**用户侧**（封面 + 请求入口 + 不可编辑），不留半截的假 AI 行为。

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

Dexie 把声明版本 ×10 作为 IndexedDB 版本号，验收脚本据此刻画版本（`verify-chat.mjs`）。
**每次升版都要在 `db.ts` 的版本注释里写清「为什么」**；只写「加了张表」等于没写。

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
