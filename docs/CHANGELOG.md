# CHANGELOG · 变更记录

> 本文件记「改了什么」（面向版本，按 Phase 组织）。
> 「做到哪、还欠什么」在 `docs/TASKS.md`。

## 2026-09-28 · V2-A · P1 Home Living Apps 共同生活核心

### T-125 · 朋友圈回应与一起听历史

- 朋友圈新增服务端 `moment_comment` 事实源，前端支持文字回应、嵌套回复、用户编辑 / 删除；父回应删除级联清理子回复，留言板动态不会误开放回应接口。
- 动态 / 回应创建追加 `moment.feed.created` / `moment.feed.comment.created`，Life 月历与时间线可追溯来源。
- 一起听新增 `GET /api/listening/history?limit=N`，从真实播放事实聚合曲目累计秒数、播放次数与最近播放时间；页面新增「一起听过」历史区，继续复用浏览器播放与共享会话。
- 验收：服务端 `probe:feed` 17/17（含三级回应级联）、`probe:listening` 8/8、`probe:moment-groups` 13/13；两端 typecheck、前端 build、脚本语法检查与 diff 检查通过。浏览器新增回应 / 一起听历史断言通过；整支既有 Home 回归仍有倒数日刷新、音乐空态与学习卡片旧断言失败，未命中本批路径。生产部署未执行。
- 本批不包含朋友圈附件 / 通知 / AI 自主发布、NetEase 搜索与 AI 评论、PDF / EPUB 共读器或 Widget 拖拽编排。

## 2026-09-28 · V2-A · P2 Appearance / Widget / 离线 / 移动端

### T-126 · 主屏编排与可恢复外观

- 主屏 Widget 新增稳定 `sortOrder`，Dexie 升 v22、备份格式升 v20；主屏提供键盘 / 触控可达的上移 / 下移编排入口，并用 Dexie `liveQuery` 同步多标签页变化。
- 设置页新增 Appearance Studio：字体缩放、行高、气泡宽度 / 圆角、主屏卡片间距 / 透明度、自定义 CSS 的预览 / 保存 / 恢复默认；AppShell 注入主题根，Chat / Home / 思绪 / Widget 提供稳定 `data-*` hooks。
- 自定义 CSS 保存前拒绝远程资源、脚本、`@import`、at-rule 与大括号错误，并自动限制在 Habitat 主题根内；不进入内容备份。
- 离线横幅增加 `/api/health` 轻量探测与重试，区分浏览器离线和服务不可达；会话行增加 450ms 移动端长按打开既有操作菜单，更多按钮触控目标扩大到 44px。
- 更新 Home / Chat / Export 验收脚本的 Dexie / 备份版本断言；两端 typecheck、前端 build、脚本语法与 diff 检查通过。生产部署未执行。
- 本批不引入复杂拖拽、主题包 / 字体背景资源导入、离线发送队列、Blob / OPFS 迁移或下一阶段 Living Apps / Provider 深化。

## 2026-09-28 · V2-A · Provider Center 草稿配置收口

### T-127 · 模型目录选择与自定义 Headers 编辑

- 四张能力卡在成功拉取模型后提供明确的下拉选择，同时保留模型 ID 手填与浏览器 datalist；拉取失败不会覆盖手填值。
- 自定义 Headers 增加可增删键值行与高级 JSON 兼容入口；空键行不会进入请求，已保存 Header 只展示名称，不回显敏感值。
- 不改数据库、Provider API 或能力绑定语义；继续复用未保存草稿、真实能力测试与测试指纹门禁。
- 参考取舍：借鉴 OmniRouter 的 Provider / 模型分层与状态反馈、VCPToolBox 的显式配置诊断；不引入复杂路由或第二套 Agent Runtime。
- 验收：两端 `typecheck`、前端 `build`、Provider 验收脚本语法检查与 `git diff --check` 通过；未启动浏览器 CDP，生产未部署。

## 2026-09-28 · V2-A · P0 收口

### T-124 · Provider / Runtime / Chat 正确性

- 新增实验性 `codex-subscription` Provider：通过 `codex app-server --stdio` 的 JSON-RPC 事件适配 Habitat 聊天流，设置页主聊天能力支持 `codex://local`；Codex 不可用于语音、识图、生图，也不读取浏览器 Cookie 或伪造 API Key。
- 聊天首个 SSE chunk 前支持 `HABITAT_CHAT_FALLBACK_PROFILE_ID` 回退；流开始后不切换 Provider。
- Event Inbox 增加事件截止时间、`expired` / `revoked` 终态与用户撤回端点；默认写入确认 30 分钟、日记查看 60 分钟，过期不执行副作用。
- AI 工具卡改为同一助手消息 blocks 的有序段，刷新后保留工具调用发生顺序；候选版本可删除当前版且至少保留一版；分组新增 `sortOrder`，Dexie 升 v21、备份格式升 v19，并提供列表上下调序。
- 验收：两端 `npm run typecheck`、前端 `npm run build`；事件收件箱 mock 端到端 59/60，唯一失败为本机未配置 Nocturne 记忆写入前提。
- 本批未部署 VPS；Codex app-server 的多线程生命周期、取消 / 重启恢复、工具映射与可视化回退策略留待后续 Provider 阶段。

## 2026-09-28 · V2-A Home

### T-106 · 留言板分组与历史视图

- 留言板服务端新增 `moment_group` 分组仓储与 `moment.group_id` 归属；老留言安全落到未分组，删组只回退归属，不删除留言或收藏快照。
- 新增分组创建 / 改名 / 删除、留言移入 / 移出与按分组筛选接口；分组整理不刷新留言 `updatedAt`，AI 自主留言链路保持原语义。
- 前端补齐分组管理、分组筛选、新留言分组选择、已有留言归属选择，并按本地日期渲染今天 / 昨天 / 历史分段。
- 新增 `probe:moment-groups` 11/11 隔离数据库验收；未引入平行模型或第三方 UI。

### T-107 · 留言板分组与历史视图部署

- T-106 代码已部署到 `https://habitat.beiyan.cc`，保留生产 `.env` / SQLite，重启前生成 `habitat.db.bak-20260928-25fa303`。
- 生产 `habitat-server` active，公网健康检查通过；首页已切换到 `index-DAkBPArf.js`，留言板接口返回结构化错误与分组列表。

### T-108 · 留言板 Widget 范围

- `HomeWidget` 新增 `boardScope`，支持最近 3 条、指定分组、指定留言；主屏只保存引用，正文仍由留言服务端实时读取。
- 留言板页新增范围选择与更新入口；指定留言卡片回到 `/home/board#<id>`，分组 / 单条引用失效时不渲染。
- 新增 `GET /api/moments/:id`；Dexie 升 v18，旧 Widget 迁移为 recent；备份升 v16 并兼容旧备份。
- `probe:moment-groups` 扩展到 **13/13**；两端 typecheck、build、脚本语法与 `git diff --check` 通过。

### T-109 · 留言板 Widget 范围部署

- T-108 已部署到 `https://habitat.beiyan.cc`，保留生产 `.env` / SQLite，重启前备份 `habitat.db.bak-20260928-ef5fe76`。
- `habitat-server` active；本机与服务器自 curl 公网 `/api/health` 返回 `{"ok":true}`；首页已引用 `index-wdNQr2lm.js`。
- 公网 `GET /api/moments?limit=1` 正常；不存在留言返回结构化 404；远端 `moment.ts` SHA-256 与本地一致。

## 2026-09-27 · V2-B

### T-076 · 聊天显式联网搜索

- 输入区“更多功能”新增“联网搜索（使用当前输入）”；原问题照常作为用户消息落本地。
- `web.search` / `web_search` 接入 Capability Registry，但保持 `user-only`：只有请求带 `webSearch.query` 时才在本轮临时开放，普通聊天、唤醒与独处不会自行出网。
- 服务端只读公开搜索结果，工具卡与 `role=tool` 结果使用同一次执行的成功 / 失败事实；标题、来源链接、摘要回灌下一轮模型，并明确标记网页内容为不可信资料。
- 未新增 Dexie 表、索引或备份版本；新增 `probe:chat-web-search` 验收授权、回灌、收口与空查询拒绝。
- 参考 [Chatnest](https://github.com/ugui3u/chatnest) 的工具状态卡和 [VCPToolBox](https://github.com/lioensky/VCPToolBox) 的统一工具协议边界；未复制其插件 / 浏览器运行时。

## 2026-09-22

### Phase 0 · 骨架

- 建立空项目骨架：`web/`（React SPA / Vite / TS strict）、`server/`（Fastify / TS strict）、`shared/`、`docs/`（九件套 + UI_DESIGN.md 骨架）。
- 唯一端点 `GET /api/health`；`@shared` 别名已在 `web` 配置。
- 文档收口：新增 `AGENTS.md`（AI 工作入口）与 `docs/REFERENCES.md`（外部参考库）；删除 `ARCHITECTURE` / `PROJECT_PLAN` / `UI` 三个纯占位文件。

### Phase 0 · 可视化三件套 + MCP Gateway 最小可用

**shared**

- `types.ts`：统一基座 `BaseObject` + `ChatSession` / `ChatMessage`（含 `MessageBlock`、`MessageCandidate` 版本/多候选，§6.3 提前量）；后端健康类型。
- `errors.ts`：统一错误码与 `ApiError` 形状；`events.ts`：SSE 协议占位；`providers.ts`：`ToolGateway` 等 Provider 接口。

**web**

- 路由：`/chat`（列表 + `/chat/:sessionId` 窗口）、`/home`（+ `/home/:module`）、`/llm`、`/life`、`/setting`；`/` 与未知路径重定向到 `/chat`。
- `AppShell`（移动端优先 + SafeArea）+ `BottomNav`（五 Tab）。
- 本地数据层 `db.ts`：Dexie `version(1)` 建 `sessions` / `messages` 两表；启动 `HydrationGate`，水合失败即拦截用户（铁律 5）。
- 主题系统：`theme/tokens.css` 深浅两套 CSS 变量 + `useTheme`（zustand persist），切换即时生效并跨刷新保持。
- 设置页接通真实后端状态（`/api/health`、`/api/health/mcp`）。

**server**

- `GET /api/health`、`GET /api/health/mcp`；统一错误映射（业务错误 → `ApiError` 形状）。
- `McpGateway`：官方 SDK `StreamableHTTPClientTransport`，每 server 一个状态机（`disconnected → connecting → handshake → ready/error`）；启动连接失败不阻塞服务。
- SQLite（better-sqlite3 + Drizzle）+ `mcp_diagnostic_log` 表：握手与每次工具调用全量留痕。
- `src/mcp/mock-server.ts`：零额外依赖的 mock MCP server（:3333，`echo` 工具），用于先验证客户端代码再排真实链路（§9 风险 1）。

**修复**

- `useTheme`：原先裸读 `localStorage.getItem('habitat-theme')`，而 zustand `persist` 存的是 `{"state":{"mode":…}}` 包裹结构，导致**刷新后 `data-theme` 变成乱码字符串、深色模式静默失效**。改为 `onRehydrateStorage` + store 订阅单向同步 DOM，`mode` 与 DOM 属性永不脱钩。
- `.gitignore` 补 `server/data/*`（本地 SQLite 数据文件此前会被提交）。

**验收**

- `npm run typecheck` 两端通过；`npm run build` 通过。
- 无头浏览器实测（Edge + CDP）：五路由与 Home 子模块均正常渲染、底部导航高亮正确、深浅主题切换并刷新后保持、新建会话落库并在刷新后仍在列表、聊天窗口发送占位提示正常；控制台零异常（仅 favicon 404）。

### Phase 1 · 切片一：通用 OpenAI 兼容层

**shared**

- `LLMProvider` 落地：`streamChat(messages, opts) → AsyncIterable<LlmStreamChunk>` + `listModels()`。
- `LlmStreamChunk` 只有三种：`delta`（正文 / 思维链 / tool_calls 增量）、`usage`、`done`，顺序保证 delta → usage → done。
- `ApiProfile`（baseUrl + keyRef + modelMap + headers + isActive）与脱敏视图 `ApiProfilePublic`。
- 新增 4 个错误码：`PROVIDER_NOT_FOUND` / `PROVIDER_NOT_CONFIGURED` / `PROVIDER_UNAUTHORIZED` / `PROVIDER_UPSTREAM_ERROR`。

**server**

- `OpenAICompatProvider`：只用 `fetch` + 自写 SSE 解析，**不引第三方 SDK**。认 `reasoning_content`（DeepSeek-R1 式思维链）、`usage`、`tool_calls` 分片；上游漏发 `finish_reason` 也保证 `done` 恰好一次。
  - **空闲超时 60s**：防「假死」而不是让调用方无限等。
  - 建连超时用**自有 controller**，拿到响应头就解除计时（`AbortSignal.timeout` 会掐住响应体、误杀长回复）。
- `LlmRegistry`：方案装载 + Adapter 工厂 + 脱敏视图；坏配置只跳过并告警，不阻塞启动。
- 路由：`GET /api/providers`、`GET /api/providers/:id/models`、`POST /api/providers/:id/test`（探测失败是「结果」不是异常）。
- 密钥模型：方案只存 `keyRef`（环境变量名），真值只活在服务端进程环境，永不下发前端（铁律 3）。
- `src/providers/mock-openai.ts`（:3334，含「无鉴权 → 401」分支）+ `scripts/probe-llm.ts`。

**修复**

- **服务端此前不读 `.env`** —— 新增 `src/lib/env.ts`，作为 `src/index.ts` 的**第一个 import** 灌入 `process.env`（晚了 `db/index.ts` 已在模块加载期读过环境变量）。刻意不引 dotenv（会覆盖既有变量），手写解析保证「**真实环境变量 > `.env`**」。
- `server/tsconfig.json` 的 `include` 补 `scripts`（此前完全没被类型检查覆盖，是个静默真空）。
- `errMessage` 带出 `err.cause`（`fetch failed` 本身没有信息量，真原因在 `ECONNREFUSED` 这类 cause 里）。

**验收**：`scripts/probe-llm.ts` 20 项断言全过；三条路由 + 错误码 + 404 路径实测通过。

### Phase 1 · 切片二：本地存储的聊天链路（SSE 端到端）

**shared**

- `events.ts` 定义聊天流契约：`ChatStreamRequest` + 四种事件载荷 `chat-delta` / `chat-usage` / `chat-done` / `chat-error`。

**server**

- `POST /api/chat`（SSE）：校验 → 转发 → 记账。
  - **关键设计：先取到上游第一个 chunk 才写响应头。** `streamChat` 是 async generator，函数体到第一次 `next()` 才跑，于是「密钥没配 / 上游不可达 / 鉴权被拒」都暴露在写头之前 → 走统一 `ApiError` + 4xx/5xx；只有**流开始之后**的故障才走 `chat-error` 事件，前端少一条判错分支。
  - 响应头带 `x-accel-buffering: no` + `cache-control: no-transform`（对策 §9 风险2）；客户端断开 → abort 上游，不白烧 token。
- `usage_record` 表 + `db/usage.ts`：每次成功调用强制落一条（§6.2）。上游没回 usage 按 0 落（保证「这轮发生过」有据可查）；没跑成则不记（记的是消耗不是尝试）；`day_key` 用本地时区。

**web**

- `lib/chatStream.ts`：自写 SSE 客户端（`EventSource` 只支持 GET，聊天要 POST）。
- `db/chat.ts` 仓储层 + Dexie `version(2)`（补 `[sessionId+createdAt]` 复合索引，支撑按时间分页）。
- `components/VirtualList.tsx`：自写不定高虚拟列表（实测高度缓存 + 二分定位 + 贴底跟随）。高度缓存键用 **item key 而非下标**，为向上加载更早一页留余量。
- `ChatWindowPage`：真实发送 / 流式累加渲染 / 中止（保留已收内容）/ 错误提示 / 首条自动命名；回车发送处理中文输入法 `isComposing`。
- 会话窗口改**沉浸式**（不渲染底部导航 + 自持滚动容器）。

**修复**

- **fixed 底栏盖住聊天输入区** —— JS 检查一路绿灯（`textarea` 确实存在），但它是被压住的：元素存在 ≠ 可见。截图才暴露。
- 避让底栏的魔法数字 `pb-16` 换成 token `--bottom-nav-height`。

**验收**：接口层 7/7（正常流 9 个事件顺序正确 + 5 类错误分支 + `usage_record` 落表实测）；前端 13/13（无头 Edge + CDP，含虚拟列表「渲染 13 条 / 已加载 60 条」）；控制台零异常。验收脚本沉淀为 `web/scripts/verify-chat.mjs`。

## 2026-09-23

### Phase 1 · 切片三：API 方案管理（权威源迁到 SQLite）

**shared**

- `ApiProfilePublic` 加 `keySource`（`stored` / `env` / `missing` / `not-required`），彻底消除 `hasKey` 把「不需要密钥」和「已配好」混为一谈的歧义。
- 新增 `ApiProfileCreateInput` / `ApiProfileUpdateInput` / `ApiProfileSecretInput`。

**server**

- **方案权威源从环境变量换成 SQLite**：新增 `api_profile` / `api_secret` 两表（**拆表**：凭据独立存放，使任何「读方案」的路径都不可能顺带读出密钥，也让备份方案时不必然带出凭据）。
- `db/profiles.ts` 仓储层：CRUD + 凭据读写 + `activate` 互斥 + 环境变量**一次性种子导入**。
  - 删掉默认方案会自动把剩下第一条顶为默认 —— 不出现「有方案但没有默认」的空窗。
  - `id` 由名称派生，**中文字符原样保留**（它会出现在 `usage_record.profile_id` 与日志里，可读比好看重要），冲突自动加后缀。
- `LlmRegistry` 换成读 DB，**对外接口一字未改**（调用方无感）。凭据优先级 **`stored` > `env`**，于是 UI 能为已按环境变量配好的方案补填密钥。
- 新增五个端点：`POST /api/providers`、`PATCH /:id`、`DELETE /:id`、`POST /:id/activate`、`PUT|DELETE /:id/secret`。**密钥只进不出** —— 没有任何端点会把它读回来。
- `HABITAT_LLM_PROFILES` 降级为**首次种子**（仅在表为空时导入），启动日志明确说明「此后以数据库为准」，避免「改了 `.env` 没反应」的困惑。

**web**

- `features/providers/`：`api.ts`（调用层）+ `useProviders.ts`（状态中枢）+ `ProviderForm.tsx` + `ProviderSettings.tsx`，接进设置页。
- 表单主路径只暴露「名称 / Base URL / 模型 / API Key」四项，`keyRef` 收进折叠的「高级」，并给 DeepSeek / OpenAI / 本地 Ollama 三个**快捷填充**。
- 删除用**两步确认**而非 `window.confirm`（原生弹窗会阻塞页面、在无头浏览器里还要额外处理）。
- 列表显示凭据来源文案，并区分「密钥已保存」/「密钥来自环境变量」/「缺密钥，现在调不通」/「无需密钥」。

**验收**

- `server/scripts/probe-providers.ts`：**46 项断言全过**（列表 / 新建 / 5 类字段校验 / 更新 / 凭据完整生命周期「写入 → 生效 → 清除 → 回落」/ 设为默认互斥 / 删除后 active 自动转移 / id 生成 / 视图脱敏 / 端到端聊天）。
- `web/scripts/verify-providers.mjs`：**22 项断言全过，且连跑两次均通过**（新建 → 无密钥探测失败 → 编辑并填密钥 → 探测成功 → 刷新后仍在 → 设为默认 → 两步删除），控制台零异常。
- `scripts/probe-llm.ts` 扩到 27 项（新增凭据来源与「表内密钥优先于环境变量」两组断言）。脚本改为走**真实 DB 路径**（临时库 + 顶层 await 动态 import，因为 `HABITAT_DB_PATH` 必须在 `db/index.js` 求值前设好）。

### Phase 1 · 切片四：消息块分发 + 分页加载 + 重发 / 换一个

**shared**

- `types.ts`：`MessageBlock` 从 `{ kind, payload: unknown }` 改成**可辨识联合**，8 种 kind 各定载荷契约（`TextBlock` / `HtmlBlock` / `ImageBlock` / `AudioBlock` / `FileBlock` / `ToolResultBlock` / `WidgetBlock` / `TabGroupBlock`）。渲染器 `switch (block.kind)` 即可收窄 payload，不必再 `as` 断言。
  - `TabGroupBlock` 的 tab 内只允许**叶子块**（`LeafMessageBlock`）：块里嵌套块组会形成递归类型，Dexie 的键路径推导（`KeyPaths`）展开递归类型会直接报 `TS2615`。

**web**

- 新增 `features/chat/MessageBlocks.tsx`：**渲染器按 kind 分发**（§6.2 的「可扩展块模型」落到实现）
  - 真渲染：`text`（多块按 `order` 升序拼接）/ `image` / `audio`（带转写）/ `file`（名字 + 体积）/ `tool-result`（`<details>` 折叠，默认收起细节）
  - 明确占位：`html`（**不直接注入原文** —— LLM 产出的 HTML 需沙箱，等 Phase 5 落地）/ `widget` / `tab-group`
  - 运行时兜底：遇到**不在联合里的 kind**（旧版本读到新版本写入的数据）降级成占位块 —— IndexedDB 不校验结构，未知数据不该崩整页
- `components/VirtualList.tsx`：补 `onReachTop` 回调（贴顶时触发，供向上翻页）+ **向上插入的锚点补偿**
  - 做法：记上一帧的 `offsets` / `keys`，首项换人且用户未贴底时，用「盖住视口顶部的那一项」当锚点，按它在新几何里的位置重设 `scrollTop`
  - 锚点用 **item key 而非下标**：插入会让整段下标位移，只有 key 是不动的参照物
- `db/chat.ts`：`messageText` 在联合类型下简化为「过滤 text 块取 payload.text」；新增 `textBlock` / `addVersion` / `selectCandidateVersion`
  - `addVersion` 首次调用会把「当前正文」也登记成一条版本，否则「换一个」之后无从切回；超 `MAX_CANDIDATES(8)` 时淘汰**最旧的未展示项**，绝不淘汰当前展示的那个
  - `blocks` 与展示版本**同步更新**：前者是渲染与历史组装的投影，后者是版本历史，分家就会出现「看到的」和「下一轮送出去的」不是同一段话
- `pages/chat/ChatWindowPage.tsx`
  - 抽出 `runGeneration(history, targetId)`：发送 / 重发 / 换一个三条路共用，差别只在结果写到哪（追加新消息 vs 加一个版本）
  - 新增 `historyUpTo(messages, upToIndex)`：把「同一轮」钉住 —— 换一个时若不截断历史，等于让模型接着自己刚写的那段往下续，必然跑偏
  - 气泡下方操作区：`‹ n/N ›` 候选导航、「换一个」（仅末条 AI 回复）、「重发」（末条是用户消息 = 这一轮压根没拿到回复）
  - 分页：滚到顶自动加载更早一页；`loadingEarlierRef` 做**同步守卫**（贴顶时 `onReachTop` 会连着触发，而 state 更新是异步的，只靠 state 拦不住）；顶部有「正在加载更早的消息…」提示

**验收**

- `web/scripts/verify-chat.mjs` 扩到 **35 项断言全过**：块分发 8 种（含「html 块只给占位、页面上不存在 `<b>`」的防注入断言）、分页三页 `3408 → 6934 → 7334`（并在向上插入后 `scrollTop=3840`，证明锚点补偿生效）、换一个记下两个版本且可切回并跨刷新保持、重发新增一条回复。
- `web/scripts/verify-providers.mjs` 回归 **22 项全过**；`npm run typecheck`（两端）与 `npm run build` 通过，控制台零异常。
- 用量取证：一轮聊天 + 中止 + 换一个 + 重发共落 `usage_record` **4 条**（证明后两者确实各发起了一次上游调用）。
- 修验收脚本自身的 fixture 耦合：`verify-providers.mjs` 原先把种子方案的显示名写死成 `Mock 上游`，换个 `.env` 就跑不过；改为从 `GET /api/providers` 现取，并在没有方案时给出明确提示。

### Phase 1 · 切片五（收尾）：诊断日志查询 + 设置页时间线

**shared**

- `types.ts`：新增 `McpDiagnosticDirection` / `McpDiagnosticEntry` / `McpDiagnosticQuery` / `McpDiagnosticPage`。查询条件全可选，`handshake` 是**三态**（`undefined` 全部 / `true` 仅握手 / `false` 仅工具调用）。

**server**

- `db/diagnostics.ts`：读写收口于此。新增 `listMcpDiagnostics` —— 按 `id` 倒序、`limit+1` 多取一条判断 `hasMore`、`total` 与 `errorCount` 合并成**一次**聚合查询。
  - **游标（`before`）不参与计数**：`total` 说的是「符合筛选的记录有多少」，算上游标会让用户每翻一页就看到数字变小，像是日志在被删。
- `db/index.ts`：补 `(server_id, id)` / `(handshake, id)` 复合索引 + `error IS NOT NULL` 的**部分索引**（绝大多数记录无错，只给有错的那少量行建索引才划算）。
- `routes/diagnostics.ts`：新增只读端点 `GET /api/diagnostics/mcp`（`serverId` / `handshake` / `errorsOnly` / `limit` / `before`）。
  - 字段**原样下发**：诊断日志是排障证据，在服务端做二次解释会让「页面看到的」和「库里存的」对不上。
  - 校验从严：`limit` 1–200、`before` 正整数、布尔字面量、**同名参数重复传直接拒**（会被解析成数组，静默取第一个只会埋雷）。`serverId` 传不存在的服务返回空页而非报错（它是筛选条件，不是资源标识）。
- 新增 `lib/errors.ts` 的 `RequestError`：参数校验类错误原先既不属于 `ProviderError` 也不属于 `GatewayError`，只能落到「未识别异常 → 500」。现接进统一错误处理器，按错误码映射状态码。

**web**

- 新增 `lib/diagnostics.ts`（查询客户端）与 `features/diagnostics/DiagnosticPanel.tsx`（设置页「诊断日志」时间线）：
  - 统计行（共 N 条 / 其中 M 条有错 / 已载入 K 条）+ 三个筛选（服务 / 阶段 / 只看错误）+「加载更早的记录」。
  - 每行：毫秒时间戳、方向（→ 请求 / ← 响应）、方法（中文 label + 原始 `tools/xxx`）、握手徽标、server、耗时、HTTP 状态；错误原文**逐字显示**。
  - 筛选与翻页**全交服务端**（日志只增不减，前端不许先全量拉回再过滤）；翻页游标 = 上一页最后一条的 `id`；筛选变化时清空旧数据，避免「上一份数据 + 新条件」被误读。
- `pages/setting/SettingPage.tsx`：替换掉原先的「诊断日志查看 —— 待接入」占位段。

**验收**

- `server/scripts/probe-diagnostics.ts`：**48 项断言全过，连跑两次通过**（排序 / 字段原样回传 / 三类筛选与组合 / 三段游标分页不重不漏且跨页仍倒序 / 7 种非法参数 / 未知 serverId 空页 / 真实启动记录可见）。fixture 直连 SQLite 写入（WAL 下多进程可读写），按唯一 `server_id` 标记清理，真实记录一条不动。
- `web/scripts/verify-diagnostics.mjs`：**36 项断言全过**（首屏只拉一页且有「加载更早」/ 翻页补齐并到底收按钮 / 只看错误后无错行确实消失 / 仅握手与仅工具调用互补 / 组合筛选出空态 / 服务筛选 / 刷新 / 错误原文逐字 / 控制台零异常）。
- 两端 `typecheck` + `build` 通过。

**验收过程中踩到的坑（已写进技能）**

- vite 默认绑 `localhost`，Windows 上解析到 `::1`，脚本用 `127.0.0.1` 打不开（`curl` 返回 `000`，而 vite 日志明明写着 listening）→ 起 dev server 一律加 `--host 127.0.0.1`。
- 断言把「渲染行数」当成了「总数」：仅工具调用时渲染 30 行（一页）而总数 41 → 比数字就比统计行里的 `total`。
- 长流水线挤在单条命令里会超时被杀（`SIGTERM`，且管道缓冲导致输出全丢，看起来像「什么都没跑」）→ 后台任务 + 输出落日志，再另开命令 tail。
- `better-sqlite3` 的 ABI 绑定 Node 20，而 CDP 验收要 Node ≥22 的内置 `WebSocket` → 验收脚本改用 Node 22 内置的 `node:sqlite`，两头都不欠。

### Phase 1 · 收尾补给（T-008）：修正阻断与半截实现

> 背景：上一批未提交改动是在「收口待优化清单」，但其中一处让**服务端完全起不来**，另有两处是「只写了壳、没接上」。本次审查后按「修阻断 + 补齐半截」修完，并补上对应的验收。

**server**

- **修阻断**：新增 `db/diagnostics.ts` 的 `pruneMcpDiagnostics(keep = MCP_DIAGNOSTIC_RETENTION /* 5000 */)` —— `main.ts` 一直在调它，实现却是空的（启动即 `SyntaxError`）。走**主键水位线**（`limit 1 offset keep-1` 定位第 keep 条，再 `DELETE WHERE id < 水位线`），不物化「要保留的 id 列表」；非法 `keep` 返回 0。
- **`streamOptions` 全链打通**（此前只有列和类型，没人读也没人写）：
  - `db/profiles.ts` 四个读写点补齐（`toProfile` / `createProfile` / `updateProfile` / `importProfiles`）
  - `providers/registry.ts`：env 种子解析支持该字段（只在显式 `false` 时记录，其余走「缺省开」）；`toPublic()` 补字段（原来这里直接编译不过）
  - `providers/openai-compat.ts`：按方案决定是否发 `stream_options`（原来无条件硬编码）
  - `routes/providers.ts`：`POST` / `PATCH` 都校验布尔值，非布尔一律 400
- **`app_kv` 落地**：新增 `db/kv.ts`（`getKv` / `setKv` / `hasKv`）；`importProfiles` 的判据从「表是否为空」换成**持久标记** `llm_profiles_seeded`，且**老库已有方案时也补写标记**（否则升级后「删光重启 → 种子复活」照样会发生）。
- **配置对齐**：`engines.node` 收紧为 `^20`；`index.ts` 的 `allowedMajors` 只取 `<` 之前的数字（原来 `matchAll(/\d+/g)` 会把 `>=20 <21` 的上界 21 也当允许值，放行 ABI 同样不对的 Node 21）；`.env.example` 补 `CORS_ORIGIN` 段。

**web**

- `pages/chat/ChatWindowPage.tsx`：收尾写回改成**先判 `targetId`**（`!== null` = 换一个加版本 / 否则 = 新回复收尾定性），类型自然收窄，消掉 `addVersion(targetId)` 的 TS2345。运行时行为不变（原先两个分支逻辑等价，只是类型推不出来）。
- `features/providers/ProviderForm.tsx`：「高级」区加 `stream_options` 兼容开关（默认开），并说明「只有老自建上游因它报 400 时才关」。

**验收**

- 新增 `server/scripts/probe-diag-retention.ts`：**自带一次性临时库**（先设 `HABITAT_DB_PATH` 再动态 import），验「不足上限不裁 / 超量裁掉最旧的 / 保留条数与留下的是哪些都对 / 幂等 / 非法 keep 不碰库」——**不拿真实记录做实验**，跑完连 WAL 一起删。**15/15**。
- `probe-llm.ts`：新增第 8 节断言 `stream_options` 的**真实报文**。为此给 mock 上游加了调试钩子 `GET /__last-body`（记录最近一次 chat/completions 的请求体）——「请求成功」在开 / 关两种模式下都会通过，只有报文能区分。**32/32**。
- `probe-providers.ts`：新增第 9 节（开关的 HTTP 层读写 + 非布尔 400）。**52/52**；并修掉一条**隐含依赖环境**的断言：`新建方案不抢默认` 在**空库**上必然假失败（空库首条自动成为默认是设计行为），改成先显式造出「已有默认」这个前提，空库与有方案两种状态都跑通。
- `verify-chat.mjs`：`Dexie 已升到 v2` 的断言写死了 `"version":20`，v3 后失效。改为**解析出数值**断言 `30`，并**顺手验得更实** —— 把 v3 引入的三元复合索引 `[sessionId+createdAt+id]` 取出来断言（光比版本号分不出「升到了 v3」和「v3 的 stores 写错了」）。**36/36**。
- `verify-providers.mjs` **22/22**、`verify-diagnostics.mjs` **36/36**；两端 `typecheck` + `web` 构建通过。
- 启动冒烟：空库 + env 种子 → 首次导入；`PATCH streamOptions=false` 落库并在报文里生效；删光方案重启 → **种子不复活**；Node 22 启动被门禁拦下并给出一句人话。

**本次踩到的坑（工具行为，不是代码）**

- 编辑工具本轮**4 次「报成功但没落盘」**（`profiles.ts` 的 `updateProfile`、`routes/providers.ts` 的 `parseCreateInput`、`mock-openai.ts` 的变量声明）。前两次是类型检查 / 第一次冒烟测试才发现 —— 后来都靠 grep 回读。→ **改完关键处一律 grep 回读**。
- `schema.ts` 的注释写明了正确判据（「不能用表为空当判据」），但实现没跟上。**注释与实现不一致比不写注释更危险** —— 它会让后来的人以为已经做过了。

### Phase 2 · Home 生活模块（完成）

**shared / 本地数据**

- 补齐十类 Home 实体：留言、愿望、倒数日、日记、收藏、作品、相册、读书笔记、音乐条目与学习记录；共同继承 `BaseObject`。
- Dexie 从 v3 升到 v7，新增十张 Home 表与稳定索引；每次升级完整重复旧表声明，既有聊天与生活数据不丢。
- `Bookmark.targetType + targetId` 继续作为统一收藏关系，目标类型覆盖所有已落地的可收藏实体。

**web**

- `/home` 的十个入口全部从占位页变成可用模块；统一具备加载、空态、错误态与 Tokens 驱动的移动端简单 UI。
- 留言、愿望、倒数日覆盖新增 / 状态 / 删除；日记、作品、读书、音乐、学习覆盖新增 / 编辑 / 二次确认删除；收藏提供外部 HTTP(S) 链接入口并按目标复合唯一索引去重；相册保存实际图片并可删除。
- 相册仅接受 PNG / JPEG / WebP / GIF，单张不超过 3 MB；仓储与备份导入同时核对 MIME、base64 语法、真实字节数与声明大小，拒绝 SVG、超限和伪造体积。
- 音乐与作品外链只允许 HTTP(S)，新窗打开统一带 `noreferrer`；学习时长限定为 1–1440 分钟整数。

**备份 / 兼容**

- JSON 备份格式从 v1 升到 v5，最终覆盖聊天与十类 Home 数据；恢复保持「先全量校验、再单事务整体替换」语义。
- v1–v4 旧备份均可导入，后续版本新增表按空处理；危险链接协议、非法阅读状态 / 学习字段与不安全图片会在动库前被拒绝。

**验收**

- `web/scripts/verify-home.mjs` 最终 **23/23**：十入口、各模块主路径、刷新持久化、备份 v5 自恢复、v1–v4 兼容、恶意数据拒绝、Dexie v7 表形状与控制台零异常。
- 聊天完整回归 **36/36**；两端 `typecheck` 与前端生产构建通过。
- 已知边界：相册 data URL 有约 33% base64 膨胀；生活模块暂按个人早期数据量全量读取。后续优化已收敛到 `docs/TASKS.md`。

### Phase 3A · 长期记忆链路（客户端代码已验，T-013）

**shared**

- `providers.ts`：`MemoryProvider` 从「`unknown` 占位」定成真实契约 —— 六个方法（`recall` / `search` / `read` / `create` / `update` / `delete`）统一收口到 `MemoryTextResult`（`{ text }`）。
  - 刻意**不按 Nocturne 的内部数据库 schema 建模**：它的工具返回的是「给模型读的文本」，我们只做转交 —— 它改内部结构不会牵动我们的类型。
- `MemoryCreateInput` / `MemoryUpdateInput`：`update` 的「精确 / 块替换」与「追加」互斥，Nocturne **刻意不提供全文覆盖**。这条约束写在类型注释里，而不是指望调用方自觉。

**server**

- 新增 `providers/nocturne-memory.ts`：`MemoryProvider` 的 MCP 实现（MemoryProvider → ToolGateway → Nocturne MCP），**不碰它的 REST**（铁律 4）。
- 新增 `routes/memory.ts`：6 个端点 `boot` / `search` / `read` / `POST` / `PATCH` / `DELETE`；参数校验从严（`domain://path` 形式、`system://` 只读、三种修改模式互斥）；**未配 MCP 时返回 502，语义是「设计行为」而非故障**。
- `mcp/registry.ts` / `main.ts` / `.env.example` 接上记忆服务配置；`mcp/mock-server.ts` 扩容出记忆工具，让写路径能在**不连外网**的前提下验。

**验收**

- `server/scripts/probe-memory.ts`：本地 mock 全链 **24/24**（boot / search / read / create / update 三种模式 / 参数校验 / read-before-write）。
- `server/scripts/probe-nocturne-demo.ts`：**真实**打 Nocturne 官方只读 Demo **25/25**（连跑两次一致）。分两段跑，为的是「卡在哪一层能判」——先原始 SDK 直连隔离协议层，再经 `McpGateway` 验我们自己的生产代码路径。
  - **选官方 Demo 的理由**：官方 README 写明该实例服务端只开放 `read_memory` / `search_memory` —— **只读由服务端物理保证**，比调用方自觉可靠。
  - 真实协议事实：`serverInfo = Nocturne Memory Interface v1.26.0`；工具清单恰好 2 个；`search_memory` 的真实 `inputSchema` 是 `query, domain, limit`，与我们适配器的参数映射**逐字对上**；`system://boot` 返回 8101 字正文。
- 再用真实 habitat-server 走一遍完整 HTTP 链路（独立临时库 + :3300）：四个 GET 全通，诊断表 3 条、`errorCount=0`。
- **全程只读** —— 用记录型包装统计实际发出的调用，仅 `read_memory` ×1 + `search_memory` ×1；临时库与临时进程跑完即清。

**未结清**：本轮验的是**客户端代码**，不是自部署实例。Bearer Token、`X-Namespace`、Caddy 反代与内网回源四段仍未走，风险 1 未结清 —— 但它**不阻塞** UX 收口。

### 文档体系对齐（T-014）：引入 PRODUCT_SPEC 作为产品行为权威

**零代码改动**（故未跑 typecheck）。

- **`PRODUCT_SPEC` 落位**：原文件在仓库根、名为《栖息地_PRODUCT_SPEC_交互定义_v0.1_结构草稿.md》，而 AGENTS / TASKS / REFERENCES 三处引用的都是 `docs/PRODUCT_SPEC.md` —— **引用是断的**。已移入 `docs/`。
- **`AGENTS.md` 修复**（上一轮改版留下的 5 处表格损坏 + 2 处信息丢失）：§2 折行断表、§4 表头 4 列而分隔行 3 列、§4 两行**黏连**、重复的 UI 行；补回 3 行仍有效的任务与「维护约定」小节。
- **`README.md` 承接「本地验收」**：把原 AGENTS §6 里的高价值前置条件（Node 双轨约束、验收要换端口、vite 必须 `--host 127.0.0.1`、后台进程会被回收）按项目分工移入 README，并补上 Phase 3A 新增的两个探针。
- **`docs/API.md` 补 6 个记忆端点** —— 补上此前欠的维护约定（新增接口 → 同步 API.md）。
- **`docs/TASKS.md` 登记 PRODUCT_SPEC 差异**：P0（14）/ P1（6）/ P2（6），每条带 SPEC 章节引用；**不复制产品定义正文**，避免与 SPEC 双写。

### UX 收口 · P0 第一批（T-015）：消息对象操作

**前置：先把 SPEC 里悬置的语义定下来**（产品行为的家是 SPEC，不该只躺在 TASKS 里）

1. 编辑**保留原版本**，复用 `candidates`（`origin: 'edit'`），与「换一个」共用同一套 `‹ n/N ›` 版本导航 —— 不另造第二套历史
2. 编辑用户消息后**不自动删除、不自动重生成后续**；「从这条重新生成」是显式动作，且必须二次确认
3. 撤回**留痕、不进模型上下文、可恢复**；删除**物理删除 + 二次确认**，不另做回收站（兜底交给备份导出）
4. 用户消息与 AI 消息**权限完全对等**

**本地数据**

- **零 schema 改动，Dexie 不升版**：Phase 1 建表时按技术方案 §6.3 的「两次提前量」已预埋 `candidates[].origin`（本就有 `'edit'`）、`recalledAt`、`editedAt`、`pinnedAt`。
- `db/chat.ts`：抽出 `withNewVersion(message, content, origin)` 供 `addVersion` 与 `editMessage` 共用。
  - 原先「登记旧版本 → 追加新版本 → 淘汰最旧」只长在「换一个」这一条路径上；复制一份必然漂移（典型是某条路径忘了版本上限，版本数没有天花）。
- 新增 `editMessage`（内容未变则不新增版本）/ `recallMessage`（只写 `recalledAt`）/ `restoreMessage`（置回 `null`）/ `deleteMessages`（批量物理删）。

**web**

- 新增 `features/chat/ChatBubble.tsx` 与 `features/chat/MessageActionSheet.tsx` —— 气泡原先整个长在页面里，页面已涨到 1058 行，拆完 755 行。
- 菜单**关闭时不渲染任何 DOM**：否则验收脚本整页读 `innerText` 会被藏起来的菜单项骗到。
- 交互入口三合一：长按（移动端主路径）+ 右键（桌面）+ `···`，三者进同一个菜单。刻意**不给每条消息都挂一行** —— 60 条各加一行会把列表撑高约 1.1 屏。
- **「撤回不进上下文」只有一处落点**：`historyUpTo` 的过滤。刻意不放进 `messageText()` —— 那里是「取纯文本投影」，与「这段该不该送出去」是两件事，混进来会让所有复用它的地方（列表预览、版本登记）被动改行为。
- 共用一条二次确认条（撤回 / 删除 / 批量删 / 从这条重新生成），配轻提示反馈（已复制 / 已撤回 / 已恢复 / 已删除 N 条）；破坏性操作的确认语一律说清后果与条数。

**验收**

- `web/scripts/verify-chat.mjs` **36 → 57 项全过**。新增 21 项中最硬的一条是**读 mock 上游的真实报文**（`GET /__last-body`）证明撤回的消息确实没被送出 —— UI 藏消息很容易，送没送出去才是关键。
- `verify-providers.mjs` 22/22、`verify-home.mjs` 23/23、`verify-diagnostics.mjs` 36/36，**无回归**；四条均「控制台零异常」。
- 两端 `typecheck` + 前端生产构建通过。
- 顺带补上 `.workbuddy/run-front-verify.sh` 漏跑的 `verify-home`（此前 README 说四支、实际只跑三支）。

**踩到的坑（已进 `docs/TASKS.md`）**

- **点完「发送」不能立刻等「按钮变回发送」**：React 状态更新是异步的，按下那一瞬间等待条件就成立，紧接着读到的是**上一轮**的报文 —— 两条断言因此假失败。判据必须是「这一轮的回复已经落地」。
- **`document.querySelector('textarea')` 会抓错框**：内联编辑态会在 DOM 更靠前的位置放一个 textarea。输入框一律用 `[data-testid="composer"]` 定位。
- **编辑工具静默失败（第 2 次遇到）**：三处替换报「成功」但文件没变，靠类型检查兜住。

### UX 收口 · P0 第二批（T-016）：跨模块内容流转

**做了什么**：打通「在原内容位置直接收录」的操作链 —— 聊天消息 → 收藏中心、聊天消息 / 组件 → 作品、聊天图片 → 相册。

- **零 schema / 零平行模型**：收藏继续用 `Bookmark.targetType + targetId`，作品 / 相册继续用统一基座 `sourceId + sessionId`；Dexie 保持 v7。
- `db/home.ts` 新增消息收藏、消息 / 组件作品快照、聊天图片批量入相册；消息 / block 走**稳定身份去重**，图片在写事务前完成格式、体积与可读性校验（避免半批写入）。
- 三类目标条目都保存来源（消息 / 会话、角色、原始时间、block 类型 / 位置），Home 三个模块统一显示来源并可回到原会话。
- 菜单按内容动态生成：未撤回消息显示「收藏 / 收录至作品」，只含顶层 `image` block 的消息才多一个「加入相册」。
- 失败不污染控制台错误基线：重复收录、远程图片不可读、格式不支持、超限，各自给出具体原因。

**验收**：`verify-chat.mjs` **57 → 74 项全过**（含三条原位收录链路、组件快照、重复与失败反馈、IndexedDB 来源字段与图片 block 位置、三个目标页的「查看来源」）；其余三支 22/22、23/23、36/36 无回归。

### UX 收口 · P0 第三批 A（T-017）：会话置顶 + 聊天设置入口

**做了什么**

- **会话置顶**：列表原位「置顶 / 取消置顶」，复用 `pinnedAt`，置顶项排在普通项之前；**不改 `updatedAt`**，取消后回到原本的消息活跃顺序。
- **聊天设置入口**：聊天顶栏右侧「设置」，轻量面板维护当前会话**备注 / 背景 / 气泡模式**（`chat` / `native`），保存即时生效且可回读。
- **零 schema**：完全复用 `ChatSession.pinnedAt / remark / background / bubbleMode`，Dexie 保持 v7。
- 回归稳定性：Home 验收在异步编辑保存后先等界面确认再刷新，消除随机抢跑。

**验收**：`verify-chat.mjs` **74 → 84 项全过**；其余三支无回归；两端 `typecheck` + 前端生产构建通过。

### UX 收口 · P0 收尾（T-018）：会话分组（Dexie v8）—— **P0 至此全部收口**

P0 里**唯一需要迁移本地数据结构**的一项（`ChatSession` 原本没有 `groupId`）。

**开工前先定 SPEC 里没写全的语义**（产品行为的家是 SPEC）

1. **置顶优先于分组**：置顶会话统一浮到列表最顶、**脱离原分组显示**，取消后回落到原分组。`groupId` 不因置顶改写 —— 是「显示上的浮动」而非「搬走」，所以两条规则都不需要额外历史记录来还原。
2. **未分组区是兜底区**：不只收 `groupId === null`，**也收 `groupId` 指向已不存在分组的会话**。写入侧保证不产生悬空引用，但导入备份与手工改过的库不受控 —— 兜底放渲染层，任何新读取点都不会漏掉会话。

**施工前实查 4 个参考项目（结论：没有现成可抄的）**

`chatnest` / `cc-companion-app` / `the-house` / `polaris-local-first` **都没有会话分组或文件夹**。分组按 SPEC 自己的定义做，只借 the-house 一点：**管理操作就地放在列表项上**，不跳二级页面。

**本地数据**

- `shared/types.ts`：`ChatSession.groupId: string | null` + 新实体 `SessionGroup`（`name` / `collapsed`）。折叠状态跟着数据走而非 UI 局部状态，刷新与换设备都一致。
- **Dexie 升 v8**：`sessions` 加 `groupId` 索引 + 新增 `sessionGroups` 表，且是**第一个带 `upgrade()` 回调的迁移** —— 给所有老会话补 `groupId: null`。
  - 为什么不「读的时候把 `undefined` 当 `null` 容忍」：那样「会话一定有 `groupId`」这条不变量只存在于**读取方的记忆**里，任何忘记兜底的新读取点都会让会话从列表里凭空消失。
- `db/chat.ts` 新增 `listSessionGroups` / `createSessionGroup` / `renameSessionGroup` / `deleteSessionGroup` / `setSessionGroupCollapsed` / `setSessionGroup`。
  - `deleteSessionGroup` 在**同一事务**里把组内会话 `groupId` 置回 `null` 再删组（分两步会留下「指向已不存在分组」的中间态），并返回移出条数供确认语使用。
  - `setSessionGroup` 校验目标分组存在；移入移出**不刷新 `updatedAt`**（换分区不代表这段对话又活跃了，否则整理一次分组就把整个列表的活跃顺序搅乱）。

**web**

- `MessageActionSheet` 提升为通用 `components/ActionSheet.tsx` —— 消息气泡与会话行**共用同一个菜单**（SPEC §1.3 要的「同一套操作逻辑」）；testid 不变，老断言不用动。
- 新增 `features/chat/GroupNameSheet.tsx`（创建 / 重命名共用，不用原生 `prompt`）。
- `ChatListPage` 重写为「置顶区 → 各分组 → 未分组区」；会话行的置顶 / 分组 / 删除收进 `⋯` 菜单，分区标题可折叠 + `⋯`（重命名 / 删除，删除二次确认写清条数）。
  - **不给每条会话行并排三个按钮**：会话本身带标题，三个按钮会把长标题挤成省略号。
  - **一个分组都没有时不渲染任何分区标题**：不用分组的人不该凭空多出一层。

**备份格式升 v6**

导出带上 `sessionGroups`；导入接受 v1–v6，旧版分组按空处理、会话 `groupId` 补成 `null`。顺带把「每加一版就往白名单补一个数字」的版本判据改成**区间判据**（漏补的后果是升级后自己的旧备份反而导不进来）。

**验收（全部实跑）**

- `verify-chat.mjs` **84 → 107 项全过**。新增 23 项覆盖：空名不可保存、分组落库、未分组会话的菜单项集合、移入后**按 DOM 顺序**确认夹在该分区与未分组区之间、分区计数、`updatedAt` 不漂移、折叠后不渲染 + 落库 + **刷新后保持**、置顶浮顶且离开原分区、取消置顶回落、移出分组、重命名预填与落库、删非空组确认语含条数且**会话不丢**、删空组确认语不带条数、**脏 `groupId` 会话不消失**、无分组时回到平铺。
  - 另升级 2 项：Dexie 版本断言改为 v8，并**顺带验这次迁移该带来的东西**（`sessions.groupId` 索引 + `sessionGroups` 表）—— 只比版本号分不出「升到了 v8」和「v8 的 stores 写错了」（T-008 的教训）。
- `verify-home.mjs` **23 → 25 项全过**：备份断言升 v6，新增「备份带走分组与归属（含折叠状态）」与「旧 v5 备份仍可导入：分组为空、会话补成未分组」。
- `verify-providers.mjs` 22/22、`verify-diagnostics.mjs` 36/36；两端 `typecheck` + 前端生产构建通过；四条均「控制台零异常」。

**踩到的坑（都在验收脚本自己身上）**

- ⚠️ **`?? 'missing'` 会把要验的 `null` 一起吞掉**：`legacyV5Session?.groupId ?? 'missing'` 里 `groupId` 恰好就是 `null`，断言**永远不可能通过**，报出来还像「对象没找到」。→ 断言某字段可能为 `null` 时，别让「缺失」与「null」走同一个 `??`。
- ⚠️ **等「菜单关了」等于没等**：会话行菜单开着时列表并未卸载，`⋯ 又出现了` 这类条件会**瞬间成立**（假通过）。→ 判据要挂在「这次操作真的落地」的信号上（本例用轻提示）。

### P1 第一批（T-019）：输入区快捷操作栏 + 请求回复拆开

**开工前先定 SPEC 里悬着的语义**（§2.4.3 原文写着「最终默认行为可在后续 UX 验收中决定」）

1. **默认仍是「发送并请求回复」** —— 主按钮不变。把聊天主路径改成两步（发一条 → 再点请求回复）是拿最高频的操作去补贴低频的。
2. **主按钮不随状态改名** —— 一度想过「输入框为空且有待回复消息时主按钮变『请求回复』」，放弃了：一个按钮两副面孔会让人每次点之前都得先看它现在叫什么；而且验收脚本靠按钮文案定位「发送」，改名会让一批既有断言失去锚点。
3. **「待回复」用消息序列推导，不加字段** —— 从末尾往回数连续的 `user` 消息，撞到 `assistant` 即停。
4. **语音条不做假功能** —— 要么真录真发，要么不做。转写（ASR）没有，就如实记为缺口。

**开工前先跑了一个一次性探针**（写代码之前）

- 确认**无头 Edge 能不能真录音**：加 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` 后 `getUserMedia` 拿得到轨道，1.2 秒录出 12000 字节 `audio/webm;codecs=opus`。**这一步决定了语音条是「真做 + 真验」还是「降级」。**
- 顺带测出 Edge（Chromium）**不支持 `audio/ogg;codecs=opus`** —— 所以代码里备的是 webm/opus → webm → mp4 候选链，只写一个 ogg 会直接抛 `NotSupportedError`。
- 探针本身踩到：CDP 里 `about:blank` **不是安全上下文**，`navigator.mediaDevices` 整个是 `undefined`，必须先 `Page.navigate` 到一个 http 页面。

**零 schema 改动（Dexie 保持 v8、备份保持 v6）**

- **`PRODUCT_SPEC.md` §2.4** —— 快捷操作区从「暂定包含」定为四项；新增 §2.4.4 语音条契约（内联 data URL / 60 秒上限 / 时长落库 / 与文本同链路 / 失败必须明说），并**如实写下转写缺口**。
- **`web/src/lib/format.ts`（新）** —— `formatDuration(ms) → m:ss`。放 `lib/` 而不是塞进组件：时长要在气泡、对话上下文占位、收藏快照三处用。
- **`web/src/features/chat/Composer.tsx`（新）** —— 输入区整体抽出（快捷栏 / 表情面板 / 更多菜单 / 录音态）。抽出边界：这一层**只负责「怎么输入、点了什么」**，不知道消息怎么落库、也不知道生成怎么跑。
  - 表情插入落在**光标处**并用 `requestAnimationFrame` 重设选区 —— 不这么做，连续点两个表情会全挤在最前面（React 的受控回写会把刚设好的选区冲掉）。
  - 录音失败分两种说法：「环境不支持」（非安全上下文里 `mediaDevices` 整个是 `undefined`）与「你拒绝了权限」。
  - 录音态那个按钮叫**「发出」不叫「发送」** —— 全局唯一的「发送」主按钮是输入区那个，多一个同名按钮会让按文案定位的验收脚本抓错对象。
  - **生成中不提供「只发送」**：发送链路在 `sending` 时直接返回，留着这一项等于给一个点了没反应的按钮。
- **`ChatWindowPage`** —— `send()` 拆成 `submitUserMessage()`（落库 + 起名 + 按模式决定要不要生成）加 `send()` / `requestReply()` / `sendVoice()`；新增 `countUnreplied()` 与 `voicePlaceholder()`。
  - `historyUpTo` 给语音条补占位 `[语音条 0:03]`：语音条没有文本投影，直接送等于让模型对着空白答话。**只补语音条，不动图片 / 文件** —— 那是既有行为，改它属于另一件事。
  - 顺带修掉一个既有小 bug：原先首条消息无条件 `titleFrom(text)`，语音条会**把会话标题改空**；现在只有 `text !== ''` 时才起名。

**顺带修掉一个真 bug：用户侧气泡只渲染纯文本投影**

`ChatBubble` 里用户侧写的是 `<span>{messageText(message)}</span>`，AI 侧才走块分发。等于把「用户只能发纯文本」这条假设写死在渲染里 —— **语音条（`audio` 块）与图片会被画成空气泡**：数据在库里、上下文里也有占位描述，界面上却什么都不显示。

改为**两侧都走块分发**。`TextBlockView` 本身就是 `whitespace-pre-wrap break-words`，比原来的 `whitespace-pre-wrap` 只多一个断词，所以这不是「能力补齐」，是**把分叉去掉**。

> 抓到这个 bug 的是验收里那条「气泡上显示语音时长」——它本来是顺手加的视觉断言，结果成了唯一发现渲染层完全没走通的证据。**只验数据不验渲染，语音条会以「全部断言通过」的样子交付出去。**

同一条线上还漏了第二次：播放器补上之后，**「元素在」断言全绿，但它在气泡里被压成了一条约 40px 的窄条**（气泡是收缩宽度块，`w-full` 在这种上下文里解成极小值）。
是**回头看了截图**才发现的。补了一条量真实渲染宽度的断言（`>=180px`）——**「元素在不在」和「它长没长出来」是两条独立的断言**。

第三次是同一个根因的另一面：把块视图从「只服务 AI 侧」挪到「两侧都用」之后，
里面硬编码的 `--color-text-dim` 在用户气泡的深底上变成了**深底深字**（睁眼看才知道）。
改用继承文字色 + `opacity`，并补了一条断言比对「时长文字色 == 气泡文字色」。
> 三次都在同一件事上：**把只在一个上下文里长出来的组件搬到第二个上下文，颜色 / 尺寸 / 宽度这类「隐含前提」会集体失效**，而它们全都不在类型系统里。

**「这一轮是否收尾」的判据也修了**

`waitIdle()` 原先的条件是「页面上有没有一个文案是『发送』的按钮」—— 那个按钮**一直都在**（只是无内容时 disabled），所以条件在手指刚点下、生成还没启动的一瞬间就成立，**等于没等**。8 处调用其实都在抢跑，只是恰好被后面的显式等待兜住。
改成读库：**最后一条消息是 `assistant` 且已定性**（`done` / `error` / `aborted`）。选「已定性」而不是「有文字」，因为中止保留半截内容是合法收尾。

**验收（全部实跑）**

- `verify-chat.mjs` **107 → 134 项全过**。新增 27 项覆盖：快捷栏四项齐、无消息时「请求回复」不可用、默认发送仍是一步拿到回复、菜单项集合、
  **「只发送」后上游报文一字未变**（读 mock 的 `GET /__last-body`）、待回复条数与提示条、
  连续只发送两条后一次「请求回复」把**整批**送出且只补一条回复、菜单项按状态增减、插入当前时间、清空输入、
  连续点两个表情按顺序插入、录音计时、语音条落成 audio block 且是 `data:audio/` 前缀、时长 ≥1 秒、
  **语音条默认也请求回复**、**上下文里出现 `[语音条 ` 占位**、气泡显示时长、
  **播放器有正常宽度（`>=180px`）**、**时长文字继承气泡文字色**、取消录音不留痕。
- `verify-home.mjs` 25/25、`verify-providers.mjs` 22/22、`verify-diagnostics.mjs` 36/36，**无回归**；四条均「控制台零异常」。
- 两端 `typecheck` + 前端生产构建通过。
- `.workbuddy/run-front-verify.sh` 给组一的无头 Edge 补上两个假麦克风开关（缺了它们录音断言会全线失败，但那是环境问题不是功能坏了）。

**踩到的坑**

- ⚠️ **断言「没发生某件事」必须等够时间**：「只发送不请求回复」这一类，读完报文前要留出让「万一真的发了」到达 mock 的窗口，否则断言是在抢跑里通过的。
- ⚠️ **`vite build` 在第二次及以后会被沙箱的安全删除拦截**：产物目录已有超过阈值的文件，构建前 `emptyDir` 清空它 → 撞拦截。症状具有欺骗性：**第一次构建成功，之后就再也构不出来**，很容易误判成「代码改坏了」。解法是跑构建前 `export NODE_OPTIONS=""`（已补进 `sandbox-node-dev-server` 技能）。
- ⚠️ **「元素在不在」和「它长没长出来」是两回事**：语音条播放器补上后元素断言全绿，实际却被收缩容器压成 40px 的窄条 —— 是回头**看截图**才发现的。**任何新增的视觉元素，断言里至少要量一个尺寸**，别只 `querySelector(...) !== null`。

### P1 第二批（T-020）：主屏 Widget —— 留言板 / 倒数日（Dexie v9 / 备份 v7）

**做了什么**

Home 主屏从「纯功能入口列表」开始长出展示层：留言板与倒数日可以「钉」到主屏（SPEC §1.4 / §3.2.2 / §3.3.2 / §5.2）。
这是 P1 里**第一次动 schema**（T-019 是零 schema 改动）。

**定下来的语义（写进 SPEC §1.4 / §3.2.2 / §3.3.2 / §5.2）**

- **Widget 只存引用，不复制数据** —— 卡片内容永远从 `moments` / `countdowns` 实时读。主屏上放的是「指向某个倒数日」这样的**指针**，所以倒数日被删了卡片不会留着一份旧快照，也不存在两份内容不一致。
- **每种 Widget 至多一张**。换一个倒数日上主屏是**改引用**（不新增记录、**不改 `createdAt`**，卡片位置因此不跳）。这条不变量**交给 schema**：`&kind` 唯一索引，而不是靠每个写入点自己记得先查一次 —— 漏一处就会出现两张倒数日卡片，而这种 bug 只在「换一个上主屏」时才显形。
- **被引用的实体消失时卡片一并消失**，两层兜底：删倒数日时**同事务**清掉指向它的 Widget；渲染层对「指向不存在实体」的脏引用一律不渲染。这与会话分组的「未分组兜底区」是同一思路 —— 第二层防的是导入的备份带进来的脏引用。
- **主屏位置**：问候语之下、功能入口之上；一张 Widget 都没有时**整个区域不渲染**（没放 Widget 的主屏要和「没有这项功能」时一模一样，不能留一条空标题）。
- **v0.1 范围**：留言板 Widget 只做「最近 3 条 + 查看全部」。SPEC §3.2.2 还写着「指定分组 / 指定留言」，但那两者依赖留言条自身还没有的分组与单条选取能力（§3.2.1 的「分组」同样未实现）—— **不预先放一个只有一个选项的下拉框**。

**本地数据**

- `shared/types.ts`：新增 `HomeWidget { kind: 'board' | 'countdown'; refId: string | null }`
- **Dexie 升 v9**：新增 `homeWidgets` 表。**纯新增表、不需要 `upgrade()` 回调** —— 它对留言板 / 倒数日只是多了一条引用，没动那两张表的任何字段（与 v8「必须补字段」形成对照）
- `web/src/db/home.ts`：`putHomeWidget`（已存在就走改引用）/ `removeHomeWidget` / `listHomeWidgetViews`（**装配好的卡片**，脏引用在这里被滤掉，渲染层不必各自判一次）/ `listHomeWidgets`；`deleteCountdown` 改为同事务清理引用
- **备份格式升 v7**。⚠️ 导入时**必须按 `kind` 去重**：`&kind` 是唯一索引，手改过的备份（例如两条 `board`）会让 `bulkAdd` 抛 `ConstraintError`，**整份备份一个字都导不进去**。保留 `createdAt` 最早的那条，与「先上主屏的在前」的排序语义一致。

**web**

- 新增 `features/home/HomeWidgets.tsx`：主屏承载区 + 两种卡片（没有 Widget 时返回 `null`，连 `<section>` 都不渲染）
- 新增 `features/home/countdownDays.ts`：`dayDistance` / `distanceLabel` 从 `CountdownModule` 抽出来 —— 同一个日子在模块页与主屏算出不同的天数，是用户一定会发现、也一定会先怀疑「哪个才是对的」的那种问题
- `BoardModule` / `CountdownModule` 各加「上主屏 / 已在主屏」入口；`HomePage` 接入承载区并给入口列表加了 `data-testid="home-entries"`（断言 DOM 顺序要一个稳定锚点）

**验收（全部实跑）**

- `verify-home.mjs` **25 → 46 项全过**。新增 21 项覆盖：没有 Widget 时主屏不长出该区（**界面与数据层两侧都断言**）、倒数日送上主屏、
  **Widget 区在问候语之下 / 功能入口之上**（用 `compareDocumentPosition` 量 DOM 顺序，不是看文案）、卡片展示名称 / 日期 / 剩余天数、
  点卡片进模块页、**换一个上主屏只有一张卡片且 `createdAt` 不变**、两张卡片按上主屏先后排列、留言板 Widget 内容与快捷入口、跨刷新保留、
  **删掉正被引用的倒数日时「记录本身」也被清掉**（读库断言，不是看界面 —— 界面消失可能只是渲染层兜底）、
  脏引用不渲染且不影响别的卡片、删掉之后仍可重新上主屏、撤下一张不影响另一张、全部撤下后区域消失、
  **备份 v7 带走 Widget（引用原样保留）**、旧 v6 备份导入后主屏为空。
- `verify-chat.mjs` **134 → 135 项全过**：版本断言升到 v9，并**加一条验 `homeWidgets.kind` 是不是唯一索引** ——
  唯一性只能从 `index.unique` 上读，光看索引名 / 数索引个数都分不出来，而它正是「每种 Widget 至多一张」的保证所在。
- `verify-providers.mjs` 22/22、`verify-diagnostics.mjs` 36/36，**无回归**；四条均「控制台零异常」。
- 两端 `typecheck` + 前端生产构建通过。

**踩到的坑**

- ⚠️ **在模板字符串内部的注释里写反引号，会把模板提前闭合**：验收脚本的 `evaluate(\`...\`)` 是一大段模板字符串，我在里面的 JS 注释里用反引号包了个表达式，整个文件语法直接崩，而报错指向的是**两百行之后**的那行 `missing ) after argument list`。教训：**报错行不一定是出错行**；定位手段是分段 `node --check`（`sed -n '266,464p' > part.mjs`）把范围切出来。
- ⚠️ **验收脚本里「按全局选择器等状态」很容易等出一个假通过**：页面上有多个倒数日时，等 `[data-on-home="false"]` 会被「本来就没上主屏」的那一条**瞬间**命中 —— 等待条件一上来就成立，等于没等。改成按行文本查**那一条**的状态。这与 T-018「等『菜单关了』等于没等」是同一类错误，只是换了个伪装。

---

### P1 第三批（T-021）：收藏分类 + 相册分类（Dexie v10 / 备份 v8）—— **P1 至此全部 6 项完成**

**定下来的语义（写进 SPEC §3.5.4 / §3.7.3）**

- **单归属**：一条收藏最多属于一个分类，一张照片最多属于一个相册；`categoryId` / `collectionId` 为空即「未分类」。
  这是**收纳**维度，不是**标记**维度 —— 想让一条内容同时挂多个维度，那是后续「标签」要干的事，
  让分类兼任标签，两边都会变得难用。**这个边界现在就划清**，等分类里塞了几百条再改，迁移代价换来的是用户已经养成的手感。
- **删分类不删内容**：删一个非空分类，类内条目在同一事务里回到「未分类」（与 §2.1.3 删会话分组完全同构）。
  用户点「删除分类」时想删的是**容器**，不是里面的东西 —— 一个不小心连内容一起删掉的分类，是没人敢用的分类。
- **未分类是兜底区**：不只是 `null`，**指向已不存在分类的脏引用**也归这里。第二层防的是导入的备份、或手改过的库
  （与会话分组 / Widget 脏引用同一思路，这已经是本项目第三次用这个模式了）。
- **界面用顶部筛选条**（`全部 / 未分类 / 各分类`），点一个只看这一类；分类的增删改收进筛选条旁的「⋯」。
  **不给条目做纵向分区**：收藏卡片本来就高，靠筛选翻找比靠滚动分区快；分区还会让「一条内容属于哪个区」变成界面上必须回答的问题。
- 相册专有一条：**「移出相册」与「删除照片」是两个动作，不能合成一个**。移出只把归属置空；合成一个的话，
  用户想「把这照片挪出来」时会以为只能删，而删下去照片就真没了 —— 这是本模块唯一不可逆的操作，必须让它只能被明确选到。
- 相册的**量词是「张」**、收藏是「条」。删除确认语里带出数量，量词用错（「1 条照片回到未分类」）会让用户先怀疑是不是删错了东西。

**本地数据**

- `shared/types.ts`：新增 `BookmarkCategory { type:'bookmark-category'; name }` / `PhotoCollection { type:'photo-collection'; name }`；
  `Bookmark` 加 `categoryId: string | null`，`Photo` 加 `collectionId: string | null`。
  **用 `null` 而不是「没有这个字段」表示未分类** —— 让「归属字段一定有值」成为一条可以读出来的事实，而不是只活在读取方的记忆里。
- **Dexie 升 v10**：`bookmarks` 加 `categoryId` 索引 + 新增 `bookmarkCategories` 表；`photos` 加 `collectionId` 索引 + 新增 `photoCollections` 表。
  **带 `upgrade()` 回调**给老数据补 `null`（同 v8 的理由 —— 与 v9「纯新增表不需要回调」形成对照：判据是这个改动会不会让老记录缺字段）。
- `web/src/db/home.ts`：`listBookmarkCategories` / `createBookmarkCategory` / `renameBookmarkCategory` / `deleteBookmarkCategory` / `setBookmarkCategory`，
  相册侧同构一套；名字统一走 `normalizeCategoryName`（trim + 非空 + ≤30 字）；`delete*Category` 返回**移出条数**供确认语使用。
- **备份格式升 v8**：带走两张分类表与归属字段；旧版（≤v7）导入时两张分类表按空处理、归属补成 `null`（落进「未分类」）。
  校验函数 `looksLikeBookmarkCategory` / `looksLikePhotoCollection` **只认 id / type / name**，不认多余的字段 —— 校验过严会让用户手改过的备份整份导不进去。

**web**

- 新增 `components/NameSheet.tsx`：把 `features/chat/GroupNameSheet.tsx` 提升为通用命名弹层，三处（会话分组 / 收藏分类 / 相册）共用，testid 统一 `name-sheet-*`。
  分类的名字输入形态和分组一模一样，没有理由存在三套。
- 新增 `features/home/categories.ts`（纯逻辑，无 React）：`countByCategory` / `filterByCategory` / `normalizeSelection`。
  `normalizeSelection` 管的是**当前选中的分类被删掉之后**把筛选拉回「全部」—— 否则页面会停在一个不存在的分类上、列表空着而用户不知道发生了什么。
- 新增 `features/home/CategoryBar.tsx`（自足组件）：筛选条 + 管理菜单 + 删除二次确认（原位变「确认删除？（N 条回到未分类）」）。
  **一个分类都没有时不渲染筛选条**，只留一枚「＋ 新建分类」—— 没有分类可筛的时候，一条「全部 / 未分类」的筛选条是纯噪音。
- 重写 `features/home/BookmarksModule.tsx` / `AlbumModule.tsx`：接入筛选条；条目「⋯」菜单含「移入分类 / 移出分类 / 删除收藏」。
  「移入 → ＋新建分类」用 `createToken` 信号把新建动作转交给顶部筛选条，避免在条目菜单里再长一个命名弹层。

**验收（全部实跑）**

- `verify-home.mjs` **46 → 75 项全过**。新增 29 项覆盖：空态（无分类时不渲染筛选条）、空名禁用、建分类落库、分类条数随归属变化、
  移入分类真的写入 `categoryId`、按分类筛选只出该类条目、**绕过界面往库里塞「指向不存在分类」的收藏后它落在「未分类」**（脏引用兜底，读库断言）、
  删非空分类确认语**带条数**、删空分类确认语**不带条数**、删除后类内条目回到未分类且**条数不变**、
  相册「移出 ≠ 删除」（移出后照片仍在、归属为空）、**备份 v8 带走两张分类表与归属**、旧 **v7** 备份导入后分类为空 + 归属补 `null`。
  Dexie 断言 `version === 90` → `100`，并加「version 10 的 stores 里确实有这两张新表」。
- `verify-chat.mjs` 135/135（Dexie 版本断言同步升到 v10）、`verify-providers.mjs` 22/22、`verify-diagnostics.mjs` 36/36，**无回归**；四条均「控制台零异常」。
- 两端 `typecheck` + 前端生产构建通过。

**踩到的坑**

- ⚠️ **编辑工具会「静默成功」**：本轮多次出现工具返回 `Successfully edited` 但文件实际没变（`shared/types.ts` 的类型没落地、`db.ts` 的 import 没落地、
  `CategoryBar` 的 `unit` prop 没落地、SPEC §3.7.3 整节没落地）。**一次「成功」不能当证据**：改完立刻 grep 核实，没落地就用 `sed -i` 兜底重做，最后靠 `typecheck` / 跑验收抓漏 ——
  SPEC §3.7.3 那节就是靠「收尾时回头核对文档」才发现的（验收全绿也不会暴露文档缺失）。
- ⚠️ **操作会改变当前筛选可见集合**：在「资料」分类下把那条收藏移出分类，它会立刻从列表消失，随后的「点这一行的菜单」全部找不到元素。
  操作归属之后要**显式把筛选切回「全部」**再继续 —— 这类 bug 的表现是「超时找不到元素」，很容易被误诊成渲染坏了。
- ⚠️ **量词是验收抓出来的**：相册删除确认语显示「1 **条**照片回到未分类」，是 `verify-home` 里那条断言先失败的。给 `CategoryBar` 加 `unit` prop
  （默认「条」，相册传「张」）才修好 —— 文案正确性靠肉眼 review 会漏，靠断言才拦得住。

## 2026-09-24

### Phase 3B · Eventide 状态与主动行为（T-023~T-025）—— **完成**

- Eventide 固定 revision，以无状态 Python sidecar 承担时间推进、状态卡、互动结算归一化、事件与梦境计算；
  Node SQLite 持有唯一可恢复状态，并串行化全部写入，避免并发聊天覆盖与时间倒退。
- 每轮聊天前注入隐藏状态卡；回复完整送达后异步跑结构化互动结算。状态侧故障只降级 / 留痕，不能把聊天变成单点故障。
- 落地宿主事件触发表：10 分钟节流、已有主事件不覆盖、冷却、固定时间窗口去重、称呼 / 关键词配置与刺激去重。
- 主动行为默认全关；开启后由同一调度器驱动唤醒、独处与梦境。唤醒进入服务端通知收件箱，独处与梦卡保持 AI 私有，
  不越过数据边界伪造前端消息或日记。
- BudgetGuard 在 LLM 调用前以 SQLite 事务预约预算，覆盖 API / Token / 费用、免打扰、静默、冷却、每日次数与连续未回复；
  用户回复会清零未回复计数。费用未定价时 fail-closed，不按 0 元放行。
- 新增 EventLog、通知底座、自动化策略 / 运行记录，以及余额与不可变流水同事务的钱包；Phase 4 可直接消费这些事实源。
- 补全 `PRODUCT_SPEC §9.5`、API / 数据模型 / README / AGENTS；全链探针 21/21，Eventide 回归 19/19。
- 验收发现并修复梦境时区暗坑：不能用 UTC `toISOString()` 判断本地夜间窗口，现按策略 IANA 时区传递显式 offset。

### Phase 4 · Life 数据可见（T-026）—— **完成**

- `/life` 从占位页升级为月历、账本、通知、运行四视图；移动端简单 UI 使用现有 Design Tokens。
- 月历只聚合 EventLog / UsageRecord，可按日期下钻；费用同时展示已定价金额与未定价次数，不用 0 元掩盖缺价。
- 新增不可变 PriceSnapshot 与 `usage_record.price_snapshot_id`：新价格可补齐未定价历史，但不重算已绑定快照的旧账。
- 钱包余额与不可变流水进入账本；历史 API 方案删除后仍按原 `profileId` 保留真实用量。
- 通知中心支持单条 / 全部已读；新增 Service Worker + VAPID Web Push，未配置 / 不支持 / 拒绝授权时安全退回站内收件箱。
- 运行页聚合 habitat-server、Eventide、MCP、当前状态与主动任务，明确区分正常 / 异常 / 未配置。
- 全链探针 16/16，真实浏览器 Life 验收 15/15，Phase 3B 回归 21/21；类型检查、构建与差异检查通过。

### Phase 5 · 高级消息能力（T-027）—— **完成**

- OpenAI-compatible Adapter 增加 ASR、TTS、视觉理解与图片生成；方案设置消费 `tts / transcription / vision / image` 四个媒体模型槽位。
- 语音条停止后先试听 / 重录 / 发送；真实转写写回 audio block 并进入上下文，失败保留原音且明确提示；AI 文本消息可手动朗读 / 停止。
- 聊天可直接选择图片并保存视觉描述，也可按提示生成图片；生成物仍是普通 image block，可继续加入相册或收录至作品。
- HTML 改为 `sandbox=""` + CSP iframe，widget / 单层 tab-group 正式渲染；没有注入主文档，也没有引入递归块或 Dexie 升级。
- 新增用户发起的 Mini Terminal：真实列出 ToolGateway 工具、展示参数 schema、显式确认调用，成功 / 失败均落 `tool-result`；AI 自主工具调用继续关闭。
- 补全 `PRODUCT_SPEC §9.6 / §9.7`，明确实时双工 / 主动拨号与逐次授权的 AI 工具调用不在 v0.1，邮件不建硬编码旁路。
- Phase 5 API 探针 8/8；浏览器 Chat 140/140、Providers 22/22、Home 75/75、Diagnostics 36/36；类型检查、构建与差异检查通过。

### Phase 6 · PWA（可安装 + 离线外壳）（T-028）—— **完成**

- 接入 `vite-plugin-pwa`，应用可装进主屏、断网也能打开外壳；`registerType: 'prompt'` + `injectRegister: null`，由应用自己注册并弹「有新版本」提示，不做静默替换。
- manifest 与三张图标（192 / 512 / 512 maskable）+ `apple-touch-icon`；图标由 Pillow + 系统 emoji 字体生成。
- Service Worker 与 Phase 4 的 Web Push 处理器**合并为一个**：手写的 `web-push-sw.js` 改为 `workbox.importScripts` 并入，避免同作用域两个 SW 互相顶掉。
- 预缓存 app shell 供离线开壳；`/api/` 排除在 `navigateFallback` 之外，断网时不会拿到 HTML 当接口响应。
- 开发期不启 SW（`devOptions.enabled: false`）；PWA 验收打生产构建产物，`verify-pwa` 25/25。

### Phase 6 · 离线只读（T-029）—— **完成**

- 新增统一错误码 `OFFLINE` 与 `assertOnline()`：所有请求都在 `lib/api.ts` 收口，离线时提前拦下并给出人话，而不是抛出 `TypeError: Failed to fetch`。
- 离线横幅说清边界（本地内容照常可看；发消息、生成、朗读等暂不可用），放在文档流内不遮挡内容。
- 输入区、消息菜单、工具面板、设置页、Life 运行视图逐处收口：联网动作禁用或撤下并说明原因，本地动作保留；**草稿仍可写**，不建发送队列。
- 工具面板离线时明确区分「当前离线」与「未配 MCP」；取外部图片失败时区分「离线」与「跨域」。
- 验收用 CDP `Network.emulateNetworkConditions` **真断网**（同时影响 `navigator.onLine` 与 `fetch`），并验恢复联网后的还原；`verify-offline` 38/38。

### Phase 6 · 导入导出增强（T-030）—— **完成**

- 新增单会话导出：Markdown（面向阅读，媒体只写说明不内联）与 JSON（与全量备份同构），入口在聊天设置面板。
- 全量备份补两条护栏：导入前的覆盖警告（含「先导出一份现在的备份」入口）与久未导出提醒（14 天且库里有数据）。
- 单会话导出**不**计入「上次导出备份」时间 —— 它不含日记 / 相册 / 账本，拿它当备份是错觉。
- 不引入任何外部导出格式；Dexie 仍 v10、备份格式仍 v8，本轮三条切片**零 schema 改动**。
- `verify-export` 17/17；四支原有前端验收（chat 140 / providers 22 / home 75 / diagnostics 36）无回归；两端 typecheck、生产构建、`git diff --check` 通过。

### Phase 3A · Nocturne 只读打通：按真实工具面收敛接口（T-031）—— **完成**

- 根因：适配层写死的 5 个工具名取自**官方 Demo**，而北北自部署实例的真实工具面是
  `breath` / `trace` / `hold` / `wander` / `wander_mark` / `drive` / `undercurrent` / `trail_delta` / `trail_family` —— **0/5 命中**。
  实例**没有 uri 概念，也没有「原地编辑 / 删除」语义**，所以这不是改字符串，是接口要重设计。
- `MemoryProvider` 收敛为**只读两方法**：`recall()`（→ `breath`，无参）+ `search(query,{limit})`（→ `trace`）；
  `read` / `create` / `update` / `delete` 四个方法与 `MemoryCreateInput` / `MemoryUpdateInput` 删除（全仓核查确认从未被调用），
  `MemorySearchOptions` 去掉实例不认的 `domain`。
- `/api/memory` 同步砍到两个只读端点（`GET boot` / `GET search`）；原四个写端点**直接移除**，不留返回 500 的占位。
- 适配层把工具名集中成一张 `NOCTURNE_TOOLS` 映射表，并新增 `verifyToolFace()`；`main.ts` 在连接后跑一次自检
  （缺失只 warn 不阻塞 —— 记忆挂掉不该拖垮服务）。
- mock MCP 的工具面从 7 个假 memory 工具换成实例真实形状（`breath` + `trace`，保留 `echo` 验链路），
  本地验收从此验的是真形状。
- 五个 Nocturne 脚本同步定位：三个侦察脚本的对照表改成 `breath`/`trace` 并改称「工具面漂移检测」；
  `probe-nocturne-live.ts` 读写工具表改真实名；`probe-nocturne-demo.ts` **废弃**（其工具面假设本身是错的）。
- 修 `probe-nocturne-tools-quick.sh` 真实 bug：临时文件写死 `/tmp`，Git Bash 下 `curl -D /tmp/x` 之后读不回来 → 改用 `$TMPDIR` + 可用性回退。
- 验收：`probe-memory.ts` **21/21**（只读两路径 + 参数边界 + 已移除端点 404）；三个侦察脚本对 mock 全部 2/2、退出码 0；
  `probe-nocturne-live.ts` 经 McpGateway **23/24**（唯一失败项是 mock 无 `/health`，非代码问题），只读纪律通过（实际调用仅 `breath` + `trace`）；
  启动日志出现「Nocturne 工具面自检通过」；两端 typecheck 通过。
- 后续 T-033 已完成真机 25/25；T-034 已取得服务器权限并完成生产鉴权与 26/26 对照验收。

### Phase 6 · 验收基础设施与可靠性收口（T-032 / T-033）—— **完成**

- mock MCP 生命周期验收扩为 5 项：session、真实工具面、GET SSE、DELETE 与关闭后拒绝复用；DELETE 同步释放服务端映射。
- 前端验收不再依赖浏览器“碰巧干净”：Home 开跑前清站点数据，Export 显式清设备级备份时间；PWA 的两条 PASS 输出改为真实成功说明。
- MCP 从 HTTP 启动关键路径摘出：服务先监听，随后后台连接、自检并每 60 秒重试；不可达 MCP 下健康接口约 291ms 返回 200，状态明确为 `error`。
- 自部署 Nocturne / Ombre Brain 完成只读专项验真 **25/25**：Streamable HTTP session、9 工具、`breath` / `trace` 两条实际调用均通过，未触碰写工具；探针默认遮蔽秘密路径。
- 部署文档按现网定稿为双 nginx，Caddy 归档为早期方案；T-034 又按实机源码把鉴权口径校正为 `OMBRE_API_PASSWORD`（Dashboard/API）+ nginx Bearer（MCP）。
- 最终回归：chat 140、providers 22、home 75、export 17、offline 38、diagnostics 36、PWA 25、本地记忆 21，全部通过；两端 typecheck 与生产构建通过。

**Phase 6 至此完成。** 动画 / 过渡效果归后续 UI 专项；实时双工与 AI 自主工具循环归独立协议，不作为 Phase 6 欠项。生产部署鉴权关卡已在 T-034 结清。

### Phase 3A · Nocturne 生产鉴权收口（T-034）—— **完成**

- 通过新配置的 SSH 公钥登录实机，确认现网版本的 `OMBRE_API_PASSWORD` 已保护 Dashboard/API，未登录 `/api/config` 返回 401；早先记录的 `OMBRE_ADMIN_TOKEN` 不适用于该版本。
- 当前版本没有 MCP 应用内 Bearer 开关，因此在宿主 nginx 的秘密 MCP location 加 Bearer 校验，并同时轮换路径与 Token；公开 `/mcp` 继续 404。
- 凭据仅保存在服务器 root-only 文件；nginx 配置修改前备份、`nginx -t` 后平滑 reload。
- 对照结果：健康 200、API 未登录 401、公开 MCP 404、秘密路径无 / 错 Token 均 401、正确 Token initialize 200。
- Habitat 生产客户端全链 **26/26**：无 Token 拒绝、Namespace、9 工具工具面、`breath` / `trace` 两条只读调用均通过，未触碰写工具。

**Phase 3A 至此完成。**

### Phase 6.5 · AI Runtime Integration（T-035 ~ T-038）—— **完成**

把「Nocturne / Eventide / MCP 与内置工具 / 日记 / 留言板」接成一套 AI **真正能认知、调用、并接收结果**的能力系统。
分四批交付，**P2 只动呈现层，执行层在前三批就定稿了**。

**修掉的根因（T-035 · P0）**

在引入之前，模型说「我没有调用外部工具的能力」是**诚实的** —— 它的上下文里确实没有这条信息：
服务端从来不传 `tools`、明确丢弃响应里的 `tool_calls`、完全不构造 system prompt，
而唯一能成功的「工具调用」是用户从 Mini Terminal 手动发起的（模型只看到一条结果消息）。
本层把**声明与事实对齐**，而不是劝模型相信自己会什么。

- **三方共用一份快照**：声明（`shared/capabilities.ts`）→ 判定（`capabilities/registry.ts`，带依赖探测缓存）→
  绑定执行（`capabilities/tools.ts`）。system context、tool schemas、前端档案页消费的**是同一份**。
- `autonomy` 四级（`autonomous` / `confirm` / `user-only` / `unavailable`）不是装饰，是**准入闸门**。
- 上下文按固定顺序注入：人格 → 规则 → 能力 → 记忆 → 事件 → 状态 → 历史；**任一段失败只少一段，不阻塞回复**。
- 状态可读化（`shared/state-summary.ts`）放在 shared，保证**AI 读到的与界面看到的是同一份事实**。
- 顺手修两个「本地没事、上线才炸」的 bug：`openai-compat.ts` **从不序列化 `toolCalls`**
  （`role='tool'` 消息依赖前一条带 `tool_calls` 的 assistant，真实上游直接 400）、
  以及**每 chunk 只取第一个 tool call**（OpenAI parallel tool calls 会静默丢调用）。

**共同生活数据迁服务端（T-036 · P1 前置）**

- 日记 / 留言板权威存储从浏览器 Dexie 迁到服务端 SQLite —— 不搬的话，AI 只能对着假数据演戏。
- **`author` 就是权限位**：`user` 的永远可读可改；`companion` 的只有 `visibility='open'` 才给用户看正文。
  迁移上来的旧日记一律标 `author='user'` —— **搬家不能顺手把用户的权夺走**。
- 搬迁挂**启动期**而不是 Dexie 升级回调：`stores()` 是跨版本累加的，**「新版本不声明某张表」删不掉它**；
  升级回调一辈子只跑一次，挂启动期才每次收敛。

**事件收件箱 + 挂起式确认（T-037 · P1）**

- `confirm` 级工具**不在流里等按钮**（SSE 单向、无回传、刷新即废、服务端不存聊天记录），
  改为**挂起**：只建待确认事件、**不执行**，用户点了才真写，结果下一轮经事件段注入模型。
- ⚠️ **挂起算 `ok: true`**，且回灌必须明说「**还没有执行**」—— 否则模型要么重试（用户收到一串重复确认卡），
  要么宣称「我写好了」。
- 收件箱是**双向**的，且两个方向权限检查**方向相反**：`tool_confirm` 由**用户**决定（AI 发起）、
  `diary_access_request` 由 **AI** 决定（用户发起）。谁都不能替对方点。
- 新增路由是 `/api/inbox` 而**不是** `/api/events` —— 后者已被 Eventide 状态流水占用，撞名会让 Fastify 直接启动失败。

**界面呈现（T-038 · P2）**

- `/llm` 从占位页改成**小栖档案（App Launcher）**：按模块分组的能力卡片，内容**全部**来自 `GET /api/capabilities`。
- **不做假入口**：日记 / 留言板 / 状态三张卡可点（进 Home / Home / Life 运行）；
  记忆与工具还没有页面，标「暂无界面」并说明它发生在哪儿，**整张卡不可点**。
- **「有页面」与「现在可用」是两个独立事实**：日记页在 AI 写不了日记时照样存在。
- Chat 气泡两侧加头像（小栖左 / 用户右），开关是**全局显示偏好**（localStorage，不落 Dexie、不进备份格式）。
- 按铁律**先补 `PRODUCT_SPEC` §9.1 产品行为再施工**（原文是「待补」）。

**验收（全部实跑）**

- 服务端：`probe-ai-runtime` 50/50、`probe-diary` 40/40、`probe-event-inbox` 66/66、`probe-chat-context` 注入 12/12 + 降级 3/3、`probe-memory` 21/21。
- 前端：`verify-llm` 16/16（新增）、`verify-chat` 148/148（新增 8 条头像断言）、
  home 77/77、providers 22/22、export 17/17、offline 38/38、diagnostics 36/36。
- 两端 typecheck 通过。**全程零 schema 改动之外的结构变更**：仅 T-036 带来 Dexie v11 / 备份 v9；P0 / P1 / P2 均无新增前端表。

**Phase 6.5 至此完成。** 未做的（`memory.write`、确认卡过期/撤回、工具卡片顺序、记忆与工具的真实界面）全部记在 `docs/TASKS.md`，
不作为本 Phase 欠项 —— 它们各自需要新协议或新的产品定义。

## 2026-09-25

### UI 换装 · 第 1 批：设计令牌 + 翻译层 + 整套积木（T-039）

**背景**：北北给出完整视觉原型 `D:/我搓/designs/qixi-habitat/`（可点着玩的手机原型，19 个 JSX + `tokens.css`），
要给栖息地"换这套衣服"，并把尚未落成的功能（一起听真播放 / 学习伴学 / 独处空间）逐步套嵌进去。
按「每批可回退」拆成 6 批（表见 `docs/UI_DESIGN.md` §5），本批是**纯内部地基**：只换配色，不动布局与交互。

**web**

- 新增 `theme/qixi/tokens.css`：新设计令牌（浅 / 深两套）—— 底色 / 表面 / 三档文字 / 强调（近黑近白，非彩色）/
  玻璃表面 / 圆角阶梯 `8·12·16·24·32·999` / 两档淡阴影 / 动效时长 / `--hit-min: 44px` / `--font-main`。
- 新增 `theme/qixi/components.css`：**整套积木**一次搬完 —— 类型阶梯 `.t-*`、`.card`、`.btn-pill(-strong/-ghost)`、
  `.chip`、`.dot`、`.topbar`、`.icon-btn`、胶囊底栏 `.bottom-nav`、气泡族 `.msg-*`、输入胶囊 `.chat-inputbar`、
  Bento `.bento/.bento-cell`、玻璃 `.glass` + `.deck`、雨幕 `.rain-*`、设置分组 `.setting-group/.seg/.toggle`、
  滑入层 `.sub-layer`、`.task-row`、`.breath-circle`、`.mini-bars`、`.ring-wrap`、`.rise` 入场。
- **改造 `theme/tokens.css` 为翻译层**：旧 9 个 `--color-*` 与 `--font-family` 全部用 `var()` 转发到新令牌。
  于是**551 处旧引用一行不改**就吃到新配色，且深色自动跟随（不必再维护一份暗色取值）。
  后续每批把做到页面的旧名换成新名，逐页收敛；全换完后本文件只剩对照表，可整体删除。
- 新增 `components/qixi/Icons.tsx`：32 个线框图标（24×24 / 线宽 1.7 / 圆头圆角 / **选中态用实心而非换色**）。
- 新增 `components/qixi/RainBackdrop.tsx`：程序化雨幕（52 滴 + 14 条雨痕，**确定性伪随机** ——
  用 `Math.random()` 会让雨点每次重渲染都重新分布，看起来像"闪烁跳动的雨"）+ `GlassCard`。
- `index.css` 明确三级加载顺序：新令牌 → 新组件 → 翻译层（顺序有讲究，注释已写明）。

**刻意不搬的四处**（理由都写进了文件头注释）

1. 原型的**桌面手机壳**（`html/body/#app` 的 390×844 假手机 + 深灰底）：栖息地本身就是手机上的 PWA，
   真机全屏才正确，套假壳会出现双边框。
2. 原型的 **`.screens` / `.screen` 叠放式换屏**：栖息地是**真路由**，照搬会打断刷新 / 前进后退 / 收藏。
   第 2 批改用 `.sub-layer` 只做滑入动画，**网址保持不变**。
3. 原型的调试面板 `.float-theme` / `.tweaks-*`（悬浮主题开关、雨量滑块）—— 不是产品功能。
4. `.model-card`（设计侧"换模型"卡）：北北已拍板这一轮 LLM 页只装能力卡片，换模型仍在设置页；
   样式保留、注释标明**暂未启用**。

**修掉一个真 bug**

- `--color-accent` **从未被定义**，但代码里用了 4 处（生活页选中日期描边、一条提示文字、
  「小栖钱包 — 追加流水」按钮背景、余额正负号颜色）。浏览器把未定义的 `var()` 当无效值丢弃 ⇒
  **那个按钮实际是"白字 + 透明底"，文字看不见**。已补进翻译层并有断言钉住。

**验收**

- 新增 `web/scripts/verify-tokens.mjs`（**24 条**）：① 18 个新令牌全部有值 ② **翻译层 10 条转发逐字相等**
  ③ 13 个积木类用探针元素量**计算结果**（CSS 写了 ≠ 生效）④ 浅/深两套确实不同、旧别名跟着一起切
  ⑤ 移动端无横向溢出 / 控制台无异常，并各截一张真实渲染图。
- 回归：home 77/77、chat 148/148、providers 22/22、llm 16/16、export 17/17、offline 38/38、diagnostics 36/36
  —— **零失败**（说明"换配色"确实没碰坏任何既有行为）。
- 两端 typecheck 通过。

### UI 换装 · 第 2 批：换外壳 + 界面 emoji 全量换 SVG（T-040）

**目标**：把"外壳"（底栏 / 进门 / 页面进出）换成原型的形态，同时把界面上的 emoji 图标**全部**换成
线框 SVG。本批**不动对话页内部**（那是第 3 批）。

**web · 底栏改成浮起胶囊**

- `app/BottomNav.tsx` 重写：贴底一条 → **浮起玻璃胶囊**（`.bottom-nav`，`bottom: 14px` + `backdrop-blur`）。
- 五个 Tab 定稿：**对话 / 家 / 大脑 / 生活 / 设置**（旧版是英文标签）。
- 图标换线框 SVG，且**选中态用实心、未选中用线** —— 位置信息由**形状**承载而不是颜色，
  这一点在色弱/强光下更稳。数据只存**图标名**（`IconName`），渲染走 `<QixiIcon name="…" />` 查表。
- ⚠️ **`--bottom-nav-height` 必须重算**：胶囊是浮起的，只算 `offsetHeight` 会被"悬空的那段"盖住内容。
  现在发布 `nav.offsetHeight + parseFloat(getComputedStyle(nav).bottom)`；安全区用
  `margin-bottom: env(...)` 表达而**不并进 `calc()`** —— 否则 JS 读到的是算完的复合值，没法拆。
  第 1 批那条"待重算"的遗留（见 T-039 遗留）就此关闭。

**web · 进门：欢迎页**

- 新增 `app/entry.ts`：`hasEntered()` / `markEntered()`（标记存 `sessionStorage`，读写都包 try/catch ——
  无痕模式下 `sessionStorage` 会直接抛）。`app/entry.ts` 与 `WelcomePage` 一起把"进门"这件事收在一处。
- 新增 `pages/welcome/WelcomePage.tsx`：雨幕 + 大号时间 + 问候 + 竖排手账句 + 小栖最近一条消息叠卡 + 进入按钮。
- 路由：`/` → 本次会话没进过则 `/welcome`，进过则 `/chat`；`/welcome` 可直达（不是"只有被拦才存在"）。
- **接的是真数据**：最近消息来自 `listSessions` / `listMessagesPage`；**没有就是空态**（"还没有聊过天 ——
  进去说第一句话吧"）。原型上写的是"2 条未读"，那是占位，**不搬**。
- 欢迎页**不显示底栏**（`AppShell` 里按路径判断），否则"还没进门就有门牌"。

**web · 页面进出：滑入**

- 新增 `components/qixi/useSlideIn.ts`：只在 `useNavigationType() === 'PUSH'` 时返回 `.slide-in`。
- ⚠️ **为什么不用 View Transitions**：`react-router-dom` 6.30 还不支持 `viewTransition` 属性。
  更要紧的是**只让前进动画**：后退/直达（刷新、手输网址、收藏）**不放动画**。
  若为了播"退出动画"去拦截后退，遇到快速连点 / 刷新 / 深链容易**卡在半路**。
- ⚠️ **网址必须是真的**：原型用 `.screens` 把所有页面绝对定位叠起来切 `is-active` ——
  照搬会让刷新、前进后退、加书签全失效。这里 `.slide-in` **只做动画**，地址仍是 `/home/diary`。
- `AppShell` 的 `main` 用 `overflow-x: clip`（**不是 `hidden`**）：`hidden` 会创建滚动容器，
  把滑入过程中的 `sticky/fixed` 一起带偏。

**web · emoji → SVG（全量）**

- `components/qixi/Icons.tsx` 从 32 个补到 **48 个**：新增 `IconMail / IconBookmark / IconPalette /
  IconMusic / IconPencil / IconThermometer / IconToolbox / IconAlert / IconBlock / IconClose / IconFile /
  IconKey / IconPin / IconChevronDown / IconLeaf / IconSmile` + `IconJournal`（日记专用），
  并加 `QIXI_ICONS` 字典与 `QixiIcon` / `IconName`。**认不出的名字返回 `null`**，不会炸页面。
- 数据层不再存 emoji：`features/home/modules.ts` 与 `features/llm/capabilityModules.ts` 的 `icon`
  字段由 `string` 收敛为 `IconName`（`mail / timer / heart / journal / bookmark / palette / image /
  book / music / pencil` 与 `brain / thermometer / journal / mail / toolbox`）——
  名字可序列化、进备份安全，也不会把 React 组件写进数据。
- 逐处替换（**界面图标，非文案**）：`HomePage`（🌿 → `IconLeaf`、`›` → `IconChevronRight`）、
  `CapabilityModuleCard`、`EventConfirmCard`（`SETTLED_LABEL` 改成 `{ Icon, text, color }` 结构；
  **被拒绝用中性色不用红**）、`MessageBlocks`（📄 / ✅ / ⚠️）、`HomeWidgets`、`ProviderSettings`
  （`✓/✗` → `IconCheck`/`IconClose`，并补 `data-probe-ok` 属性供断言）、`BackupPanel`、
  `ChatListPage`（📌 / ▸ / ▾）、`ChatBubble`（✓）、`BoardModule` / `CountdownModule` / `WishlistModule`、
  `Composer`（🎤 / 😀）、`SettingPage`（🌙 / ☀️ / ● ）、`DiagnosticPanel`（`→/←` 改成
  方向文字 + `IconChevronRight/Left`）。
- **刻意保留的两类 emoji**：① 输入框的**表情选择器**（那是用户要发出去的内容，不是界面）；
  ② 代码注释里的 ⚠️（不是界面）。`˚ ༘♡ ⋆｡˚` 这类**文字里的装饰字符**同样保留。

**web · 顺手修的两个真问题**

1. **日记和音乐撞了同一个图标**：原型里的 `IconNote` 其实是**音符**，而 `modules.ts` 给日记用的也是
   `note` → 两个入口长得一模一样。新增 `IconJournal`（笔记本 + 书签带 + 横线），
   日记（`modules.ts`）与"日记本"能力卡（`capabilityModules.ts`）都改用 `journal`。
2. **验收脚本两处"隐性耦合"，第 2 批才暴露**（都不是产品 bug，是测试写法问题 —— 但不修就会出现假红/假绿）：
   - `verify-offline` / `verify-export` 原先导航到**根路径**再等聊天列表，而根路径现在会先落欢迎页
     → 必超时。已改为**直达 `/chat`**。⚠️ 更要紧的是：`verify-export` 那轮**能过**，
     纯粹是因为上游 `verify-shell` 恰好留下了"已进入"标记 —— 属于**依赖脚本执行顺序的假绿**，
     单跑或换顺序就现原形。
   - `verify-offline` 的挂载判据里混了英文 `"Chat"`（底栏还是英文标签时代的残留）。
     底栏换中文后该串消失 → 超时。已统一成与 `verify-chat` / `verify-export` 同口径的「新建」。
   - 于是 `docs/UI_DESIGN.md` §4 补了一条铁律：**验收脚本一律直达目标路径，别碰根路径**。

**刻意不做的**

- 原型里的"2 条未读""Rainy Mood, Pt.2""69 天"等**占位数据一律不搬**，没数据就空态。
- `data-testid` **一个没删**（344 处验收依赖）；靠**文案**断言的少数几条逐个改成读属性/读新文案
  （`verify-providers` 改读 `data-probe-ok`，`verify-diagnostics` 改读 `请求/响应` 文字）。

**验收**

- 新增 `web/scripts/verify-shell.mjs`（**31 条**）：底栏是 `nav` 语义 + 5 个真 `<a href>` + 顺序与中文标签；
  胶囊形态（圆角 > 20 / 有 `backdrop-filter` / `bottom > 0`）；5 个图标都是 SVG；
  **选中 = 实心 + `currentColor` + `stroke: none`**、未选中 = 线；`--bottom-nav-height` === 高度 + 悬空值；
  宽屏下不撑满（≤ 430px）；进门三态（根路径首访 → `/welcome`、进过后 → `/chat`、`/welcome` 直达）；
  欢迎页有雨幕/叠卡/时间/进入按钮、**不显示底栏**、最近消息是真数据或诚实空态；
  子页面用真网址 + 前进时播 `slide-in-right` + 直达时不播；**各页 `innerText` 不再含 emoji**
  （用 `Extended_Pictographic` 判，装饰字符 `♡` 白名单放行）。
- 全量回归：home 77/77、chat 148/148、providers 24/24、llm 16/16、tokens 24/24、**shell 31/31**、
  export 17/17、offline 38/38、diagnostics 36/36（共 **411 项**）—— **零失败**。
- 两端 typecheck 通过。

### UI 换装 · 第 3 批：对话页换皮（T-041）

**范围**：6 批里最费工的一批 —— 会话列表 + 气泡消息流 + 浮起输入胶囊 + 对话相关组件令牌收敛。
硬约束全守住：真网址不改、`data-testid` 不删、界面不加 emoji、假数据不搬、**11 项对话能力一样不丢**。

**web**

- `pages/chat/ChatListPage.tsx`：`.topbar`（标题「对话」）+ 新建/分组改 `.btn-pill` 胶囊（SVG 图标）+ 会话行改 `.card` + 「⋯」→ `IconMore`。
- `pages/chat/ChatWindowPage.tsx`：顶栏改低存在感 `.topbar`（返回/小栖头像/标题/在线状态点/工具箱/设置，全图标）；虚拟列表套 `.chat-scroll.is-virtual`，进入动画 700ms 一次性（`.is-entering`）；跨天插 `day-divider`（今天/昨天/8月3日/跨年带年，`formatDayLabel` + `isSameDay` 按本地时区自然日）。
- `features/chat/ChatBubble.tsx` 重写：`.msg-row(.from-ai/.from-user)` → `.msg-col`（`.msg-bubble` + `.msg-actions.is-on` 常显 + `.msg-meta`）；流式空文本显示 `.typing-dots` 三跳圆点、否则 `▍` 光标；版本切换 `‹›`/`···` 全换 SVG。
- `features/chat/MessageAvatar.tsx` 独立：用户侧 `--accent-strong` 实底、小栖侧深色渐变；`inMessage` 开关让顶栏头像不被「数头像个数」断言算进去。
- `features/chat/Composer.tsx` 重写输入区：停靠胶囊 `.chat-inputbar--docked`（＋ / 自增高输入框（上限 108px）/ 麦克风 / 圆形主按钮 `IconSend`，生成中变 `IconStop`）；录音态/预览态/表情面板/图片描述条全部对齐新令牌；快捷栏保留表情 + 请求回复。
- `MessageBlocks` / `EventConfirmCard` / `ChatSettingsSheet` / `MiniTerminal`：`--color-*` 清零，对话相关文件全部吃新令牌。
- `components/qixi/Icons.tsx`：新增 `IconStop`（正方形，区别于 `IconPause` 双竖条）。
- `theme/qixi/components.css`：补 `.msg-col` / 三个气泡状态变体 / `.chat-inputbar--docked` 停靠变体 / 虚拟列表消息流与居中日期分隔的偏离规则；用户行改 `justify-content: flex-end`（不翻转 DOM 顺序，头像语义上在气泡「外侧」—— `row-reverse` 会把头像翻到左边，跟验收的 DOM 顺序断言打架）。

**验收脚本随动**（组件换皮 → 定位方式跟着换，不是放水）

- `verify-chat.mjs`（148 项保持全过）：气泡定位 `.rounded-2xl` → `.msg-bubble`；发送/停止/版本切换的**文案定位**全改 testid（主按钮已是图标）；分页两处「压线过」修正 —— 首屏高度上限按新行高 64→97px 校准（5200→7500）；删掉「#009 必须在 innerText」这个**视口算术**子句（263px 滚动窗 + 6×96 overscan 刚好盖不到 #009，旧 64px 时代是压线碰巧过），可靠判据改为「总高稳定 + scrollTop=0 时第 0 项必在窗口」。
- `verify-export.mjs`（17/17）：顶栏按钮纯图标无文案，`clickContains('设置')` → `chat-settings-open` testid。
- `verify-offline.mjs`（38/38）：长按气泡定位同 `.msg-bubble`。
- `verify-tokens.mjs`（24/24）：用户行断言从 `row-reverse` 改为 `flex-end`（积木探针补采 `justifyContent`）。

**验收**：新增 `web/scripts/verify-chat-skin.mjs` **31/31**（列表顶栏与胶囊真图标 / 气泡方向底色圆角来自令牌（颜色用探针元素解析成 rgb() 再比）/ 操作行常显可点 / 输入胶囊停靠不遮消息 / 圆形发送键 / 11 项能力入口齐 / 界面无 emoji 图标）；全量回归 **442 项零失败**（home 77 / chat 148 / skin 31 / providers 24 / llm 16 / tokens 24 / shell 31 / export 17 / offline 38 / diagnostics 36）；两端 typecheck 通过。

**刻意不做的**：设计稿的假数据（未读数、占位会话名）一律不搬；输入区没照抄 `position:absolute` 悬浮（沉浸式页面里跟虚拟列表打架，用文档流停靠，偏离已写进 CSS 注释与 `UI_DESIGN.md` §4）。

### UI 换装 · 第 4 批：家页换皮（T-042）

**范围**：家 = 6 格 Bento + 一行全入口（拍板口径，10 个模块一个不漏）+ 模块子页顶栏 + 家/大脑令牌清零。

**web**

- `pages/home/HomePage.tsx` 重写：低存在感页头（日期行 + 问候语）+ Bento 六格 + 全入口胶囊行。六格数据口径（铁律：假数据不搬）——
  小栖·现在 = 真联网状态（不搬「在窗边听雨」占位心情）；留言板/倒数日/最近收藏 = 最新一条；一起听 = 最近一首**只做入口**（假播放进度条不搬，真播放第 6 批接）；
  小栖的日记 = 本周篇数（全局「请求查看」按钮不搬 —— 真机制在日记模块按篇发起，全局按钮是假入口）。
- `pages/home/HomeModulePage.tsx`：子页挂与对话页同款 `.topbar`（图标返回 + `.topbar-title`）。
- 令牌：`features/home/*` 13 个文件 + 大脑（`pages/llm` / `features/llm`）+ `ActionSheet` / `NameSheet` / `UpdatePrompt` / `OfflineBanner`，共 **282 处** `--color-*` 清零。

**验收**：新增 `web/scripts/verify-home-skin.mjs` **14/14**（页头 / Bento 六格 / 空库诚实空态 / **真种数据必须吃库** / 全入口 10 个带图标无 emoji / 模块子页顶栏 / 无横向溢出 / 控制台无异常；
脚本开头先清留言/倒数日/收藏/音乐四类数据 —— 流水线里 verify-home 会先留下数据，空态断言必须顺序无关）；
全量回归 **442 项零失败**；两端 typecheck 通过。

### UI 换装 · 第 5 批：生活两套并排 + 设置重新分组（T-043）

**范围**：拍板口径 ——「生活」切「生活痕迹」（心情/睡眠/日记/一起听/雨）+「记录」（月历/账本/通知/事件/运行）两套并排；设置按设计重新分组。

**web**

- `pages/life/LifePage.tsx`：`.topbar` + `.seg` 两段开关；新 `TracesView`（Bento 五格）。数据口径（铁律：假数据不搬）——
  心情/睡眠没有真实来源（Eventide bodyState 字段上游自定）→ **诚实空态**；日记 = 本周真篇数按作者分；
  一起听/雨时长等第 6 批真播放接上才累计；设计稿的 7h12m / 心情曲线 / 3.5 小时 / 目标 8h 一格没搬。`?tab=` 老深链仍直达记录段。
- `pages/setting/SettingPage.tsx` 重新分组：顶栏 + 住客信息卡 + 外观（主题 `.seg` 分段，切了真生效）/ API 方案 / 数据备份 / 高级（server·MCP 状态 + 诊断日志）；清掉「将在 Phase 3 接入」过期占位段。
- `theme/useTheme.ts`：加 `setMode(mode)`。
- 令牌：LifePage / SettingPage / BackupPanel / ProviderSettings / ProviderForm / DiagnosticPanel / App / index.css，共 **127 处** `--color-*` 清零。

**验收**：新增 `web/scripts/verify-life-skin.mjs` **16/16**（两段开关 / 五格 / 四格诚实空态 / 占位数据零搬运 / 日记真计数 / 五页签齐全 / `?tab=` 深链 / 设置分组与住客卡 / 主题分段真生效 / 无溢出 / 控制台无异常）；
`verify-life.mjs` 补进流水线（Phase 4 起一直缺席，本轮修正；进页先切「记录」段）并随动 `verify-offline.mjs`；
全量回归 **488 项零失败**；两端 typecheck 通过。

### UI 换装 · 第 6 批：一起听真播放 + 学习伴学 + 独处空间（T-044）—— 换装收官

**范围**：补三个设计稿有、实现还是空壳的功能。诚实原则：没有真实来源的数据（「小栖也在听」「小栖点评」「复习卡片」）一律不做。

**web**

- 数据层：Dexie v12 新表 `listenSessions`（一天一行累加秒数）+ `studyTasks`（按天归组）；`db/listen.ts` / `db/studyTasks.ts`。两表暂不在备份白名单（升格式另行开任务）。
- `MusicModule` 重写：真 `<audio>` 播放器（进度/时长/上下首真控件），秒数播放中每 15 秒 + 暂停/切歌/卸载落盘；无链接曲目明说播不了；「收歌单」原能力一个字段没动。
- `StudyModule` 增「今天的三件小事」（加/勾/删，隔天新页）+「一周节奏」（真 studyRecords 聚合）。
- `/solo` 独处空间（沉浸式，无底栏）：呼吸圆计时 + 程序化雨声（Web Audio，零资产）+ 轮换短句，听雨秒数落盘。
- `LifePage` 生活痕迹：「一起听」「雨」点亮为真时长 + 真入口（0 秒仍空态文案）；心情/睡眠维持诚实空态。

**验收**：新增 `verify-batch6-skin.mjs` **29/29**（含真音频播放落盘、无链接拒绝、任务勾删、独处计时/落盘、沉浸无底栏、无溢出）；挂进流水线（verify-life-skin 之后，autoplay 旗标随动）；全量回归 **517 项零失败**；两端 typecheck 通过。

**第 6 批随动修复（同日全量回归暴露）**：`verify-home` / `verify-chat` 的 Dexie 版本断言升 v12；`run-front-verify.sh` 的 server 验收库改为**每轮唯一文件名**（`rm` 被 WorkBuddy 安全删除拦截静默吞掉导致库残留、搬迁断言连挂）+ `VERIFY_DB` 随动；`verify-offline` 补两段开关挂载等待（clickText 不重试的竞速）。连跑两轮 517 项零失败。

### 换装收尾 · 删除 `theme/tokens.css` 翻译层（T-045）

- 551 处旧令牌引用随 6 批换装清零后，翻译层按第 1 批预定整体删除；`index.css` 摘掉 @import。
- 非转发项 `--bottom-nav-height` 迁入 `qixi/tokens.css`（兜底初值，BottomNav 实测回写）。
- `qixi/tokens.css` 现在是全前端唯一的设计变量定义处。
- `verify-tokens.mjs` 职责反转：改验「翻译层删净」（11 个旧名必须失活 + 文件不存在 + 无 @import），23/23 通过。

### 部署前收尾（T-046~T-049）

- **备份格式 v10**：`listenSessions` / `studyTasks` 进备份（导出/校验/整体替换/计数全链），旧版导入按空处理；`verify-export` 增 v10 往返断言。
- **server 生产运行形态定稿**：`npm start` = `tsx src/index.ts`（tsx 解析 `@shared` 别名，与 dev 同路径；Node 20 实跑验证）。
- **新增 `verify-prod.mjs`（10 条，挂流水线）**：生产构建 + PWA 冒烟 —— SW 注册激活/作用域、manifest、断网重载外壳仍在（离线=只读）、断网 `/api/` 无 HTML 兜底。此前 SW 零自动化覆盖。
- **`docs/DEPLOYMENT.md` §6**：habitat 本体部署 runbook（构建产物 / systemd / nginx 子域站点片段 / env 清单 / 部署后验收 7 条）。
- 全量回归 **531 项零失败**；两端 typecheck 通过。**结论：代码侧部署就绪，剩实机操作按 §6 打勾。**

## 2026-09-26

### Post-v1 Phase 7A（T-051 / T-052）

- **身份显示**：原单一头像开关拆成小栖头像 / 我的头像 / 气泡昵称三个独立开关（旧偏好自动迁移）；设置页新增「身份」区（昵称 + 128px 方形头像 data URL，只存本机、不进备份）。
- **思绪折叠卡**：AI 气泡渲染 `metadata.reasoning`（有才渲染、默认收起、纯文本）。
- **Eventide `[object Object]` 修复**：`stateValue()` 对象/数组 JSON 化。
- **人格 Prompt**：服务端 app_kv 存储，注入为最优先 `persona` system 块；设置页编辑 / 保存 / 恢复默认（恢复=清空，无出厂人格）。
- **Prompt 查看**：按真实注入序列出全部 system 块，内置只读 / 自定义可编辑，动态块明说不预览假正文。
- **世界书最小可用版**：`worldbook_entry` 表 + `/setting/worldbook` 管理页；always/keyword 双模式（匹配最近 12 条对话），6000 字预算整条丢弃并标注；服务端权威，不进 web 备份。
- **Nocturne 记忆页** `/llm/memory`：健康（`/api/health/mcp` 新增 `configured` 区分未配置与异常）/ 记忆全文 / 关键词搜索；未配置时不发必败请求。
- **Eventide 状态页** `/life/eventide`：`eventide_history` 落库追加（去重、保留 2000 行）+ current/history 端点；摘要 / SVG 趋势 / 逐键 diff / raw 四块。
- 验收 **557 项零失败**（新增 verify-runtime 18 项、verify-llm 16→17；probe-prompt-worldbook 34 项、probe-eventide-history 6 项）。

### Post-v1 Phase 7B（T-053）

- **唤醒决策契约**：`runWake` 重写为「触发→上下文→决策→行动→结果」；**no-op 一等公民**（不算打扰、不推进未回复计数，但推进冷却）；行动面 message（唯一打扰类，单轮 ≤1）/ messageboard / diary；**约束全在服务端校验**（超限丢弃并落事件日志）；决策轮一次性生成全部内容，执行器零 LLM；`automation_action` 表 `(run_id, idx)` 唯一 = 行动幂等；`markWakeDecision(at, disturbed)` 拆分冷却与打扰计数。
- **写类自主化**：`diary.create` / `diary.update` / `messageboard.write` → `autonomous`（executeTool 直执行 + appendEventLog 审计）；确认协议保留给未来 memory.write，event-inbox 保留消化历史挂起事件。
- **Solitude Surf v1**：零依赖 RSS/Atom 解析 + 只读网页取回（协议白名单 / 内网黑名单 / 10s / 1MB）；feeds 存 app_kv（默认少数派+36kr，`GET/PUT /api/surf/feeds`）；并行拉源 → 有界候选 → 模型只选一篇 → 取正文 → 带完整来源的私人记录；URL 指纹近 14 天去重；**任何环节失败都降级普通整理**；订阅源与网页内容一律视为不可信数据（包标记 + prompt 明示）。
- **审计**：`/api/automation/runs` 按 run 聚合返回行动级审计（`actions[]`）。
- 验收：决策契约 **35/35**（`probe-decision-contract.ts` + mock `/__script` 脚本队列）；Phase 3B 21/21、Phase 4 16/16、P0 50/50、事件收件箱 57/57；前端全量流水线 16 支全过零失败；两端 typecheck 过。
### 2026-09-28 · T-086 · V2-A 完整应用内电话系统（本地）

- 新增服务端 `call_session` / `call_turn` 事实源与通话生命周期 API：创建、来电邀请、接听、拒绝、挂断、逐句记录与 SSE 状态流。
- 聊天页支持连续半双工通话、全局来电提示、历史逐句回放 / 朗读；AI 可在绑定会话中调用 `call_ring` 发起邀请。
- 通话结束写入 Life EventLog，月历汇总通话时长；不宣称 WebRTC 全双工、PSTN、CallKit 或系统锁屏电话。

### 2026-09-28 · T-096 · V2-A Home 基础模块第二阶段（本地）

- 日记支持服务端关键词 / 日期检索，检索结果沿用私密正文安全视图；留言板支持服务端内容 / 作者检索，收藏中心支持标题 / 备注 / 来源筛选。
- 倒数日支持编辑标题与日期，并将 `countdown.updated` 投影到 Life 时间线；修正倒数日时间线标题不应落成“生活事件”的投影问题。
- 日记查看申请结算后新增站内授权结果通知，并复用既有通知分类、免打扰与 Web Push 门控；不新增 schema 或平行通知模型。
- 验收：`probe:diary` 47/47、`probe:countdown-life` 7/7；两端 typecheck、前端 build、`git diff --check` 通过。

### 2026-09-28 · T-098 · V2-A Home 基础模块第三阶段（本地）

- 日记页新增折叠式查看申请历史，直接展示 Runtime Event 的待决 / 已开放 / 拒绝 / 失败状态与结果，不泄露私密正文。
- 通知卡点击后可按既有 `metadata.route` 回到真实来源页面；收藏搜索纳入来源元数据，统一来源组件补齐日记 / 作品 / 相册 / 共读模块回链。
- 无 SQLite / Dexie / 备份版本变化；`probe:diary-fragments` 11/11，两端 typecheck 与前端 build 通过。

### 2026-09-28 · T-100 · V2-A Home 基础模块第四阶段：倒数日完整化（本地）

- 倒数日新增分类、每年重复与提醒配置；Dexie 升 v15，旧记录自动补默认值，备份格式升 v13 并兼容旧备份导入。
- Home 与倒数日模块按下一次发生日展示重复事件；提醒通过现有通知收件箱联动，客户端 / 服务端以 `reminderKey` 去重，Push 失败不影响站内事实。
- `countdown.updated` Life 事件补充结构化摘要；新增倒数日提醒接口与 `probe:countdown-life` 9/9 验收。
- 两端 typecheck、前端 build、`git diff --check` 通过；不引入平行提醒表或服务端常驻调度器。

### 2026-09-28 · T-101 · V2-A Home 基础模块第四阶段部署 VPS（生产）

- 提交 `087b6c0` 已部署至 `https://habitat.beiyan.cc`，保留生产 `.env` / SQLite，并创建备份 `habitat.db.bak-20260928-087b6c0`。
- `habitat-server` active；服务器本机与服务器自 curl 公网域名健康检查通过，首页引用 `index-BgtV80yX.js`。
- 远端 `server/src/routes/automation.ts` SHA-256 与本地一致；通知偏好含 countdown 分类，提醒路由非法请求返回结构化 400。

### 2026-09-28 · T-102 · V2-A Home 基础模块第五阶段：愿望清单生命周期与 Life 投影（本地）

- 愿望清单补齐目标日期、作者、进行中 / 已完成 / 已暂停 / 已放弃四种状态、状态原因与进展记录；旧 Dexie 记录自动迁移，备份格式升 v14。
- 新增愿望 Life 事件接口与时间线投影，月历增加愿望活动统计；普通 UI 只展示结构化摘要，不直出对象。
- `probe:wishlist-life` 覆盖创建 / 编辑 / 状态 / 进展 / 删除、月历计数与非法状态；两端 typecheck 通过。

### 2026-09-28 · T-103 · V2-A Home 基础模块第五阶段部署 VPS（生产）

- 本地提交 `6449c17` 已部署至 `https://habitat.beiyan.cc`，保留生产 `.env` / SQLite，并创建备份 `habitat.db.bak-20260928-6449c17`。
- `habitat-server` 重启后 active；服务端健康、首页新静态资源、愿望 Life 路由 400 / 201 冒烟通过；远端 `server/src/routes/life.ts` SHA-256 与本地一致。
- 正向冒烟产生的测试事件已用部署前数据库备份恢复清理，未留在生产 Life 时间线。

### 2026-09-28 · T-104 · V2-A Home 基础模块第六阶段：收藏标签与分页（本地）

- `Bookmark` 新增多维 `tags[]`，收藏中心支持标签编辑 / 筛选 / 搜索命中与 20 条分页；分类仍保持单归属，未新建标签表。
- Dexie 升 v17、备份升 v15，旧收藏与旧备份自动补空标签；新增 `bookmark.tags.updated` Life 事件与结构化标签详情。
- `probe:bookmark-life` 扩展为 8/8，覆盖标签事实、时间线摘要、月历计数与非法标签数量。

### 2026-09-28 · T-105 · V2-A Home 基础模块第六阶段部署 VPS（生产）

- 本地提交 `8346a21` 已部署至 `https://habitat.beiyan.cc`，保留生产 `.env` / SQLite，并创建备份 `habitat.db.bak-20260928-8346a21`。
- `habitat-server` 重启后 active；公网健康、首页新静态资源、远端 Life 路由哈希与标签非法请求 400 冒烟通过。

### 2026-09-28 · T-110 · 相册自动收集聊天图片（本地）

- 设置页新增相册自动收集偏好：用户发送、AI 发送、AI 生成三类来源独立控制，默认关闭，并说明本地存储 / 备份体积影响。
- 新图片在原消息落库后直接复用现有 Photo 仓储与来源键；`message.id + image block.order` 负责幂等去重，自动重复不打断聊天，失败给轻提示且不丢原消息。
- 用户图片消息写入 `metadata.imageSource=user`，AI 生图写入 `metadata.imageSource=generated`；照片来源元数据保留 `sourceImageOrigin`，普通历史助手图片按 AI 发送归类。
- 不新增 Dexie / SQLite / API schema；自动收集偏好只存本机 `localStorage`，关闭不追溯删除既有照片。
- 两端 typecheck、前端 build、`git diff --check` 通过；浏览器 CDP 未启动，未冒充浏览器回归通过。

### 2026-09-28 · T-111 · 相册自动收集聊天图片部署 VPS（生产）

- 本地提交 `3999e44` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-3999e44`。
- `habitat-server` 已恢复 active；本机与公网 `/api/health` 均返回 `{"ok":true}`，首页切换到 `index-Bn-dYIch.js`。
- 生产 bundle 已检出自动收集设置文案与 `habitat-photo-collection` 持久化键；远端留言路由哈希与本地一致。

### 2026-09-28 · T-112 · AI 私密日记入口收口（本地）

- 日记页只呈现 `author=companion` 的小栖日记封面、已开放正文 / 片段与申请状态，不再把用户个人日记混入 AI 私密空间。
- 移除页面上的用户新建、编辑、删除表单；保留整篇 / 片段请求查看、申请历史与服务端权限过滤。
- 不改 Dexie / SQLite schema；用户日记 REST API 与迁移兼容能力保留。两端 typecheck、前端 build、`git diff --check` 通过；浏览器 CDP 未启动，未冒充浏览器回归通过。

### 2026-09-28 · T-113 · AI 私密日记入口收口部署 VPS（生产）

- 本地提交 `1265a0c` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-1265a0c`。
- `habitat-server` active；本地 `127.0.0.1:3000` 与公网 `/api/health` 均返回 `{"ok":true}`；首页切换到 `index-DV3_8HYC.js`。
- 生产 bundle 已检出 `diary-ai-only` 与“请求查看”入口标记；日记富文本 / 图片与时间线未在本批展开。

### 2026-09-28 · T-114 · AI 日记时间线分段（本地）

- 日记页在既有安全视图上按 `entryDate` 添加日期分隔线，同日条目保持连续阅读；不改变请求查看、片段过滤或 AI-only 语义。
- 空状态不再暗示用户可创建日记；补充 `role=list` / `role=listitem`、`time[dateTime]` 与稳定验收标记。
- 参考 [Journal](https://github.com/BomBomLab/Journal) 的展示层分段思路，不引入外部 runtime、数据格式或 schema；typecheck、build、diff check 通过。

### 2026-09-28 · T-115 · AI 日记时间线分段部署 VPS（生产）

- 本地提交 `4f24705` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-4f24705`。
- `habitat-server` active；本地与公网 `/api/health` 均返回 `{"ok":true}`；首页切换到 `index-a7B1ba3Y.js`。
- 生产 bundle 已检出 `diary-timeline`、`diary-date-divider` 与日期分段文案；未新增 schema / API。

### 2026-09-28 · T-116 · AI 伴学学习资料（本地）

- 学习页新增本地 TXT / Markdown 资料导入与安全 `http(s)` 链接登记；资料可按主题查看、删除，外链只保存地址，不在本批自动抓取。
- 已保存的文字资料可以在生成 AI 伴学卡片时作为受限上下文；服务端不复制资料、不把 URL 当成模型上下文。
- 新增 `studyMaterials`，Dexie 升 v19、备份格式升 v17；旧库 / 旧备份按空资料兼容。
- 两端 typecheck、前端 build、脚本语法检查与 `git diff --check` 通过；浏览器 CDP 未启动，未冒充浏览器回归通过。

### 2026-09-28 · T-117 · AI 伴学学习资料部署 VPS（生产）

- 本地提交 `2bc1949` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-2bc1949`。
- `habitat-server` active；服务器本机与服务器自检公网 `/api/health` 均返回 `{"ok":true}`；首页切换到 `index-CgzEeiP_.js`。
- 生产 bundle 已检出 `study-materials`、`study-card-material`、`TXT / Markdown` 与“学习资料”标记；本机直连公网 TLS 被网络重置，未冒充本机浏览器回归通过。

### 2026-09-28 · T-118 · 朋友圈文字动态（本地）

- Home 新增 `/home/feed` 朋友圈入口；复用服务端 `Moment` 事实源，新增 `channel=feed` 与留言板 `channel=board` 隔离查询。
- 用户可发布、编辑、删除文字动态，按作者筛选；朋友圈动态可收藏，来源快照回链 `/home/feed#<id>`，不影响既有留言板分组 / Widget。
- 老服务端 SQLite 启动时自动补 `channel='board'` 与索引；无 Dexie / 备份格式变化。
- `probe:feed` 9/9、两端 typecheck、前端 build、verify-home 语法检查与 diff check 通过；浏览器 CDP 未启动，未冒充浏览器回归通过。

### 2026-09-28 · T-119 · 朋友圈文字动态部署 VPS（生产）

- 本地提交 `d281437` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-d281437`。
- `habitat-server` active；服务器本机与服务器自检公网 `/api/health` 均返回 `{"ok":true}`；`GET /api/moments?channel=feed` 可访问。
- 首页切换到 `assets/index-fe1XBMZo.js`；生产 bundle 已检出 `朋友圈`、`feed-module`、`channel=feed` 与“分享此刻”标记。
- 本轮未启动浏览器 CDP；以服务器自检与线上 bundle 验收为准，未冒充本机浏览器回归通过。

### 2026-09-28 · T-120 · 每日品读第一阶段（本地）

- 新增 `/home/daily-reading`：从现有 TXT 共读书架抽取带书名 / 作者 / 段落锚点的片段，支持换一段、最近 8 段短期去重、历史回看、回到原书、原位收藏与批注。
- 批注继续写回原书 `ReadingBookState.annotations`；`reading.daily.swapped` / `reading.daily.annotation` 通过既有阅读事件接口进入 Life。
- Dexie 升 v20，新增 `dailyReadings`；备份格式升 v18，并兼容旧备份；未引入 PDF / EPUB、外部文学内容或 AI 自动评论。
- `probe:reading-life` 12/12、两端 typecheck、前端 build、验收脚本语法与 diff check 通过；浏览器 CDP 未启动，未冒充浏览器回归通过。

### 2026-09-28 · T-121 · 每日品读第一阶段部署 VPS（生产）

- 本地提交 `fd72eb9` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-fd72eb9`。
- `habitat-server` active；服务器本机与服务器自检公网 `/api/health` 均返回 `{"ok":true}`；`reading.daily.swapped` 正确 JSON 请求返回 201。
- 首页切换到 `assets/index-X9zoWOm1.js`；生产 bundle 已检出 `每日品读`、`daily-reading`、`dailyReadings`、`reading.daily.swapped` 与 `reading-excerpt` 标记。
- 线上临时验收事件已精确清理；本轮未启动浏览器 CDP，以服务端自检与线上 bundle 验收为准。

### 2026-09-28 · T-122 · 每日品读模块收口（本地）

- 每日品读复用共读段落锚点，补齐用户 / 小栖身份批注；小栖回应由服务端当前主聊天 Provider 生成，Provider 不可用时返回明确错误。
- 片段、用户批注、小栖批注可分别收藏，收藏快照保留作品、作者、段落与来源；新增 `daily-reading` 主屏 Widget，只展示短摘要并回链模块页。
- 历史支持书名 / 作者 / 片段搜索与二次确认删除；新增 `reading.daily.comment` Life 事件与 `POST /api/reading/daily/comment`。
- `probe:reading-life` 14/14，mock Provider 端点成功 / 失败分支、两端 typecheck、前端 build、验收脚本语法与 diff check 通过；独立浏览器 targeted e2e 8/8。

### 2026-09-28 · T-123 · 每日品读模块收口部署 VPS（生产）

- 本地提交 `202ef7a` 已部署到 `https://habitat.beiyan.cc`，生产 `.env` / SQLite 未覆盖，重启前备份为 `habitat.db.bak-20260928-202ef7a`。
- `habitat-server` active；服务器本机与服务器自检公网 `/api/health` 均返回 `{"ok":true}`；线上 bundle `assets/index-DvBxPobU.js` 已检出每日品读双方批注、批注收藏、首页 Widget 与 `/api/reading/daily/comment` 标记。
- 无 Provider 的评论请求按预期返回 400；`reading.daily.comment` Life 事件返回 201，验收用 `ref_id=deploy-reading-202ef7a` 已精确删除并复查为 0；阶段到此停止。
