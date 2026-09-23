# CHANGELOG · 变更记录

> 本文件记「改了什么」（面向版本，按 Phase 组织）。
> 「做到哪、还欠什么」在 `docs/TASKS.md`。

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
