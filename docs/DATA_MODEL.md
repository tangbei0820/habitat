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
| LLM 方案与凭据、用量账本、MCP 诊断日志 | **服务端 SQLite** | `server/src/db/*` |

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
| `remark` | `string \| null` | 会话备注（SPEC §2.2.1 聊天设置） |
| `background` | `string \| null` | 会话背景 |
| `bubbleMode` | `'chat' \| 'native'` | 气泡模式 |
| `archivedAt` | `number \| null` | 归档（尚无 UI 生产者） |

索引：`id, updatedAt, pinnedAt, archivedAt`

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

## 4. Home 生活实体（本地）

十类生活数据，全部继承基座：

| 实体 | 表 | 关键字段 |
|---|---|---|
| `Moment` | `moments` | `content`, `author: 'user' \| 'companion'` |
| `WishlistItem` | `wishlist` | `title`, `status: 'open' \| 'done'`, `completedAt` |
| `CountdownDay` | `countdowns` | `title`, `targetDate`（本地 `YYYY-MM-DD`） |
| `Diary` | `diaries` | `title`, `content`（纯文本）, `entryDate` |
| `Bookmark` | `bookmarks` | `targetType`, `targetId`, `title`, `note` |
| `Artwork` | `artworks` | `title`, `category`, `description`, `externalUrl` |
| `Photo` | `photos` | `title`, `caption`, `imageDataUrl`, `mimeType`, `sizeBytes`, `takenAt` |
| `ReadingNote` | `readingNotes` | `bookTitle`, `author`, `status`, `note` |
| `MusicTrack` | `musicTracks` | `title`, `artist`, `note`, `externalUrl` |
| `StudyRecord` | `studyRecords` | `subject`, `note`, `studiedOn`, `durationMinutes` |

约定：

- **纯日期一律存本地字符串**（`YYYY-MM-DD`），避免纯日期被时区偏移成前一天。
- **时长统一存分钟**，展示层不再反复换算。
- 未接入富文本沙箱前，正文一律**纯文本**，不引入 HTML 旁路。

## 5. 跨模块引用契约（SPEC §4）

| 关系 | 载体 | 约束 |
|---|---|---|
| 收藏 → 任意内容 | `Bookmark.targetType + targetId` | 唯一复合索引 `&[targetType+targetId]` **从数据层**阻止同一目标重复收藏 |
| 作品 → 来源内容 | `BaseObject.sourceId` / `sessionId` | 本体尽量**引用原始对象**，必要时存稳定快照（SPEC §3.6.3） |
| 相册 → 来源消息 | `BaseObject.sourceId` / `sessionId` | 保留原图 + 来源 + 时间 + 发送方 / 生成方（SPEC §4.4） |

`BookmarkTargetType` 的合法取值集中在 `shared/types.ts`。新增来源类型时**只加这一个枚举**，
`Bookmark` 表结构不动 —— 这正是选 `targetType + targetId` 而不是给每类内容建关联表的原因。

## 6. P0 待新增（方向已定，尚未落库）

| 项 | 改动 | 依据 |
|---|---|---|
| 会话分组 | `ChatSession` 加 `groupId`，新增分组表 → Dexie v8 | SPEC §2.1.3 |
| 日记权限模型 | `Diary` 加 `author`、可见性 / 锁定；新增「查看请求」实体 | SPEC §3.4 / §6.3 |
| 作品来源引用 | 复用基座的 `sourceId` / `sessionId`，**不新增字段** | SPEC §3.6.3 |
| 相册来源引用 | 同上 | SPEC §3.7.2 |

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

Dexie 把声明版本 ×10 作为 IndexedDB 版本号，验收脚本据此刻画版本（`verify-chat.mjs`）。
**每次升版都要在 `db.ts` 的版本注释里写清「为什么」**；只写「加了张表」等于没写。
